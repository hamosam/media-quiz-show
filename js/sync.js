/**
 * 무설정 하이브리드 클라우드 릴레이 & P2P 동기화 엔진
 * (순우리말 마피아 게임의 검증된 3중 통신 아키텍처 + 이미지 패킷 최적화 적용)
 *
 * 1) 다중 MQTT-over-WSS 브로커 동시 연결 (emqx:8084 + hivemq:8884 동시 송수신으로 브로커 불일치 원천 차단)
 * 2) PeerJS WSS 443 웹소켓 직접 릴레이 (8084/8884 포트 및 UDP/WebRTC가 모두 막힌 스쿨넷에서도 443 포트로 통과)
 * 3) WebRTC DataChannel + 동일 기기 탭 동기화(BroadcastChannel/localStorage)
 * 4) 0.6초 간격 JOIN 확인 루프 & 작품 제출(SUBMIT) 수신 확인(ACK) 재전송
 * 5) 교사 브로드캐스트 시 학생에게는 무거운 이미지(Base64)를 제외한 경량 상태만 전송하여 패킷 드롭 방지
 * 6) Web Worker(2초 주기) 백그라운드 절전 방지 + 탭 복귀(visibilitychange/focus) 시 자동 재동기화
 */
window.MediaQuizSync = (function () {
  const LOCAL_PREFIX = "media_quiz_room_";
  const CHANNEL_NAME = "media_quiz_sync_channel";
  const P2P_PREFIX = "mediaquiz-v1-";
  const MQTT_TOPIC_PREFIX = "hamo_mediaquiz_v1/room/";

  const MQTT_BROKERS = [
    "wss://broker.emqx.io:8084/mqtt",
    "wss://broker.hivemq.com:8884/mqtt"
  ];

  const ICE_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" }
  ];

  let demoMode = false;
  let broadcastChannel = null;
  let activeListeners = [];

  // 하이브리드 네트워크 상태
  let hostPeer = null;
  let clientPeer = null;
  let clientConn = null;
  let clientConns = {};
  let clientPeerIds = {};
  let mqttClients = [];
  let activePin = null;
  let isHosting = false;
  let myClientId = "cl_" + Math.random().toString(36).slice(2, 9);
  let hostRoomState = null; // 교사 원본 (이미지 포함 전체 데이터)
  let clientRoomState = null; // 학생 수신 상태
  let stateCallback = null;
  let joinRetryTimer = null;
  let submitRetryTimer = null;
  let lastVer = 0;
  let bgKeepAliveWorker = null;

  function setDemoMode(enabled) {
    demoMode = Boolean(enabled);
    return { ok: true, demoMode };
  }

  function isDemoMode() {
    return demoMode;
  }

  function getChannel() {
    if (!broadcastChannel && "BroadcastChannel" in window) {
      broadcastChannel = new BroadcastChannel(CHANNEL_NAME);
    }
    return broadcastChannel;
  }

  // --- LocalStorage 저장소 ---
  function readLocalRoom(roomCode) {
    try {
      const raw = localStorage.getItem(LOCAL_PREFIX + roomCode);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function writeLocalRoom(roomCode, data) {
    try {
      localStorage.setItem(LOCAL_PREFIX + roomCode, JSON.stringify(data));
    } catch (_) {}
    const ch = getChannel();
    if (ch) ch.postMessage({ type: "ROOM_UPDATED", roomCode });
    window.dispatchEvent(new CustomEvent("local-room-updated", { detail: { roomCode } }));
  }

  // --- 백그라운드 탭(유튜브 재생 등) 슬립 방지 Web Worker (2초 주기) ---
  function ensureBackgroundKeepAlive(cb) {
    if (bgKeepAliveWorker) return;
    try {
      const blob = new Blob(["setInterval(function(){postMessage(1);},2000);"], {
        type: "application/javascript"
      });
      const url = URL.createObjectURL(blob);
      bgKeepAliveWorker = new Worker(url);
      URL.revokeObjectURL(url);
      bgKeepAliveWorker.onmessage = () => {
        try {
          cb();
        } catch (_) {}
      };
    } catch (_) {
      setInterval(() => {
        try {
          cb();
        } catch (_) {}
      }, 2000);
    }
  }

  // --- 학생 브로드캐스트용 경량 상태 생성 (30명 이미지 누적 패킷 초과 방지) ---
  function buildLightweightState(room) {
    if (!room) return null;
    const lightSubmissions = {};
    if (room.submissions) {
      Object.entries(room.submissions).forEach(([k, sub]) => {
        lightSubmissions[k] = {
          id: sub.id,
          round: sub.round,
          studentId: sub.studentId,
          nickname: sub.nickname,
          submittedAt: sub.submittedAt,
          result: sub.result || null
        };
      });
    }
    return {
      code: room.code,
      createdAt: room.createdAt,
      status: room.status,
      round: room.round,
      timeLimitSec: room.timeLimitSec,
      roundStartedAt: room.roundStartedAt,
      _ver: room._ver || 1,
      _updatedAt: room._updatedAt || Date.now(),
      students: room.students || {},
      submissions: lightSubmissions
    };
  }

  // --- PeerJS WSS 443 시그널링 소켓 직접 릴레이 (WebRTC UDP 차단 환경 우회) ---
  function sendViaPeerSocket(peer, dstPeerId, msg) {
    try {
      const sock = peer && (peer.socket || peer._socket);
      if (sock && typeof sock.send === "function" && dstPeerId) {
        sock.send({
          type: "CANDIDATE",
          dst: dstPeerId,
          payload: {
            connectionId: "__mq_ws_relay__",
            relayMsg: msg
          }
        });
        return true;
      }
    } catch (_) {}
    return false;
  }

  function attachPeerSocketRelay(peer, onRelayMsg) {
    const sock = peer && (peer.socket || peer._socket);
    if (!sock || sock.__mqRelayAttached) return;
    sock.__mqRelayAttached = true;
    sock.on("message", (packet) => {
      if (!packet) return;
      if (packet.payload && packet.payload.connectionId === "__mq_ws_relay__" && packet.payload.relayMsg) {
        onRelayMsg(packet.payload.relayMsg, packet.src);
      }
    });
  }

  // --- 다중 클라우드 MQTT-over-WSS 브로커 동시 연결 ---
  function connectMqttBrokers(pin, onMessage, onConnected) {
    if (!window.mqtt) return;
    MQTT_BROKERS.forEach((url) => {
      try {
        const client = window.mqtt.connect(url, {
          clientId: "mq_" + myClientId + "_" + Math.random().toString(36).slice(2, 7),
          clean: true,
          connectTimeout: 5000,
          reconnectPeriod: 2000,
          keepalive: 25
        });
        mqttClients.push(client);

        client.on("connect", () => {
          if (isHosting) {
            client.subscribe(`${MQTT_TOPIC_PREFIX}${pin}/to-host`, { qos: 1 });
            if (hostRoomState) {
              publishRoomStateMqtt();
            }
          } else {
            client.subscribe(`${MQTT_TOPIC_PREFIX}${pin}/state`, { qos: 1 });
            client.subscribe(`${MQTT_TOPIC_PREFIX}${pin}/to-client`, { qos: 1 });
            client.subscribe(`${MQTT_TOPIC_PREFIX}${pin}/to-client/${myClientId}`, { qos: 1 });
          }
          if (onConnected) onConnected(client);
        });

        client.on("message", (topic, payloadBuf) => {
          try {
            const raw = payloadBuf ? payloadBuf.toString() : "";
            if (!raw) return;
            const data = JSON.parse(raw);
            if (data) onMessage(topic, data);
          } catch (_) {}
        });
      } catch (_) {}
    });
  }

  function publishMqtt(topic, dataObjOrStr, retain = false) {
    const payload = typeof dataObjOrStr === "string" ? dataObjOrStr : JSON.stringify(dataObjOrStr);
    mqttClients.forEach((c) => {
      try {
        if (c && c.connected) {
          c.publish(topic, payload, { qos: 1, retain: Boolean(retain) });
        }
      } catch (_) {}
    });
  }

  function publishRoomStateMqtt() {
    if (!isHosting || !activePin || !hostRoomState) return;
    const lightRoom = buildLightweightState(hostRoomState);
    publishMqtt(
      `${MQTT_TOPIC_PREFIX}${activePin}/state`,
      {
        type: "SYNC",
        room: lightRoom
      },
      true
    );
  }

  // --- 교사 측 전체 동기화 브로드캐스트 ---
  function syncAllFromHost() {
    if (!hostRoomState) return;
    hostRoomState._ver = (hostRoomState._ver || 0) + 1;
    hostRoomState._updatedAt = Date.now();

    if (activePin) {
      writeLocalRoom(activePin, hostRoomState);
    }

    const lightRoom = buildLightweightState(hostRoomState);
    const syncMsg = { type: "SYNC", room: lightRoom };

    // 1) WebRTC DataChannel
    Object.values(clientConns).forEach((conn) => {
      try {
        if (conn && conn.open) conn.send(syncMsg);
      } catch (_) {}
    });

    // 2) PeerJS WSS 443 소켓 직접 릴레이
    if (hostPeer) {
      Object.values(clientPeerIds).forEach((dstPeerId) => {
        if (dstPeerId) sendViaPeerSocket(hostPeer, dstPeerId, syncMsg);
      });
    }

    // 3) 다중 MQTT Retained 상태 발행
    publishRoomStateMqtt();

    // 4) 교사 UI 즉시 갱신 (원본 전체 데이터 전달)
    if (stateCallback) stateCallback(hostRoomState);
  }

  function handleHostIncoming(data, srcPeerId, conn) {
    if (!data || !data.type || !hostRoomState) return;

    if (data.type === "JOIN" && data.student) {
      const st = data.student;
      if (conn) clientConns[st.id] = conn;
      if (srcPeerId) clientPeerIds[st.id] = srcPeerId;
      hostRoomState.students = hostRoomState.students || {};
      if (hostRoomState.students[st.id]) {
        // 재접속 시 기존에 배정된 제시어 보존
        hostRoomState.students[st.id] = {
          ...hostRoomState.students[st.id],
          nickname: st.nickname
        };
      } else {
        hostRoomState.students[st.id] = st;
      }
      syncAllFromHost();
    } else if (data.type === "SUBMIT" && data.submission) {
      const sub = data.submission;
      hostRoomState.submissions = hostRoomState.submissions || {};
      // 이미 채점 결과가 있으면 보존하면서 작품만 업데이트
      const prevResult = hostRoomState.submissions[sub.id]?.result || null;
      hostRoomState.submissions[sub.id] = {
        ...sub,
        result: prevResult
      };
      syncAllFromHost();
    } else if (data.type === "GET_STATE") {
      if (data.id && srcPeerId) clientPeerIds[data.id] = srcPeerId;
      if (data.id && conn) clientConns[data.id] = conn;
      syncAllFromHost();
    }
  }

  function ensureHostAlive() {
    if (!isHosting || !activePin || !hostRoomState || demoMode) return;
    if (hostPeer) {
      if (hostPeer.disconnected && !hostPeer.destroyed) {
        try {
          hostPeer.reconnect();
          attachPeerSocketRelay(hostPeer, (msg, src) => handleHostIncoming(msg, src, null));
        } catch (_) {}
      } else if (hostPeer.destroyed) {
        openHostPeerInstance(activePin);
      }
    }
  }

  function openHostPeerInstance(pin, onOpenCb) {
    if (!window.Peer) return;
    try {
      const peer = new window.Peer(P2P_PREFIX + pin, {
        pingInterval: 4000,
        config: { iceServers: ICE_SERVERS }
      });
      hostPeer = peer;

      peer.on("open", () => {
        attachPeerSocketRelay(peer, (msg, src) => handleHostIncoming(msg, src, null));
        if (onOpenCb) onOpenCb();
      });

      peer.on("disconnected", () => {
        if (hostPeer === peer && !peer.destroyed) {
          try {
            peer.reconnect();
          } catch (_) {}
        }
      });

      peer.on("connection", (conn) => {
        conn.on("open", () => {
          attachPeerSocketRelay(peer, (msg, src) => handleHostIncoming(msg, src, null));
          try {
            conn.send({ type: "SYNC", room: buildLightweightState(hostRoomState) });
          } catch (_) {}
        });
        conn.on("data", (data) => {
          handleHostIncoming(data, conn.peer, conn);
        });
      });
    } catch (_) {}
  }

  // --- 학생 측 메시지 송수신 ---
  function sendToHost(msg) {
    const packet = {
      ...msg,
      senderPeerId: clientPeer ? clientPeer.id : null
    };
    if (activePin) {
      publishMqtt(`${MQTT_TOPIC_PREFIX}${activePin}/to-host`, packet, false);
    }
    if (clientPeer && activePin) {
      sendViaPeerSocket(clientPeer, P2P_PREFIX + activePin, packet);
    }
    if (clientConn && clientConn.open) {
      try {
        clientConn.send(packet);
      } catch (_) {}
    }
  }

  function handleClientIncoming(data, studentId, onJoinConfirmed) {
    if (!data || !data.type) return;
    if (data.type === "SYNC" && data.room) {
      const ver = data.room._ver || 0;
      const hasMe = Boolean(data.room.students && data.room.students[studentId]);
      if (ver < lastVer && (!hasMe || (clientRoomState && clientRoomState.students && clientRoomState.students[studentId]))) {
        return;
      }
      lastVer = Math.max(lastVer, ver);
      clientRoomState = data.room;
      if (hasMe && onJoinConfirmed) {
        onJoinConfirmed();
      }
      if (stateCallback) stateCallback(clientRoomState);
    }
  }

  // --- 방 생성 (교사) ---
  async function createRoom(roomCode) {
    disconnect();
    activePin = roomCode;
    isHosting = true;

    const initialRoom = {
      code: roomCode,
      createdAt: Date.now(),
      status: "lobby",
      round: 1,
      timeLimitSec: 180,
      roundStartedAt: null,
      _ver: 1,
      _updatedAt: Date.now(),
      students: {},
      submissions: {}
    };

    hostRoomState = initialRoom;
    writeLocalRoom(roomCode, initialRoom);

    if (demoMode) {
      return initialRoom;
    }

    ensureBackgroundKeepAlive(() => ensureHostAlive());

    return new Promise((resolve) => {
      let resolved = false;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        publishRoomStateMqtt();
        resolve(initialRoom);
      };

      // 1) 다중 MQTT 브로커 동시 연결
      connectMqttBrokers(
        roomCode,
        (topic, data) => {
          if (topic.endsWith("/to-host")) {
            handleHostIncoming(data, data.senderPeerId || null, null);
          }
        },
        () => {
          publishRoomStateMqtt();
          finish();
        }
      );

      // 2) PeerJS (WSS 443 + WebRTC) 동시 오픈
      if (window.Peer) {
        openHostPeerInstance(roomCode, () => finish());
      }

      const timer = setTimeout(finish, 3000);
    });
  }

  // --- 방 조회 ---
  async function getRoom(roomCode) {
    if (isHosting && hostRoomState) return hostRoomState;
    if (clientRoomState) return clientRoomState;
    return readLocalRoom(roomCode);
  }

  // --- 방 실시간 구독 ---
  function subscribeRoom(roomCode, callback) {
    unsubscribeAll();
    stateCallback = callback;

    if (demoMode) {
      callback(readLocalRoom(roomCode));
      const onCustom = (e) => {
        if (e.detail && e.detail.roomCode === roomCode) callback(readLocalRoom(roomCode));
      };
      const onStorage = (e) => {
        if (e.key === LOCAL_PREFIX + roomCode) callback(readLocalRoom(roomCode));
      };
      const ch = getChannel();
      const onBroadcast = (e) => {
        if (e.data && e.data.roomCode === roomCode) callback(readLocalRoom(roomCode));
      };

      window.addEventListener("local-room-updated", onCustom);
      window.addEventListener("storage", onStorage);
      if (ch) ch.addEventListener("message", onBroadcast);

      activeListeners.push(() => {
        window.removeEventListener("local-room-updated", onCustom);
        window.removeEventListener("storage", onStorage);
        if (ch) ch.removeEventListener("message", onBroadcast);
      });
      return;
    }

    if (isHosting && hostRoomState) {
      callback(hostRoomState);
    } else if (clientRoomState) {
      callback(clientRoomState);
    }
  }

  function unsubscribeAll() {
    activeListeners.forEach((off) => off());
    activeListeners = [];
    stateCallback = null;
  }

  function disconnect() {
    if (joinRetryTimer) {
      clearInterval(joinRetryTimer);
      joinRetryTimer = null;
    }
    if (submitRetryTimer) {
      clearInterval(submitRetryTimer);
      submitRetryTimer = null;
    }
    if (isHosting && activePin && !demoMode) {
      publishMqtt(`${MQTT_TOPIC_PREFIX}${activePin}/state`, "", true);
    }
    if (hostPeer) {
      try {
        hostPeer.destroy();
      } catch (_) {}
      hostPeer = null;
    }
    if (clientConn) {
      try {
        clientConn.close();
      } catch (_) {}
      clientConn = null;
    }
    if (clientPeer) {
      try {
        clientPeer.destroy();
      } catch (_) {}
      clientPeer = null;
    }
    if (mqttClients.length) {
      mqttClients.forEach((c) => {
        try {
          c.end(true);
        } catch (_) {}
      });
      mqttClients = [];
    }
    unsubscribeAll();
    clientConns = {};
    clientPeerIds = {};
    activePin = null;
    isHosting = false;
    hostRoomState = null;
    clientRoomState = null;
    lastVer = 0;
  }

  // --- 방 부분 업데이트 (교사) ---
  async function updateRoom(roomCode, patch) {
    if (demoMode) {
      const room = readLocalRoom(roomCode);
      if (!room) return;
      Object.assign(room, patch);
      writeLocalRoom(roomCode, room);
      return;
    }
    if (hostRoomState) {
      Object.assign(hostRoomState, patch);
      syncAllFromHost();
    }
  }

  // --- 학생 입장 (0.6초 간격 3중 채널 JOIN 반복 확인) ---
  async function joinStudent(roomCode, student) {
    disconnect();
    activePin = roomCode;
    isHosting = false;
    myClientId = student.id;

    if (demoMode) {
      const room = readLocalRoom(roomCode);
      if (!room) throw new Error("존재하지 않는 방 코드입니다.");
      room.students = room.students || {};
      room.students[student.id] = student;
      writeLocalRoom(roomCode, room);
      return;
    }

    return new Promise((resolve, reject) => {
      let connected = false;
      let settled = false;
      let sawRoomState = false;

      const onJoinConfirmed = () => {
        if (connected) return;
        connected = true;
        settled = true;
        clearTimeout(timer);
        if (joinRetryTimer) {
          clearInterval(joinRetryTimer);
          joinRetryTimer = null;
        }
        resolve(clientRoomState);
      };

      const sendJoinEverywhere = () => {
        if (connected) return;
        sendToHost({ type: "JOIN", id: student.id, student });
      };

      // 1) 다중 MQTT 브로커 구독 및 즉시 JOIN
      connectMqttBrokers(
        roomCode,
        (topic, data) => {
          if (data && data.room) sawRoomState = true;
          handleClientIncoming(data, student.id, onJoinConfirmed);
          if (data && data.room && (!data.room.students || !data.room.students[student.id])) {
            sendJoinEverywhere();
          }
        },
        () => {
          sendJoinEverywhere();
        }
      );

      // 2) PeerJS (WSS 443 소켓 릴레이 + WebRTC DataChannel) 병렬 연결
      if (window.Peer) {
        try {
          const peer = new window.Peer({
            pingInterval: 4000,
            config: { iceServers: ICE_SERVERS }
          });
          clientPeer = peer;

          peer.on("open", () => {
            attachPeerSocketRelay(peer, (msg) => {
              if (msg && msg.room) sawRoomState = true;
              handleClientIncoming(msg, student.id, onJoinConfirmed);
              if (msg && msg.room && (!msg.room.students || !msg.room.students[student.id])) {
                sendJoinEverywhere();
              }
            });

            sendJoinEverywhere();

            try {
              const conn = peer.connect(P2P_PREFIX + roomCode, { reliable: true });
              clientConn = conn;
              conn.on("open", () => sendJoinEverywhere());
              conn.on("data", (data) => {
                if (data && data.room) sawRoomState = true;
                handleClientIncoming(data, student.id, onJoinConfirmed);
              });
            } catch (_) {}
          });

          peer.on("disconnected", () => {
            if (clientPeer === peer && !peer.destroyed) {
              try {
                peer.reconnect();
              } catch (_) {}
            }
          });
        } catch (_) {}
      }

      // 0.6초마다 교사 명단에 내 이름이 올라갈 때까지 JOIN 패킷 반복 전송
      joinRetryTimer = setInterval(() => {
        if (connected) {
          clearInterval(joinRetryTimer);
          joinRetryTimer = null;
          return;
        }
        sendJoinEverywhere();
      }, 600);

      // 최대 8초 대기 후 판정
      const timer = setTimeout(() => {
        if (connected || settled) return;
        settled = true;
        if (joinRetryTimer) {
          clearInterval(joinRetryTimer);
          joinRetryTimer = null;
        }

        if (sawRoomState && clientRoomState) {
          clientRoomState.students = clientRoomState.students || {};
          clientRoomState.students[student.id] = student;
          connected = true;
          sendJoinEverywhere();
          resolve(clientRoomState);
          return;
        }

        // 같은 기기 내 로컬 방 자동 폴백
        const localRoom = readLocalRoom(roomCode);
        if (localRoom) {
          localRoom.students = localRoom.students || {};
          localRoom.students[student.id] = student;
          writeLocalRoom(roomCode, localRoom);
          clientRoomState = localRoom;
          resolve(localRoom);
          return;
        }

        disconnect();
        reject(new Error("방을 찾을 수 없습니다. 4자리 방 코드를 확인하거나 선생님 화면이 열려 있는지 확인해 주세요."));
      }, 8000);
    });
  }

  // --- 학생 목록 일괄 업데이트 (교사 제시어 배정) ---
  async function updateStudents(roomCode, studentsMap) {
    if (demoMode) {
      const room = readLocalRoom(roomCode);
      if (!room) return;
      room.students = studentsMap;
      writeLocalRoom(roomCode, room);
      return;
    }
    if (hostRoomState) {
      hostRoomState.students = studentsMap;
      syncAllFromHost();
    }
  }

  // --- 작품 제출 (교사 데모 제출 & 학생 3중 채널 ACK 확인 재전송 모두 지원) ---
  async function submitWork(roomCode, submission) {
    if (demoMode) {
      const room = readLocalRoom(roomCode);
      if (!room) return;
      room.submissions = room.submissions || {};
      room.submissions[submission.id] = submission;
      writeLocalRoom(roomCode, room);
      return;
    }

    // 교사 화면에서 데모 작품 채우기 호출 시
    if (isHosting && hostRoomState) {
      hostRoomState.submissions = hostRoomState.submissions || {};
      hostRoomState.submissions[submission.id] = submission;
      syncAllFromHost();
      return;
    }

    // 학생 화면에서 제출 시: 교사 상태(submissions[submission.id])에 반영될 때까지 최대 4회 재전송
    if (submitRetryTimer) {
      clearInterval(submitRetryTimer);
      submitRetryTimer = null;
    }

    const sendSubmit = () => {
      sendToHost({ type: "SUBMIT", submission });
    };
    sendSubmit();

    let attempts = 0;
    submitRetryTimer = setInterval(() => {
      attempts++;
      const confirmed = Boolean(clientRoomState && clientRoomState.submissions && clientRoomState.submissions[submission.id]);
      if (confirmed || attempts >= 4) {
        clearInterval(submitRetryTimer);
        submitRetryTimer = null;
        return;
      }
      sendSubmit();
    }, 900);
  }

  // --- 퀴즈쇼 결과 기록 (교사) ---
  async function recordSubmissionResult(roomCode, submissionId, result) {
    if (demoMode) {
      const room = readLocalRoom(roomCode);
      if (!room || !room.submissions || !room.submissions[submissionId]) return;
      room.submissions[submissionId].result = result;
      writeLocalRoom(roomCode, room);
      return;
    }
    if (hostRoomState && hostRoomState.submissions && hostRoomState.submissions[submissionId]) {
      hostRoomState.submissions[submissionId].result = result;
      syncAllFromHost();
    }
  }

  // 탭 복귀(화면 켜짐/포커스) 시 자동 재동기화
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && activePin && !demoMode) {
      if (isHosting) ensureHostAlive();
      else sendToHost({ type: "GET_STATE", id: myClientId });
    }
  });

  window.addEventListener("focus", () => {
    if (activePin && !demoMode) {
      if (isHosting) ensureHostAlive();
      else sendToHost({ type: "GET_STATE", id: myClientId });
    }
  });

  return {
    setDemoMode,
    isDemoMode,
    createRoom,
    getRoom,
    subscribeRoom,
    unsubscribeAll,
    disconnect,
    updateRoom,
    joinStudent,
    updateStudents,
    submitWork,
    recordSubmissionResult
  };
})();
