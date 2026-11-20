/**
 * 학생 화면 (태블릿 제작 스튜디오) 컨트롤러
 */
window.MediaQuizStudent = (function () {
  const ROUND_INFO = {
    1: { badge: "1라운드: 인쇄매체", title: "🎨 그림판 & 정적 글자", hint: "시각 고정 요소만 사용 가능 (소리/움직임 잠금)" },
    2: { badge: "2라운드: 음성매체", title: "📻 라디오 음성 스튜디오", hint: "청각 요소만 사용 가능 (그림판 잠금)" },
    3: { badge: "3라운드: 영상매체(복합)", title: "🎬 영상 복합 스튜디오", hint: "그림 + 움직이는 자막 + 필터 + 소리 모두 해금!" }
  };

  let roomCode = null;
  let studentId = null;
  let nickname = "";
  let currentRound = 1;
  let myWord = "";
  let myForbidden = [];
  let roomData = null;
  let canvasCtrl = null;
  let sfxList = [];
  let timerInterval = null;
  let initialized = false;

  const els = {};

  function cacheDom() {
    els.roundBadge = document.getElementById("student-round-badge");
    els.nameDisplay = document.getElementById("student-name-display");
    els.timer = document.getElementById("student-timer");
    els.btnExit = document.getElementById("btn-student-exit");
    els.secretWord = document.getElementById("student-secret-word");
    els.btnToggleSecret = document.getElementById("btn-toggle-secret");
    els.forbiddenList = document.getElementById("student-forbidden-list");
    els.forbiddenAlert = document.getElementById("student-forbidden-alert");
    els.forbiddenFound = document.getElementById("forbidden-found-words");

    els.waiting = document.getElementById("student-waiting");
    els.roomDisplay = document.getElementById("student-room-display");
    els.studio = document.getElementById("student-studio");
    els.stageTitle = document.getElementById("studio-stage-title");
    els.constraintHint = document.getElementById("studio-constraint-hint");

    els.canvasWrap = document.getElementById("student-canvas-wrap");
    els.canvas = document.getElementById("student-canvas");
    els.staticOverlay = document.getElementById("student-static-overlay");
    els.animOverlay = document.getElementById("student-anim-overlay");
    els.radioLock = document.getElementById("student-radio-lock");

    // 도구 패널
    els.panelDraw = document.getElementById("tool-panel-draw");
    els.panelStatic = document.getElementById("tool-panel-static-text");
    els.panelVideo = document.getElementById("tool-panel-video");
    els.panelAudio = document.getElementById("tool-panel-audio");

    // 그림판 버튼
    els.btnPen = document.getElementById("btn-tool-pen");
    els.btnEraser = document.getElementById("btn-tool-eraser");
    els.btnUndo = document.getElementById("btn-tool-undo");
    els.btnImage = document.getElementById("btn-tool-image");
    els.inputImage = document.getElementById("input-draw-image");
    els.btnClear = document.getElementById("btn-tool-clear");
    els.colorsRow = document.getElementById("draw-colors-row");
    els.sizesRow = document.getElementById("draw-sizes-row");
    els.stampsRow = document.getElementById("draw-stamps-row");

    // 1R 정적 텍스트
    els.staticText = document.getElementById("input-static-text");
    els.staticStyle = document.getElementById("select-static-style");
    els.staticPos = document.getElementById("select-static-pos");
    els.staticSize = document.getElementById("select-static-size");
    els.staticColor = document.getElementById("input-static-color");

    // 3R 영상 자막/필터
    els.animText = document.getElementById("input-anim-text");
    els.animFont = document.getElementById("select-anim-font");
    els.animEffect = document.getElementById("select-anim-effect");
    els.screenFilter = document.getElementById("select-screen-filter");
    els.animColor = document.getElementById("input-anim-color");

    // 2R/3R 오디오
    els.ttsText = document.getElementById("input-tts-text");
    els.ttsRate = document.getElementById("range-tts-rate");
    els.ttsPitch = document.getElementById("range-tts-pitch");
    els.btnTestTts = document.getElementById("btn-test-tts");
    els.selectBgm = document.getElementById("select-bgm");
    els.btnAddSfx = document.getElementById("btn-add-sfx");
    els.sfxContainer = document.getElementById("sfx-list-container");

    // 액션
    els.btnPreview = document.getElementById("btn-student-preview");
    els.btnSubmit = document.getElementById("btn-student-submit");
  }

  function setupTools() {
    canvasCtrl = window.MediaQuizCanvas.create(els.canvas);

    // 6가지 색상 팔레트 생성
    els.colorsRow.innerHTML = canvasCtrl.COLORS.map(
      (c, i) =>
        `<button type="button" class="color-swatch ${i === 0 ? "active" : ""}" style="background:${c.hex}" data-color="${
          c.hex
        }" title="${c.name}"></button>`
    ).join("");

    els.colorsRow.querySelectorAll(".color-swatch").forEach((sw) => {
      sw.addEventListener("click", () => {
        canvasCtrl.setColor(sw.dataset.color);
        els.colorsRow.querySelectorAll(".color-swatch").forEach((b) => b.classList.toggle("active", b === sw));
        els.btnPen.classList.add("active");
        els.btnEraser.classList.remove("active");
        els.stampsRow.querySelectorAll(".stamp-btn").forEach((b) => b.classList.remove("active"));
      });
    });

    // 3단계 굵기 생성
    els.sizesRow.innerHTML = canvasCtrl.SIZES.map(
      (s, i) =>
        `<button type="button" class="tool-btn ${i === 1 ? "active" : ""}" data-size="${s.width}">${s.label}</button>`
    ).join("");

    els.sizesRow.querySelectorAll("[data-size]").forEach((btn) => {
      btn.addEventListener("click", () => {
        canvasCtrl.setSize(Number(btn.dataset.size));
        els.sizesRow.querySelectorAll("[data-size]").forEach((b) => b.classList.toggle("active", b === btn));
      });
    });

    // 이모지 스탬프 팔레트 생성
    els.stampsRow.innerHTML =
      `<span class="small-label">스티커:</span>` +
      canvasCtrl.STAMPS.map(
        (emoji) => `<button type="button" class="stamp-btn" data-stamp="${emoji}" title="클릭 후 캔버스 터치">${emoji}</button>`
      ).join("");

    els.stampsRow.querySelectorAll(".stamp-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        canvasCtrl.setStamp(btn.dataset.stamp);
        els.stampsRow.querySelectorAll(".stamp-btn").forEach((b) => b.classList.toggle("active", b === btn));
        els.btnPen.classList.remove("active");
        els.btnEraser.classList.remove("active");
      });
    });

    els.btnPen.addEventListener("click", () => {
      canvasCtrl.setTool("pen");
      els.btnPen.classList.add("active");
      els.btnEraser.classList.remove("active");
      els.stampsRow.querySelectorAll(".stamp-btn").forEach((b) => b.classList.remove("active"));
    });

    els.btnEraser.addEventListener("click", () => {
      canvasCtrl.setTool("eraser");
      els.btnEraser.classList.add("active");
      els.btnPen.classList.remove("active");
      els.stampsRow.querySelectorAll(".stamp-btn").forEach((b) => b.classList.remove("active"));
    });

    els.btnClear.addEventListener("click", () => canvasCtrl.clear());

    els.btnUndo.addEventListener("click", () => {
      if (!canvasCtrl.undo()) {
        window.MediaQuizApp.toast("더 이상 되돌릴 작업이 없습니다.");
      }
    });

    els.btnImage.addEventListener("click", () => {
      els.inputImage.click();
    });

    els.inputImage.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        await canvasCtrl.drawImageFile(file);
        window.MediaQuizApp.toast("이미지를 캔버스에 불러왔습니다! 위에 그림을 덧붙일 수 있어요.");
      } catch (err) {
        window.MediaQuizApp.toast(err.message || "이미지 불러오기에 실패했습니다.");
      } finally {
        els.inputImage.value = "";
      }
    });

    // 비밀 제시어 가리기 토글
    els.btnToggleSecret.addEventListener("click", () => {
      const masked = els.secretWord.classList.toggle("masked");
      els.btnToggleSecret.textContent = masked ? "👁 보기" : "👁 가리기";
    });

    // 정적 텍스트 & 움직이는 자막 실시간 미리보기 + 금지어 검사
    [els.staticText, els.staticStyle, els.staticPos, els.staticSize, els.staticColor].forEach((el) => {
      el.addEventListener("input", () => {
        updateStaticOverlay();
        checkForbiddenWords();
      });
    });

    [els.animText, els.animFont, els.animEffect, els.screenFilter, els.animColor].forEach((el) => {
      el.addEventListener("input", () => {
        updateVideoOverlay();
        checkForbiddenWords();
      });
    });

    els.ttsText.addEventListener("input", checkForbiddenWords);

    els.btnTestTts.addEventListener("click", async () => {
      await window.MediaQuizAudio.ensureAudioContext();
      window.MediaQuizAudio.speakTTS(els.ttsText.value, els.ttsRate.value, els.ttsPitch.value);
    });

    els.btnAddSfx.addEventListener("click", addSfxSlot);
    els.btnPreview.addEventListener("click", previewScene);
    els.btnSubmit.addEventListener("click", submitWork);

    els.btnExit.addEventListener("click", () => {
      cleanup();
      window.MediaQuizApp.showStartView();
    });
  }

  function resetStudioInputs() {
    if (canvasCtrl) canvasCtrl.clear();
    els.staticText.value = "";
    els.animText.value = "";
    els.ttsText.value = "";
    els.screenFilter.value = "none";
    els.selectBgm.value = "none";
    sfxList = [];
    renderSfxList();
    updateStaticOverlay();
    updateVideoOverlay();
  }

  async function joinRoom(code, name) {
    if (!initialized) {
      cacheDom();
      setupTools();
      initialized = true;
    }
    resetStudioInputs();
    roomCode = code;
    nickname = name;
    myWord = "";
    myForbidden = [];
    studentId = "st_" + Math.random().toString(36).slice(2, 9);

    await window.MediaQuizSync.joinStudent(code, {
      id: studentId,
      nickname,
      joinedAt: Date.now(),
      wordId: null,
      word: "",
      forbidden: []
    });

    els.nameDisplay.textContent = nickname;
    els.roomDisplay.textContent = code;
    els.waiting.classList.remove("hidden");
    els.studio.classList.add("hidden");

    window.MediaQuizSync.subscribeRoom(code, onRoomUpdate);
  }

  function onRoomUpdate(data) {
    if (!data) return;
    roomData = data;
    const me = data.students && data.students[studentId];

    if (me && me.word) {
      myWord = me.word;
      myForbidden = me.forbidden || [];
      els.secretWord.textContent = myWord;
      els.forbiddenList.innerHTML = myForbidden
        .map((w) => `<span class="forbidden-pill">${escapeHtml(w)}</span>`)
        .join("");
    } else {
      els.secretWord.textContent = "배정 대기 중...";
      els.forbiddenList.innerHTML = "";
    }

    const round = Number(data.round) || 1;
    currentRound = round;
    applyRoundLocks(round);

    const waitingHeading = els.waiting.querySelector("h2");
    if (data.status === "creating" && me && me.word) {
      els.waiting.classList.add("hidden");
      els.studio.classList.remove("hidden");
    } else if (data.status === "quiz") {
      if (waitingHeading) waitingHeading.textContent = "📺 교실 TV에서 퀴즈쇼가 진행 중입니다! 함께 맞혀 보세요!";
      els.waiting.classList.remove("hidden");
      els.studio.classList.add("hidden");
    } else {
      if (waitingHeading) waitingHeading.textContent = "선생님이 라운드를 시작할 때까지 기다려 주세요!";
      els.waiting.classList.remove("hidden");
      els.studio.classList.add("hidden");
    }

    const subKey = `r${currentRound}_${studentId}`;
    const alreadySubmitted = Boolean(data.submissions && data.submissions[subKey]);
    els.btnSubmit.textContent = alreadySubmitted ? "✅ 제출 완료 (수정 후 재제출)" : "🚀 교실 TV로 제출하기";

    updateTimer();
    checkForbiddenWords();
  }

  /**
   * 현재 라운드에 맞게 허용/잠금 도구 전환 (자물쇠 아이콘 표시)
   */
  function applyRoundLocks(round) {
    const info = ROUND_INFO[round] || ROUND_INFO[1];
    els.roundBadge.textContent = info.badge;
    els.stageTitle.textContent = info.title;
    els.constraintHint.textContent = info.hint;

    // 1R: 그림판 + 정적 글자만 허용
    // 2R: 오디오만 허용 (라디오 파형 고정)
    // 3R: 그림판 + 움직이는 자막/필터 + 오디오 모두 해금
    els.panelDraw.classList.toggle("locked", round === 2);
    els.panelStatic.classList.toggle("locked", round !== 1);
    els.panelVideo.classList.toggle("locked", round !== 3);
    els.panelAudio.classList.toggle("locked", round === 1);

    els.radioLock.classList.toggle("hidden", round !== 2);
    els.staticOverlay.classList.toggle("hidden", round !== 1 || !els.staticText.value.trim());
    els.animOverlay.classList.toggle("hidden", round !== 3 || !els.animText.value.trim());

    updateStaticOverlay();
    updateVideoOverlay();
  }

  function updateStaticOverlay() {
    if (currentRound !== 1) {
      els.staticOverlay.classList.add("hidden");
      return;
    }
    const text = els.staticText.value.trim();
    if (!text) {
      els.staticOverlay.classList.add("hidden");
      return;
    }
    els.staticOverlay.className = `static-text-overlay pos-${els.staticPos.value} ${
      els.staticStyle.value === "bubble" ? "style-bubble" : ""
    }`;
    els.staticOverlay.style.color = els.staticColor.value;
    els.staticOverlay.style.fontSize = `${els.staticSize.value}px`;
    els.staticOverlay.textContent = text;
    els.staticOverlay.classList.remove("hidden");
  }

  function updateVideoOverlay() {
    els.canvasWrap.className = "student-canvas-wrap";
    if (currentRound !== 3) {
      els.animOverlay.classList.add("hidden");
      return;
    }
    const filter = els.screenFilter.value;
    if (filter && filter !== "none") {
      els.canvasWrap.classList.add(`filter-${filter}`);
    }
    const text = els.animText.value.trim();
    if (!text) {
      els.animOverlay.classList.add("hidden");
      return;
    }
    els.animOverlay.className = `anim-subtitle-overlay font-${els.animFont.value} anim-${els.animEffect.value}`;
    els.animOverlay.style.color = els.animColor.value;
    els.animOverlay.textContent = text;
    els.animOverlay.classList.remove("hidden");
  }

  /**
   * 실시간 금지어 검사: 현재 라운드에서 활성화된 텍스트/자막/TTS 대사에
   * 금지어 또는 비밀 제시어 원문이 포함되면 경고 + 제출 차단
   */
  function checkForbiddenWords() {
    let activeTexts = [];
    if (currentRound === 1) {
      activeTexts = [els.staticText.value];
    } else if (currentRound === 2) {
      activeTexts = [els.ttsText.value];
    } else {
      activeTexts = [els.animText.value, els.ttsText.value];
    }
    const combined = activeTexts.join(" ").toLowerCase();
    const blockList = [...(myForbidden || [])];
    if (myWord) blockList.push(myWord);

    const found = blockList.filter((w) => w && combined.includes(w.toLowerCase()));

    if (found.length > 0) {
      els.forbiddenFound.textContent = found.join(", ");
      els.forbiddenAlert.classList.remove("hidden");
      els.btnSubmit.disabled = true;
    } else {
      els.forbiddenAlert.classList.add("hidden");
      els.btnSubmit.disabled = false;
    }
    return found.length === 0;
  }

  // --- 효과음 시퀀스 (최대 3개) ---
  function addSfxSlot() {
    if (sfxList.length >= 3) {
      window.MediaQuizApp.toast("효과음은 최대 3개까지 추가할 수 있습니다.");
      return;
    }
    sfxList.push({ type: "dundun", timing: sfxList.length === 0 ? "start" : sfxList.length === 1 ? "mid" : "end" });
    renderSfxList();
  }

  function renderSfxList() {
    const labels = window.MediaQuizAudio.SFX_LABELS;
    els.sfxContainer.innerHTML = sfxList
      .map(
        (item, idx) => `
      <div class="sfx-item">
        <select class="glass-select sfx-type" data-idx="${idx}">
          ${Object.entries(labels)
            .map(([k, v]) => `<option value="${k}" ${item.type === k ? "selected" : ""}>${v}</option>`)
            .join("")}
        </select>
        <select class="glass-select sfx-timing" data-idx="${idx}">
          <option value="start" ${item.timing === "start" ? "selected" : ""}>시작</option>
          <option value="mid" ${item.timing === "mid" ? "selected" : ""}>중간</option>
          <option value="end" ${item.timing === "end" ? "selected" : ""}>끝</option>
        </select>
        <button type="button" class="btn btn-ghost btn-xs sfx-del" data-idx="${idx}">✕</button>
      </div>`
      )
      .join("");

    els.sfxContainer.querySelectorAll(".sfx-type").forEach((sel) => {
      sel.addEventListener("change", () => {
        sfxList[Number(sel.dataset.idx)].type = sel.value;
        window.MediaQuizAudio.playSFX(sel.value);
      });
    });
    els.sfxContainer.querySelectorAll(".sfx-timing").forEach((sel) => {
      sel.addEventListener("change", () => {
        sfxList[Number(sel.dataset.idx)].timing = sel.value;
      });
    });
    els.sfxContainer.querySelectorAll(".sfx-del").forEach((btn) => {
      btn.addEventListener("click", () => {
        sfxList.splice(Number(btn.dataset.idx), 1);
        renderSfxList();
      });
    });
  }

  async function previewScene() {
    await window.MediaQuizAudio.ensureAudioContext();
    if (currentRound === 1) {
      window.MediaQuizApp.toast("1라운드 인쇄매체는 소리 없이 그림과 글자로만 전달됩니다!");
      return;
    }
    window.MediaQuizAudio.playScene({
      bgm: els.selectBgm.value,
      sfxList,
      ttsText: els.ttsText.value,
      ttsRate: els.ttsRate.value,
      ttsPitch: els.ttsPitch.value
    });
    window.MediaQuizApp.toast("5초 미리보기를 재생합니다!");
  }

  async function submitWork() {
    if (!checkForbiddenWords()) {
      window.MediaQuizApp.toast("금지어를 먼저 지워주세요!");
      return;
    }

    let payload = {};
    if (currentRound === 1) {
      payload = {
        imageData: canvasCtrl.exportImage(),
        staticText: {
          text: els.staticText.value.trim(),
          styleType: els.staticStyle.value,
          position: els.staticPos.value,
          size: Number(els.staticSize.value) || 28,
          color: els.staticColor.value
        }
      };
    } else if (currentRound === 2) {
      payload = {
        ttsText: els.ttsText.value.trim(),
        ttsRate: Number(els.ttsRate.value) || 1.0,
        ttsPitch: Number(els.ttsPitch.value) || 1.0,
        bgm: els.selectBgm.value,
        sfxList: [...sfxList]
      };
    } else {
      payload = {
        imageData: canvasCtrl.exportImage(),
        subtitle: {
          text: els.animText.value.trim(),
          font: els.animFont.value,
          anim: els.animEffect.value,
          color: els.animColor.value
        },
        filter: els.screenFilter.value,
        ttsText: els.ttsText.value.trim(),
        ttsRate: Number(els.ttsRate.value) || 1.0,
        ttsPitch: Number(els.ttsPitch.value) || 1.0,
        bgm: els.selectBgm.value,
        sfxList: [...sfxList]
      };
    }

    const submission = {
      id: `r${currentRound}_${studentId}`,
      round: currentRound,
      studentId,
      nickname,
      word: myWord,
      forbidden: myForbidden,
      submittedAt: Date.now(),
      payload,
      result: null
    };

    await window.MediaQuizSync.submitWork(roomCode, submission);
    window.MediaQuizApp.toast("🚀 교실 TV로 작품을 제출했습니다!");
  }

  function updateTimer() {
    if (timerInterval) clearInterval(timerInterval);
    const tick = () => {
      if (!roomData) return;
      if (roomData.status !== "creating" || !roomData.roundStartedAt) {
        els.timer.textContent = formatMMSS(roomData.timeLimitSec || 180);
        return;
      }
      const elapsed = Math.floor((Date.now() - roomData.roundStartedAt) / 1000);
      const remain = Math.max(0, (roomData.timeLimitSec || 180) - elapsed);
      els.timer.textContent = formatMMSS(remain);
    };
    tick();
    if (roomData.status === "creating") {
      timerInterval = setInterval(tick, 500);
    }
  }

  function cleanup() {
    if (timerInterval) clearInterval(timerInterval);
    window.MediaQuizAudio.stopAll();
    window.MediaQuizSync.disconnect();
    roomCode = null;
    roomData = null;
  }

  function formatMMSS(totalSec) {
    const m = String(Math.floor(totalSec / 60)).padStart(2, "0");
    const s = String(totalSec % 60).padStart(2, "0");
    return `${m}:${s}`;
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  return {
    joinRoom,
    cleanup
  };
})();
