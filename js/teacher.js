/**
 * 교사 화면 (TV 퀴즈쇼 호스트) 컨트롤러
 */
window.MediaQuizTeacher = (function () {
  const ROUND_NAMES = {
    1: "1라운드 · 인쇄매체",
    2: "2라운드 · 음성매체",
    3: "3라운드 · 영상매체(복합)"
  };

  const HELPFUL_ELEMENTS = [
    "그림·사진",
    "정적 글자·말풍선",
    "목소리(TTS)",
    "배경음악(BGM)",
    "효과음(SFX)",
    "움직이는 자막",
    "화면 필터"
  ];

  let roomCode = null;
  let roomData = null;
  let selectedRound = 1;
  let quizRoundFilter = 1;
  let currentSubIndex = 0;
  let hintRevealed = false;

  let countdownInterval = null;
  let stopwatchInterval = null;
  let stopwatchMs = 0;
  let stopwatchRunning = false;

  // DOM 캐시
  const els = {};

  function cacheDom() {
    els.roomCode = document.getElementById("teacher-room-code");
    els.syncBadge = document.getElementById("teacher-sync-badge");
    els.navTabs = document.querySelectorAll("[data-teacher-tab]");
    els.panels = document.querySelectorAll(".teacher-panel");
    els.roundBtns = document.querySelectorAll(".round-btn");
    els.timeLimit = document.getElementById("select-time-limit");
    els.countdown = document.getElementById("teacher-countdown");
    els.btnStartRound = document.getElementById("btn-start-round");
    els.btnManageWords = document.getElementById("btn-manage-words");
    els.wordPoolCount = document.getElementById("word-pool-count");
    els.btnGotoQuiz = document.getElementById("btn-goto-quiz");
    els.submitCount = document.getElementById("teacher-submit-count");
    els.submitBar = document.getElementById("teacher-submit-bar");
    els.studentTotal = document.getElementById("teacher-student-total");
    els.studentList = document.getElementById("teacher-student-list");
    els.btnFillDemo = document.getElementById("btn-fill-demo");
    els.demoHelperBox = document.getElementById("demo-helper-box");

    // 제시어 모달
    els.modalWords = document.getElementById("modal-words");
    els.btnCloseWordsModal = document.getElementById("btn-close-words-modal");
    els.formAddWord = document.getElementById("form-add-word");
    els.inputCustomWord = document.getElementById("input-custom-word");
    els.inputCustomForbidden = document.getElementById("input-custom-forbidden");
    els.customWordsList = document.getElementById("custom-words-list");

    // 퀴즈 무대
    els.quizRoundPills = document.querySelectorAll("[data-quiz-round]");
    els.btnPrevSub = document.getElementById("btn-prev-sub");
    els.btnNextSub = document.getElementById("btn-next-sub");
    els.subCounter = document.getElementById("quiz-sub-counter");
    els.stopwatch = document.getElementById("quiz-stopwatch");
    els.stageMediaBadge = document.getElementById("stage-media-badge");
    els.stageCreatorBadge = document.getElementById("stage-creator-badge");
    els.stageViewport = document.getElementById("stage-viewport");
    els.stagePlayProgress = document.getElementById("stage-play-progress");
    els.stagePlayBar = document.getElementById("stage-play-bar");
    els.stageHintBanner = document.getElementById("stage-hint-banner");
    els.stageHintText = document.getElementById("stage-hint-text");
    els.answerReveal = document.getElementById("stage-answer-reveal");
    els.revealStatusTag = document.getElementById("reveal-status-tag");
    els.revealWordText = document.getElementById("reveal-word-text");
    els.revealMetaText = document.getElementById("reveal-meta-text");
    els.btnPlayWork = document.getElementById("btn-play-work");
    els.btnChosungHint = document.getElementById("btn-chosung-hint");
    els.btnPeekAnswer = document.getElementById("btn-peek-answer");
    els.btnMarkCorrect = document.getElementById("btn-mark-correct");
    els.btnMarkPass = document.getElementById("btn-mark-pass");
    els.helpfulElementTags = document.getElementById("helpful-element-tags");
    els.submissionDots = document.getElementById("quiz-submission-dots");

    // 대시보드
    els.chartAccuracy = document.getElementById("chart-accuracy");
    els.chartTime = document.getElementById("chart-time");
    els.dashboardInsight = document.getElementById("dashboard-insight");
    els.dashboardTopElements = document.getElementById("dashboard-top-elements");
    els.btnExportReport = document.getElementById("btn-export-report");
    els.btnRefreshDashboard = document.getElementById("btn-refresh-dashboard");
    els.btnExit = document.getElementById("btn-teacher-exit");
  }

  function bindEvents() {
    els.navTabs.forEach((tab) => {
      tab.addEventListener("click", () => switchTab(tab.dataset.teacherTab));
    });

    els.roundBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedRound = Number(btn.dataset.round);
        els.roundBtns.forEach((b) => b.classList.toggle("active", b === btn));
        if (roomCode) {
          window.MediaQuizSync.updateRoom(roomCode, { round: selectedRound });
        }
      });
    });

    els.timeLimit.addEventListener("change", () => {
      const sec = Number(els.timeLimit.value);
      els.countdown.textContent = formatMMSS(sec);
      if (roomCode) {
        window.MediaQuizSync.updateRoom(roomCode, { timeLimitSec: sec });
      }
    });

    els.btnStartRound.addEventListener("click", startRoundAndAssignWords);
    els.btnManageWords.addEventListener("click", openWordsModal);
    els.btnCloseWordsModal.addEventListener("click", () => els.modalWords.classList.add("hidden"));
    els.formAddWord.addEventListener("submit", addCustomWord);
    els.btnGotoQuiz.addEventListener("click", async () => {
      if (roomCode) {
        await window.MediaQuizSync.updateRoom(roomCode, { status: "quiz" });
      }
      quizRoundFilter = selectedRound;
      currentSubIndex = 0;
      syncQuizRoundPills();
      switchTab("quiz");
      renderQuizStage();
    });

    els.btnFillDemo.addEventListener("click", fillDemoData);

    els.quizRoundPills.forEach((pill) => {
      pill.addEventListener("click", () => {
        quizRoundFilter = Number(pill.dataset.quizRound);
        currentSubIndex = 0;
        hintRevealed = false;
        syncQuizRoundPills();
        resetStopwatch();
        window.MediaQuizAudio.stopAll();
        renderQuizStage();
      });
    });

    els.btnPrevSub.addEventListener("click", () => moveSubmission(-1));
    els.btnNextSub.addEventListener("click", () => moveSubmission(1));
    els.btnPlayWork.addEventListener("click", playCurrentSubmission);
    els.btnChosungHint.addEventListener("click", revealChosungHint);

    // 교사 모니터 앞에서 누르고 있는 동안만 작은 글씨로 정답 살짝 표시
    const showPeek = () => {
      const subs = getFilteredSubmissions();
      if (!subs.length) return;
      const sub = subs[currentSubIndex];
      els.btnPeekAnswer.textContent = `정답: ${sub.word}`;
      els.btnPeekAnswer.classList.add("peeking");
    };
    const hidePeek = () => {
      els.btnPeekAnswer.textContent = "👀 교사 확인(누르는 동안)";
      els.btnPeekAnswer.classList.remove("peeking");
    };
    els.btnPeekAnswer.addEventListener("pointerdown", showPeek);
    els.btnPeekAnswer.addEventListener("pointerup", hidePeek);
    els.btnPeekAnswer.addEventListener("pointerleave", hidePeek);
    els.btnPeekAnswer.addEventListener("pointercancel", hidePeek);

    els.btnMarkCorrect.addEventListener("click", () => judgeSubmission("correct"));
    els.btnMarkPass.addEventListener("click", () => judgeSubmission("pass"));
    els.btnExportReport.addEventListener("click", exportClassReport);
    els.btnRefreshDashboard.addEventListener("click", renderDashboard);

    els.btnExit.addEventListener("click", () => {
      cleanup();
      window.MediaQuizApp.showStartView();
    });
  }

  function switchTab(tabName) {
    window.MediaQuizAudio.stopAll();
    els.navTabs.forEach((t) => t.classList.toggle("active", t.dataset.teacherTab === tabName));
    els.panels.forEach((p) => p.classList.toggle("active", p.id === `teacher-${tabName}`));

    if (tabName === "quiz") {
      renderQuizStage();
    } else if (tabName === "dashboard") {
      renderDashboard();
    }
  }

  function syncQuizRoundPills() {
    els.quizRoundPills.forEach((p) =>
      p.classList.toggle("active", Number(p.dataset.quizRound) === quizRoundFilter)
    );
  }

  async function initRoom(code) {
    if (!els.roomCode) {
      cacheDom();
      bindEvents();
    }
    roomCode = code;
    currentSubIndex = 0;
    hintRevealed = false;
    resetStopwatch();
    els.roomCode.textContent = code;
    els.wordPoolCount.textContent = (window.MediaQuizWords || []).length;
    els.syncBadge.textContent = window.MediaQuizSync.isDemoMode() ? "로컬 데모" : "MQTT 실시간";
    els.demoHelperBox.classList.remove("hidden");

    await window.MediaQuizSync.createRoom(code);
    window.MediaQuizSync.subscribeRoom(code, onRoomUpdate);
    switchTab("lobby");
  }

  function onRoomUpdate(data) {
    if (!data) return;
    roomData = data;
    selectedRound = data.round || 1;
    els.roundBtns.forEach((b) => b.classList.toggle("active", Number(b.dataset.round) === selectedRound));

    renderStudentLobby();
    updateCountdownTimer();

    // 현재 퀴즈 무대 탭이 열려 있으면 갱신
    if (document.getElementById("teacher-quiz").classList.contains("active")) {
      renderQuizStage();
    }
  }

  function renderStudentLobby() {
    const studentsMap = roomData.students || {};
    const students = Object.values(studentsMap);
    const submissionsMap = roomData.submissions || {};

    els.studentTotal.textContent = students.length;

    let submittedCount = 0;
    if (students.length === 0) {
      els.studentList.innerHTML = `
        <div class="empty-state">
          아직 입장한 학생이 없습니다.<br />
          화면 상단의 방 코드 <strong>${roomCode}</strong>를 학생들에게 안내해 주세요.
        </div>`;
    } else {
      els.studentList.innerHTML = students
        .map((st) => {
          const subKey = `r${selectedRound}_${st.id}`;
          const isSub = Boolean(submissionsMap[subKey]);
          if (isSub) submittedCount++;
          return `
            <div class="student-chip ${isSub ? "submitted" : ""}">
              <span class="st-name">${escapeHtml(st.nickname)}</span>
              <span class="st-status">${isSub ? "✅ 제출 완료" : st.word ? "✏️ 제작 중" : "⏳ 대기 중"}</span>
            </div>`;
        })
        .join("");
    }

    const total = students.length;
    const pct = total > 0 ? Math.round((submittedCount / total) * 100) : 0;
    els.submitCount.textContent = `${submittedCount} / ${total} 제출 완료`;
    els.submitBar.style.width = `${pct}%`;
  }

  function shuffleArray(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  /**
   * 접속한 학생들에게 이전 라운드와도 겹치지 않게 비밀 제시어·금지어 자동 배정 + 제작 시작
   */
  async function startRoundAndAssignWords() {
    if (!roomData) return;
    const studentsMap = { ...(roomData.students || {}) };
    const studentIds = Object.keys(studentsMap);

    if (studentIds.length === 0) {
      window.MediaQuizApp.toast("먼저 학생이 1명 이상 입장해야 합니다! (또는 아래 데모 채우기를 눌러보세요)");
      return;
    }

    const allWords = window.MediaQuizWords || [];
    let usedWordIds = Array.isArray(roomData.usedWordIds) ? [...roomData.usedWordIds] : [];
    const usedSet = new Set(usedWordIds);

    // 이전 라운드에서 아직 한 번도 안 나온 제시어를 우선 배정
    let unusedPool = shuffleArray(allWords.filter((w) => !usedSet.has(w.id)));
    if (unusedPool.length < studentIds.length) {
      // 만약 전체 90개를 다 소진했을 때만 부족분 보충 (현재 남은 미사용 단어는 맨 앞에 유지)
      const remainingIds = new Set(unusedPool.map((w) => w.id));
      const recycledPool = shuffleArray(allWords.filter((w) => !remainingIds.has(w.id)));
      unusedPool = [...unusedPool, ...recycledPool];
      usedWordIds = [];
    }

    studentIds.forEach((id, idx) => {
      const item = unusedPool[idx % unusedPool.length];
      if (!usedWordIds.includes(item.id)) {
        usedWordIds.push(item.id);
      }
      studentsMap[id] = {
        ...studentsMap[id],
        wordId: item.id,
        word: item.word,
        forbidden: item.forbidden
      };
    });

    const timeLimitSec = Number(els.timeLimit.value) || 180;
    await window.MediaQuizSync.updateStudents(roomCode, studentsMap);
    await window.MediaQuizSync.updateRoom(roomCode, {
      round: selectedRound,
      status: "creating",
      timeLimitSec,
      roundStartedAt: Date.now(),
      usedWordIds
    });

    window.MediaQuizApp.toast(`${ROUND_NAMES[selectedRound]} 시작! 중복 없는 새 비밀 제시어가 배정되었습니다.`);
  }

  function updateCountdownTimer() {
    if (countdownInterval) clearInterval(countdownInterval);

    const tick = () => {
      if (!roomData) return;
      if (roomData.status !== "creating" || !roomData.roundStartedAt) {
        els.countdown.textContent = formatMMSS(roomData.timeLimitSec || 180);
        return;
      }
      const elapsed = Math.floor((Date.now() - roomData.roundStartedAt) / 1000);
      const remain = Math.max(0, (roomData.timeLimitSec || 180) - elapsed);
      els.countdown.textContent = formatMMSS(remain);
    };

    tick();
    if (roomData.status === "creating") {
      countdownInterval = setInterval(tick, 500);
    }
  }

  // --- 퀴즈쇼 무대 ---
  function getFilteredSubmissions() {
    if (!roomData || !roomData.submissions) return [];
    return Object.values(roomData.submissions)
      .filter((s) => Number(s.round) === quizRoundFilter)
      .sort((a, b) => (a.submittedAt || 0) - (b.submittedAt || 0));
  }

  function renderQuizStage() {
    const subs = getFilteredSubmissions();
    els.stageMediaBadge.textContent = ROUND_NAMES[quizRoundFilter];
    els.stagePlayProgress.classList.add("hidden");
    els.stagePlayBar.style.width = "0%";

    if (subs.length === 0) {
      els.subCounter.textContent = "0 / 0";
      els.stageCreatorBadge.textContent = "출제자: -";
      els.stageViewport.className = "stage-viewport";
      els.stageViewport.innerHTML = `<div class="empty-state">이 라운드에 제출된 작품이 아직 없습니다.</div>`;
      els.stageHintBanner.classList.add("hidden");
      els.answerReveal.classList.add("hidden");
      els.helpfulElementTags.innerHTML = "";
      els.submissionDots.innerHTML = "";
      return;
    }

    if (currentSubIndex >= subs.length) currentSubIndex = subs.length - 1;
    if (currentSubIndex < 0) currentSubIndex = 0;

    const sub = subs[currentSubIndex];
    els.subCounter.textContent = `${currentSubIndex + 1} / ${subs.length}`;
    els.stageCreatorBadge.textContent = sub.result
      ? `출제자: ${sub.nickname}`
      : `출제자: ${sub.nickname} (본인은 정답 쉿! 🤫)`;

    // 초성 힌트 배너 상태
    if (hintRevealed && !sub.result) {
      els.stageHintText.textContent = getChosung(sub.word);
      els.stageHintBanner.classList.remove("hidden");
    } else {
      els.stageHintBanner.classList.add("hidden");
    }

    // 도움이 된 매체 요소 태그 렌더링
    const selectedTag = sub.result && sub.result.helpfulElement ? sub.result.helpfulElement : "";
    els.helpfulElementTags.innerHTML = HELPFUL_ELEMENTS.map(
      (elName) =>
        `<button type="button" class="helpful-tag-btn ${
          selectedTag === elName ? "active" : ""
        }" data-el-tag="${elName}">${elName}</button>`
    ).join("");
    els.helpfulElementTags.querySelectorAll(".helpful-tag-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!sub.result) {
          window.MediaQuizApp.toast("먼저 [정답!] 또는 [패스]로 채점해 주세요.");
          return;
        }
        await window.MediaQuizSync.recordSubmissionResult(roomCode, sub.id, {
          ...sub.result,
          helpfulElement: btn.dataset.elTag
        });
        window.MediaQuizApp.toast(`결정적 요소 [${btn.dataset.elTag}] 기록됨`);
      });
    });

    // 도트 네비게이션
    els.submissionDots.innerHTML = subs
      .map((s, idx) => {
        const cls = [
          "sub-dot",
          idx === currentSubIndex ? "active" : "",
          s.result?.status === "correct" ? "done-correct" : "",
          s.result?.status === "pass" ? "done-pass" : ""
        ]
          .filter(Boolean)
          .join(" ");
        return `<button class="${cls}" data-dot-idx="${idx}">${idx + 1}</button>`;
      })
      .join("");

    els.submissionDots.querySelectorAll(".sub-dot").forEach((dot) => {
      dot.addEventListener("click", () => {
        currentSubIndex = Number(dot.dataset.dotIdx);
        hintRevealed = false;
        resetStopwatch();
        window.MediaQuizAudio.stopAll();
        renderQuizStage();
      });
    });

    // 작품 렌더링
    const p = sub.payload || {};
    els.stageViewport.className = "stage-viewport";
    if (quizRoundFilter === 3 && p.filter && p.filter !== "none") {
      els.stageViewport.classList.add(`filter-${p.filter}`);
    }

    if (quizRoundFilter === 1) {
      // 1라운드: 인쇄매체 (이미지 + 정적 텍스트/말풍선)
      const st = p.staticText || {};
      const textHtml = st.text
        ? `<div class="static-text-overlay pos-${st.position || "bottom"} ${
            st.styleType === "bubble" ? "style-bubble" : ""
          }" style="color:${st.color || "#1c1c1e"};font-size:${st.size || 28}px;">${escapeHtml(st.text)}</div>`
        : "";
      els.stageViewport.innerHTML = `
        <img class="stage-img" src="${p.imageData || ""}" alt="학생 인쇄매체 작품" />
        ${textHtml}
      `;
    } else if (quizRoundFilter === 2) {
      // 2라운드: 음성매체 (라디오 파형 + 오디오 정보)
      const bgmLabel = window.MediaQuizAudio.BGM_LABELS[p.bgm || "none"] || "없음";
      const sfxCount = Array.isArray(p.sfxList) ? p.sfxList.length : 0;
      els.stageViewport.innerHTML = `
        <div class="radio-lock-overlay">
          <div class="radio-badge">📻 2라운드 음성매체 작품</div>
          <div class="waveform-bars" aria-hidden="true">
            <span></span><span></span><span></span><span></span><span></span>
            <span></span><span></span><span></span><span></span><span></span>
            <span></span><span></span><span></span><span></span><span></span>
          </div>
          <p><strong>[작품 재생]</strong> 버튼을 눌러 소리를 들어보세요!<br/>
          <small>BGM: ${bgmLabel} · 효과음 ${sfxCount}개</small></p>
        </div>
      `;
    } else {
      // 3라운드: 영상매체 (이미지 + 화면 필터 + 움직이는 자막 + 오디오)
      const subCfg = p.subtitle || {};
      const subHtml = subCfg.text
        ? `<div class="anim-subtitle-overlay font-${subCfg.font || "gothic"} anim-${subCfg.anim || "bounce"}" style="color:${
            subCfg.color || "#ff3b30"
          };">${escapeHtml(subCfg.text)}</div>`
        : "";
      els.stageViewport.innerHTML = `
        <img class="stage-img" src="${p.imageData || ""}" alt="학생 영상매체 작품" />
        ${subHtml}
      `;
    }

    // 정답 공개 배너 상태 및 스톱워치 자동 카운트
    if (sub.result) {
      stopStopwatch();
      els.stopwatch.textContent = `${sub.result.timeSec.toFixed(1)}초`;
      els.answerReveal.classList.remove("hidden");
      els.revealStatusTag.textContent = sub.result.status === "correct" ? "🎉 정답입니다!" : "⏭ 패스 (정답 공개)";
      els.revealWordText.textContent = sub.word;
      els.revealMetaText.textContent = `출제자: ${sub.nickname} · 소요 시간: ${sub.result.timeSec.toFixed(1)}초`;
    } else {
      els.answerReveal.classList.add("hidden");
      if (document.getElementById("teacher-quiz").classList.contains("active") && !stopwatchRunning) {
        startStopwatch();
      }
    }
  }

  function moveSubmission(delta) {
    const subs = getFilteredSubmissions();
    if (subs.length === 0) return;
    currentSubIndex = (currentSubIndex + delta + subs.length) % subs.length;
    hintRevealed = false;
    resetStopwatch();
    window.MediaQuizAudio.stopAll();
    renderQuizStage();
  }

  function revealChosungHint() {
    const subs = getFilteredSubmissions();
    if (subs.length === 0) return;
    hintRevealed = true;
    renderQuizStage();
  }

  function getChosung(text) {
    const CHOSUNG = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
    return Array.from(String(text || ""))
      .map((ch) => {
        const code = ch.charCodeAt(0);
        if (code >= 0xac00 && code <= 0xd7a3) {
          return CHOSUNG[Math.floor((code - 0xac00) / 588)];
        }
        return ch;
      })
      .join("");
  }

  /**
   * 교사 화면 [작품 재생 / 다시 보기] 클릭:
   * 반드시 AudioContext.resume()을 실행해 브라우저 자동재생 정책을 통과
   */
  async function playCurrentSubmission() {
    const subs = getFilteredSubmissions();
    if (subs.length === 0) return;
    const sub = subs[currentSubIndex];
    const p = sub.payload || {};

    await window.MediaQuizAudio.ensureAudioContext();

    // 아직 채점 전이면 스톱워치 자동 시작
    if (!sub.result && !stopwatchRunning) {
      startStopwatch();
    }

    if (quizRoundFilter === 1) {
      window.MediaQuizApp.toast("인쇄매체는 정적 시각 자료입니다. 그림과 글자를 보고 맞혀보세요!");
      return;
    }

    els.stagePlayProgress.classList.remove("hidden");
    els.stagePlayBar.style.width = "0%";

    window.MediaQuizAudio.playScene(
      {
        bgm: p.bgm || "none",
        sfxList: p.sfxList || [],
        ttsText: p.ttsText || "",
        ttsRate: p.ttsRate || 1.0,
        ttsPitch: p.ttsPitch || 1.0
      },
      (pct) => {
        els.stagePlayBar.style.width = `${pct}%`;
      },
      () => {
        // 재생 완료
      }
    );
  }

  // --- 스톱워치 ---
  function startStopwatch() {
    if (stopwatchRunning) return;
    stopwatchRunning = true;
    const startedAt = Date.now() - stopwatchMs;
    stopwatchInterval = setInterval(() => {
      stopwatchMs = Date.now() - startedAt;
      els.stopwatch.textContent = `${(stopwatchMs / 1000).toFixed(1)}초`;
    }, 100);
  }

  function stopStopwatch() {
    stopwatchRunning = false;
    if (stopwatchInterval) {
      clearInterval(stopwatchInterval);
      stopwatchInterval = null;
    }
  }

  function resetStopwatch() {
    stopStopwatch();
    stopwatchMs = 0;
    els.stopwatch.textContent = "00.0초";
  }

  async function judgeSubmission(status) {
    const subs = getFilteredSubmissions();
    if (subs.length === 0) return;
    const sub = subs[currentSubIndex];

    stopStopwatch();
    window.MediaQuizAudio.stopAll();

    const timeSec = Math.max(0.5, Number((stopwatchMs / 1000).toFixed(1)) || 5.0);
    await window.MediaQuizSync.recordSubmissionResult(roomCode, sub.id, {
      status,
      timeSec,
      helpfulElement: sub.result?.helpfulElement || null
    });

    if (status === "correct") {
      await window.MediaQuizAudio.ensureAudioContext();
      window.MediaQuizAudio.playSFX("dingdong");
      launchConfetti();
    }
    renderQuizStage();
  }

  // --- 수업 정리 대시보드 ---
  function renderDashboard() {
    const allSubs = roomData && roomData.submissions ? Object.values(roomData.submissions) : [];
    const stats = [1, 2, 3].map((r) => {
      const roundSubs = allSubs.filter((s) => Number(s.round) === r && s.result);
      const correctSubs = roundSubs.filter((s) => s.result.status === "correct");
      const accuracy = roundSubs.length > 0 ? Math.round((correctSubs.length / roundSubs.length) * 100) : 0;
      const avgTime =
        correctSubs.length > 0
          ? Number((correctSubs.reduce((acc, s) => acc + (s.result.timeSec || 0), 0) / correctSubs.length).toFixed(1))
          : 0;
      return {
        round: r,
        label: r === 1 ? "1R 인쇄매체" : r === 2 ? "2R 음성매체" : "3R 영상매체(복합)",
        barClass: `bar-r${r}`,
        total: roundSubs.length,
        accuracy,
        avgTime
      };
    });

    els.chartAccuracy.innerHTML = stats
      .map(
        (st) => `
      <div class="bar-row">
        <div class="bar-label-row">
          <span>${st.label} (${st.total}작품 채점)</span>
          <strong>${st.accuracy}%</strong>
        </div>
        <div class="bar-track">
          <div class="bar-fill ${st.barClass}" style="width: ${Math.max(4, st.accuracy)}%">${st.accuracy}%</div>
        </div>
      </div>`
      )
      .join("");

    const maxTime = Math.max(10, ...stats.map((s) => s.avgTime));
    els.chartTime.innerHTML = stats
      .map((st) => {
        const pct = st.avgTime > 0 ? Math.round((st.avgTime / maxTime) * 100) : 0;
        return `
      <div class="bar-row">
        <div class="bar-label-row">
          <span>${st.label}</span>
          <strong>${st.avgTime > 0 ? st.avgTime + "초" : "기록 없음"}</strong>
        </div>
        <div class="bar-track">
          <div class="bar-fill ${st.barClass}" style="width: ${Math.max(4, pct)}%">${
          st.avgTime > 0 ? st.avgTime + "초" : "-"
        }</div>
        </div>
      </div>`;
      })
      .join("");

    const validStats = stats.filter((s) => s.total > 0);
    if (validStats.length === 0) {
      els.dashboardInsight.textContent =
        "퀴즈쇼 무대에서 각 라운드 작품을 채점하면 이곳에 우리 반의 매체별 비교 요약이 나타납니다.";
    } else {
      const bestAcc = [...validStats].sort((a, b) => b.accuracy - a.accuracy)[0];
      const fastest = [...validStats].filter((s) => s.avgTime > 0).sort((a, b) => a.avgTime - b.avgTime)[0];
      els.dashboardInsight.innerHTML = `
        • 가장 높은 정답률을 기록한 매체는 <strong>${bestAcc.label} (${bestAcc.accuracy}%)</strong>입니다.<br/>
        ${
          fastest
            ? `• 가장 빠르게 뜻을 전달한 매체는 <strong>${fastest.label} (평균 ${fastest.avgTime}초)</strong>입니다.<br/>`
            : ""
        }
        • 토의 질문: <em>"그림만 있을 때, 소리만 있을 때, 그리고 자막·효과음·움직임을 함께 썼을 때 전달력이 어떻게 달라졌나요?"</em>
      `;
    }

    // 결정적 매체 요소 집계
    const tagCounts = {};
    allSubs.forEach((s) => {
      const tag = s.result && s.result.helpfulElement;
      if (tag) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });
    const sortedTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
    els.dashboardTopElements.innerHTML =
      sortedTags.length > 0
        ? sortedTags
            .map(([name, count], idx) => `<span class="top-element-pill">${idx === 0 ? "🏆 " : ""}${name} (${count}표)</span>`)
            .join("")
        : `<span class="sub-hint">퀴즈쇼 무대에서 '가장 도움이 된 매체 요소'를 태그하면 여기에 순위가 나타납니다.</span>`;
  }

  async function exportClassReport() {
    const allSubs = roomData && roomData.submissions ? Object.values(roomData.submissions) : [];
    const lines = [
      `[〈매체로 말해요!〉 수업 결과 요약 - 방 코드 ${roomCode}]`,
      ""
    ];
    [1, 2, 3].forEach((r) => {
      const roundSubs = allSubs.filter((s) => Number(s.round) === r && s.result);
      const correctSubs = roundSubs.filter((s) => s.result.status === "correct");
      const acc = roundSubs.length > 0 ? Math.round((correctSubs.length / roundSubs.length) * 100) : 0;
      const avg =
        correctSubs.length > 0
          ? (correctSubs.reduce((a, s) => a + (s.result.timeSec || 0), 0) / correctSubs.length).toFixed(1)
          : "-";
      lines.push(`• ${ROUND_NAMES[r]}: 정답률 ${acc}% (${correctSubs.length}/${roundSubs.length}), 평균 소요 시간 ${avg}초`);
    });

    const summary = lines.join("\n");
    try {
      await navigator.clipboard.writeText(summary);
      window.MediaQuizApp.toast("📋 수업 결과 요약이 클립보드에 복사되었습니다!");
    } catch (_) {
      window.MediaQuizApp.toast("클립보드 복사가 차단되었습니다. 콘솔에서 확인해 주세요.");
      console.log(summary);
    }
  }

  // --- 교사 맞춤 제시어 관리 모달 ---
  function openWordsModal() {
    renderWordsList();
    els.modalWords.classList.remove("hidden");
  }

  function renderWordsList() {
    const words = window.MediaQuizWords || [];
    els.wordPoolCount.textContent = words.length;
    els.customWordsList.innerHTML = words
      .map(
        (w, idx) => `
      <div class="custom-word-item">
        <div>
          <strong>${escapeHtml(w.word)}</strong>
          <small>금지어: ${escapeHtml((w.forbidden || []).join(", "))}</small>
        </div>
        ${
          w.isCustom
            ? `<button type="button" class="btn btn-ghost btn-xs" data-del-word="${idx}">삭제</button>`
            : `<span class="pill-badge">${escapeHtml(w.category || "기본")}</span>`
        }
      </div>`
      )
      .join("");

    els.customWordsList.querySelectorAll("[data-del-word]").forEach((btn) => {
      btn.addEventListener("click", () => {
        window.MediaQuizWords.splice(Number(btn.dataset.delWord), 1);
        renderWordsList();
      });
    });
  }

  function addCustomWord(e) {
    e.preventDefault();
    const word = els.inputCustomWord.value.trim();
    const forbiddenRaw = els.inputCustomForbidden.value.trim();
    if (!word || !forbiddenRaw) return;
    const forbidden = forbiddenRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    window.MediaQuizWords.unshift({
      id: Date.now(),
      category: "교사 추가",
      word,
      forbidden,
      isCustom: true
    });

    els.inputCustomWord.value = "";
    els.inputCustomForbidden.value = "";
    renderWordsList();
    window.MediaQuizApp.toast(`새 제시어 [${word}]가 추가되었습니다!`);
  }

  // --- 로컬 데모용 샘플 학생 & 작품 생성 ---
  function createSampleDrawing(emojiText, bgColor) {
    const c = document.createElement("canvas");
    c.width = 720;
    c.height = 450;
    const ctx = c.getContext("2d");
    ctx.fillStyle = bgColor || "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.font = "bold 120px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(emojiText, 360, 210);
    return c.toDataURL("image/webp", 0.6);
  }

  async function fillDemoData() {
    if (!roomCode) return;
    const demoStudents = [
      { id: "demo_st_1", nickname: "1모둠 민수", wordObj: window.MediaQuizWords[0], emoji: "🏃💨⏰" },
      { id: "demo_st_2", nickname: "2모둠 서연", wordObj: window.MediaQuizWords[1], emoji: "🍜🤫👀" },
      { id: "demo_st_3", nickname: "3모둠 지훈", wordObj: window.MediaQuizWords[7], emoji: "🍱😍✨" }
    ];

    const studentsMap = { ...(roomData?.students || {}) };
    demoStudents.forEach((d) => {
      studentsMap[d.id] = {
        id: d.id,
        nickname: d.nickname,
        joinedAt: Date.now(),
        wordId: d.wordObj.id,
        word: d.wordObj.word,
        forbidden: d.wordObj.forbidden
      };
    });
    await window.MediaQuizSync.updateStudents(roomCode, studentsMap);

    // 1~3라운드 샘플 제출물 생성
    for (const d of demoStudents) {
      const img = createSampleDrawing(d.emoji, "#f8fafc");
      await window.MediaQuizSync.submitWork(roomCode, {
        id: `r1_${d.id}`,
        round: 1,
        studentId: d.id,
        nickname: d.nickname,
        word: d.wordObj.word,
        forbidden: d.wordObj.forbidden,
        submittedAt: Date.now(),
        payload: {
          imageData: img,
          staticText: { text: "지금 몇 시야?!", color: "#1c1c1e", size: 30, styleType: "bubble", position: "bottom" }
        },
        result: null
      });

      await window.MediaQuizSync.submitWork(roomCode, {
        id: `r2_${d.id}`,
        round: 2,
        studentId: d.id,
        nickname: d.nickname,
        word: d.wordObj.word,
        forbidden: d.wordObj.forbidden,
        submittedAt: Date.now() + 10,
        payload: {
          ttsText: "큰일 났다! 빨리 움직여야 해!",
          ttsRate: 1.2,
          ttsPitch: 1.2,
          bgm: "news",
          sfxList: [
            { type: "siren", timing: "start" },
            { type: "heartbeat", timing: "mid" }
          ]
        },
        result: null
      });

      await window.MediaQuizSync.submitWork(roomCode, {
        id: `r3_${d.id}`,
        round: 3,
        studentId: d.id,
        nickname: d.nickname,
        word: d.wordObj.word,
        forbidden: d.wordObj.forbidden,
        submittedAt: Date.now() + 20,
        payload: {
          imageData: img,
          subtitle: { text: "이 순간을 기다렸다!!", font: "hand", color: "#ff3b30", anim: "bounce" },
          filter: "vignette",
          ttsText: "이 순간을 얼마나 기다렸는지 몰라!",
          ttsRate: 1.0,
          ttsPitch: 1.2,
          bgm: "variety",
          sfxList: [{ type: "dundun", timing: "start" }]
        },
        result: null
      });
    }

    window.MediaQuizApp.toast("데모 학생 3명과 1~3라운드 샘플 작품이 채워졌습니다!");
  }

  // --- 컨페티(폭죽) 애니메이션 ---
  function launchConfetti() {
    const canvas = document.getElementById("confetti-canvas");
    canvas.classList.remove("hidden");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext("2d");

    const colors = ["#ff3b30", "#007aff", "#34c759", "#ffcc00", "#af52de", "#ff9500"];
    const pieces = Array.from({ length: 120 }, () => ({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * 200,
      w: 8 + Math.random() * 8,
      h: 6 + Math.random() * 6,
      vx: (Math.random() - 0.5) * 6,
      vy: 3 + Math.random() * 5,
      rot: Math.random() * Math.PI * 2,
      vRot: (Math.random() - 0.5) * 0.2,
      color: colors[Math.floor(Math.random() * colors.length)]
    }));

    let frame = 0;
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vRot;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      frame++;
      if (frame < 130) {
        requestAnimationFrame(draw);
      } else {
        canvas.classList.add("hidden");
      }
    }
    requestAnimationFrame(draw);
  }

  function cleanup() {
    if (countdownInterval) clearInterval(countdownInterval);
    stopStopwatch();
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
    initRoom,
    cleanup
  };
})();
