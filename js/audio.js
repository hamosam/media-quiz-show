/**
 * Web Audio API 신시사이저 (BGM & SFX) + Web Speech API (TTS) 엔진
 * 외부 오디오 파일 없이 100% 브라우저 내장 API로 동작합니다.
 */
window.MediaQuizAudio = (function () {
  let ctx = null;
  let activeTimers = [];
  let activeNodes = [];
  let isPlayingScene = false;

  const BGM_LABELS = {
    none: "없음",
    horror: "공포·긴장",
    variety: "신나는 예능",
    docu: "감동 다큐",
    news: "긴급 뉴스"
  };

  const SFX_LABELS = {
    dundun: "두둥 (충격)",
    boing: "띠용 (당황)",
    siren: "사이렌 (긴급)",
    heartbeat: "심장박동 (긴장)",
    dingdong: "딩동댕 (성공)",
    beep: "삐- (경고)"
  };

  const TIMING_OFFSETS = {
    start: 150,
    mid: 2100,
    end: 3900
  };

  function getContext() {
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      ctx = new AudioCtx();
    }
    return ctx;
  }

  /**
   * 브라우저 자동재생 정책 우회를 위해 클릭 이벤트 시 반드시 호출
   */
  async function ensureAudioContext() {
    const audioCtx = getContext();
    if (audioCtx.state === "suspended") {
      try {
        await audioCtx.resume();
      } catch (e) {
        console.warn("AudioContext resume warning:", e);
      }
    }
    return audioCtx;
  }

  function registerNode(node) {
    activeNodes.push(node);
    return node;
  }

  function registerTimer(id) {
    activeTimers.push(id);
    return id;
  }

  function stopAll() {
    isPlayingScene = false;
    activeTimers.forEach((id) => clearTimeout(id));
    activeTimers = [];

    activeNodes.forEach((node) => {
      try {
        if (typeof node.stop === "function") node.stop();
        if (typeof node.disconnect === "function") node.disconnect();
      } catch (_) {}
    });
    activeNodes = [];

    if ("speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (_) {}
    }
  }

  // --- 기본 톤 생성 헬퍼 ---
  function playTone(audioCtx, freq, startTime, duration, type = "sine", gainPeak = 0.2, freqEnd = null) {
    const osc = registerNode(audioCtx.createOscillator());
    const gain = registerNode(audioCtx.createGain());

    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);
    if (freqEnd !== null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), startTime + duration);
    }

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(gainPeak, startTime + Math.min(0.03, duration * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }

  // --- 1. 효과음 (SFX) ---
  async function playSFX(sfxType) {
    if (!sfxType) return;
    const audioCtx = await ensureAudioContext();
    const now = audioCtx.currentTime;

    switch (sfxType) {
      case "dundun": {
        // 두둥 (충격): 낮은 임팩트 2연타
        playTone(audioCtx, 130, now, 0.25, "triangle", 0.45, 55);
        playTone(audioCtx, 98, now + 0.22, 0.7, "sawtooth", 0.28, 38);
        playTone(audioCtx, 65, now + 0.22, 0.75, "sine", 0.5, 32);
        break;
      }
      case "boing": {
        // 띠용 (당황): 음높이 휘어지는 사인파
        const osc = registerNode(audioCtx.createOscillator());
        const gain = registerNode(audioCtx.createGain());
        osc.type = "sine";
        osc.frequency.setValueAtTime(240, now);
        osc.frequency.exponentialRampToValueAtTime(680, now + 0.14);
        osc.frequency.exponentialRampToValueAtTime(320, now + 0.35);
        osc.frequency.exponentialRampToValueAtTime(520, now + 0.55);
        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.68);
        break;
      }
      case "siren": {
        // 사이렌 (긴급): 고저 왕복
        const osc = registerNode(audioCtx.createOscillator());
        const gain = registerNode(audioCtx.createGain());
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(620, now);
        osc.frequency.linearRampToValueAtTime(980, now + 0.3);
        osc.frequency.linearRampToValueAtTime(620, now + 0.6);
        osc.frequency.linearRampToValueAtTime(980, now + 0.9);
        osc.frequency.linearRampToValueAtTime(620, now + 1.2);
        gain.gain.setValueAtTime(0.16, now);
        gain.gain.setValueAtTime(0.16, now + 1.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 1.25);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 1.28);
        break;
      }
      case "heartbeat": {
        // 심장박동 (긴장): 쿵-쿵 2세트
        [0, 0.75].forEach((offset) => {
          playTone(audioCtx, 75, now + offset, 0.16, "sine", 0.55, 36);
          playTone(audioCtx, 68, now + offset + 0.2, 0.2, "sine", 0.42, 32);
        });
        break;
      }
      case "dingdong": {
        // 딩동댕 (성공): 도-미-솔-도
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((freq, idx) => {
          playTone(audioCtx, freq, now + idx * 0.13, 0.4, "triangle", 0.25);
        });
        break;
      }
      case "beep": {
        // 삐- (경고/묵음)
        playTone(audioCtx, 1000, now, 0.55, "square", 0.15);
        break;
      }
    }
  }

  // --- 2. 배경음악 (BGM, 5초 분량) ---
  async function playBGM(bgmType, durationSec = 5) {
    if (!bgmType || bgmType === "none") return;
    const audioCtx = await ensureAudioContext();
    const now = audioCtx.currentTime;

    if (bgmType === "horror") {
      // 공포·긴장: 낮은 드론 + 불협화음 아르페지오
      playTone(audioCtx, 55, now, durationSec, "sawtooth", 0.08);
      playTone(audioCtx, 58.27, now, durationSec, "sine", 0.12);
      const eerieNotes = [220, 233.08, 277.18, 207.65, 220, 196];
      eerieNotes.forEach((f, idx) => {
        const t = now + idx * 0.75;
        if (t < now + durationSec - 0.3) {
          playTone(audioCtx, f, t, 0.65, "triangle", 0.09);
        }
      });
    } else if (bgmType === "variety") {
      // 신나는 예능: 통통 튀는 메이저 리듬
      const pattern = [523.25, 659.25, 783.99, 659.25, 880, 783.99, 659.25, 587.33];
      const step = 0.24;
      const totalSteps = Math.floor(durationSec / step);
      for (let i = 0; i < totalSteps; i++) {
        const freq = pattern[i % pattern.length];
        playTone(audioCtx, freq, now + i * step, 0.16, "triangle", 0.12);
        if (i % 2 === 0) {
          playTone(audioCtx, 130.81, now + i * step, 0.14, "sine", 0.15);
        }
      }
    } else if (bgmType === "docu") {
      // 감동 다큐: 따뜻한 패드 화음 진행
      const chords = [
        [261.63, 329.63, 392.0], // C
        [220.0, 261.63, 329.63], // Am
        [174.61, 220.0, 261.63], // F
        [196.0, 246.94, 293.66]  // G
      ];
      const chordDur = durationSec / chords.length;
      chords.forEach((chord, idx) => {
        const t = now + idx * chordDur;
        chord.forEach((f) => {
          playTone(audioCtx, f, t, chordDur * 0.95, "sine", 0.08);
        });
      });
    } else if (bgmType === "news") {
      // 긴급 뉴스: 스타카토 펄스 + 긴박한 고음 모티프
      const step = 0.2;
      const totalSteps = Math.floor(durationSec / step);
      for (let i = 0; i < totalSteps; i++) {
        const isAccent = i % 4 === 0;
        playTone(audioCtx, isAccent ? 880 : 440, now + i * step, 0.09, "square", isAccent ? 0.08 : 0.04);
        if (i % 2 === 0) {
          playTone(audioCtx, 110, now + i * step, 0.1, "triangle", 0.14);
        }
      }
    }
  }

  // --- 3. 음성 합성 (TTS) ---
  let cachedVoices = [];
  if ("speechSynthesis" in window) {
    cachedVoices = window.speechSynthesis.getVoices() || [];
    window.speechSynthesis.onvoiceschanged = () => {
      cachedVoices = window.speechSynthesis.getVoices() || [];
    };
  }

  function speakTTS(text, rate = 1.0, pitch = 1.0) {
    if (!text || !text.trim()) return;
    if (!("speechSynthesis" in window)) {
      console.warn("Web Speech API is not supported in this browser.");
      return;
    }

    const doSpeak = () => {
      const utter = new SpeechSynthesisUtterance(text.trim());
      utter.lang = "ko-KR";
      utter.rate = Math.min(2.0, Math.max(0.5, Number(rate) || 1.0));
      utter.pitch = Math.min(2.0, Math.max(0.5, Number(pitch) || 1.0));

      const voices = cachedVoices.length ? cachedVoices : window.speechSynthesis.getVoices();
      const koVoice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith("ko"));
      if (koVoice) utter.voice = koVoice;

      window.speechSynthesis.speak(utter);
    };

    if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
      window.speechSynthesis.cancel();
      registerTimer(setTimeout(doSpeak, 45));
    } else {
      doSpeak();
    }
  }

  /**
   * 5초 복합 씬 동기화 재생 (BGM + SFX 시퀀스 + TTS)
   * @param {Object} sceneConfig { bgm, sfxList: [{type, timing}], ttsText, ttsRate, ttsPitch }
   * @param {Function} onProgress (percent) => void
   * @param {Function} onComplete () => void
   */
  async function playScene(sceneConfig, onProgress, onComplete) {
    stopAll();
    await ensureAudioContext();
    isPlayingScene = true;

    const DURATION_MS = 5000;
    const startTime = Date.now();

    // 1) BGM 시작
    if (sceneConfig.bgm && sceneConfig.bgm !== "none") {
      playBGM(sceneConfig.bgm, 5);
    }

    // 2) TTS 시작 (약간 텀을 두고 시작해 BGM과 어우러지게)
    if (sceneConfig.ttsText && sceneConfig.ttsText.trim()) {
      const ttsTimer = registerTimer(
        setTimeout(() => {
          if (isPlayingScene) {
            speakTTS(sceneConfig.ttsText, sceneConfig.ttsRate, sceneConfig.ttsPitch);
          }
        }, 250)
      );
      void ttsTimer;
    }

    // 3) SFX 시퀀스 예약 (최대 3개)
    const sfxList = Array.isArray(sceneConfig.sfxList) ? sceneConfig.sfxList.slice(0, 3) : [];
    sfxList.forEach((item) => {
      if (!item || !item.type) return;
      const delay = TIMING_OFFSETS[item.timing] ?? 150;
      registerTimer(
        setTimeout(() => {
          if (isPlayingScene) {
            playSFX(item.type);
          }
        }, delay)
      );
    });

    // 4) 진행률 콜백
    const tickInterval = setInterval(() => {
      if (!isPlayingScene) {
        clearInterval(tickInterval);
        return;
      }
      const elapsed = Date.now() - startTime;
      const pct = Math.min(100, Math.round((elapsed / DURATION_MS) * 100));
      if (onProgress) onProgress(pct);
      if (elapsed >= DURATION_MS) {
        clearInterval(tickInterval);
      }
    }, 80);

    // 5) 5초 후 종료 처리
    registerTimer(
      setTimeout(() => {
        clearInterval(tickInterval);
        isPlayingScene = false;
        if (onProgress) onProgress(100);
        if (onComplete) onComplete();
      }, DURATION_MS)
    );
  }

  return {
    BGM_LABELS,
    SFX_LABELS,
    ensureAudioContext,
    playSFX,
    playBGM,
    speakTTS,
    playScene,
    stopAll
  };
})();
