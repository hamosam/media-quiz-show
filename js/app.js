/**
 * 앱 진입점 (역할 선택, 실시간 중계 / 로컬 데모 모드 토글, 뷰 전환, 토스트)
 */
window.MediaQuizApp = (function () {
  const views = {
    start: document.getElementById("view-start"),
    teacher: document.getElementById("view-teacher"),
    student: document.getElementById("view-student")
  };

  function showView(name) {
    Object.entries(views).forEach(([k, el]) => {
      el.classList.toggle("active", k === name);
    });
  }

  function showStartView() {
    showView("start");
  }

  function toast(message) {
    const container = document.getElementById("toast-container");
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.remove();
    }, 3200);
  }

  function init() {
    const demoToggle = document.getElementById("demo-mode-toggle");
    const demoLabel = document.getElementById("demo-mode-label");
    const btnCreateRoom = document.getElementById("btn-create-room");
    const formJoinRoom = document.getElementById("form-join-room");
    const inputCode = document.getElementById("input-room-code");
    const inputName = document.getElementById("input-nickname");
    const formTeacherSheet = document.getElementById("form-teacher-sheet");
    const inputSheetCode = document.getElementById("input-sheet-code");
    const modalSheet = document.getElementById("modal-answer-sheet");
    const btnCloseSheet = document.getElementById("btn-close-sheet-modal");
    const sheetRoomCode = document.getElementById("sheet-room-code");
    const sheetList = document.getElementById("answer-sheet-list");

    const updateModeLabel = (isDemo) => {
      demoLabel.textContent = isDemo ? "로컬 데모 모드 (같은 기기)" : "실시간 중계 모드 (교실 연결)";
    };

    // 기본값: 무설정 실시간 중계 모드 (demoToggle.checked === false)
    window.MediaQuizSync.setDemoMode(demoToggle.checked);
    updateModeLabel(demoToggle.checked);

    demoToggle.addEventListener("change", () => {
      window.MediaQuizSync.setDemoMode(demoToggle.checked);
      updateModeLabel(demoToggle.checked);
    });

    // 교사 방 만들기
    btnCreateRoom.addEventListener("click", async () => {
      const code = String(Math.floor(1000 + Math.random() * 9000));
      btnCreateRoom.disabled = true;
      btnCreateRoom.textContent = "방 생성 및 서버 연결 중...";
      try {
        await window.MediaQuizTeacher.initRoom(code);
        showView("teacher");
        toast(`방 코드 [${code}]가 생성되었습니다!`);
      } catch (err) {
        console.error(err);
        toast(err.message || "방을 만드는 중 오류가 발생했습니다.");
      } finally {
        btnCreateRoom.disabled = false;
        btnCreateRoom.textContent = "교사(TV)로 방 만들기";
      }
    });

    // 학생 입장하기
    formJoinRoom.addEventListener("submit", async (e) => {
      e.preventDefault();
      const code = inputCode.value.trim();
      const name = inputName.value.trim();
      if (!/^\d{4}$/.test(code)) {
        toast("4자리 숫자 방 코드를 입력해 주세요.");
        return;
      }
      if (!name) {
        toast("닉네임 또는 모둠명을 입력해 주세요.");
        return;
      }

      const submitBtn = formJoinRoom.querySelector("button[type='submit']");
      submitBtn.disabled = true;
      submitBtn.textContent = "방 연결 확인 중...";

      try {
        await window.MediaQuizStudent.joinRoom(code, name);
        showView("student");
        toast(`${name}님, [${code}] 방에 입장했습니다!`);
      } catch (err) {
        toast(err.message || "입장에 실패했습니다. 방 코드를 확인해 주세요.");
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "학생(태블릿)으로 입장하기";
      }
    });

    // 교사 스마트폰 실시간 정답표 열기
    const renderAnswerSheet = (room) => {
      if (!room) return;
      const students = Object.values(room.students || {});
      const subs = Object.values(room.submissions || {}).sort((a, b) => (a.submittedAt || 0) - (b.submittedAt || 0));

      const roundRows = [1, 2, 3]
        .map((r) => {
          const rSubs = subs.filter((s) => Number(s.round) === r);
          if (!rSubs.length) return "";
          return `
            <div class="custom-word-item" style="background:rgba(0,122,255,0.08)">
              <strong>📌 ${r}라운드 제출 순서별 정답 (${rSubs.length}건)</strong>
            </div>
            ${rSubs
              .map(
                (s, i) => `
              <div class="custom-word-item">
                <div>
                  <strong>${i + 1}번 작품 · ${s.nickname}</strong>
                  <small>정답: <strong style="color:#007aff">${s.word || (room.students?.[s.studentId]?.word ?? "-")}</strong></small>
                </div>
                <span class="pill-badge">${s.result ? (s.result.status === "correct" ? "⭕ 정답" : "⏭ 패스") : "대기"}</span>
              </div>`
              )
              .join("")}
          `;
        })
        .join("");

      const studentRows = students.length
        ? `<div class="custom-word-item" style="background:rgba(15,23,42,0.06)">
            <strong>👥 현재 라운드(${room.round || 1}R) 학생별 배정 제시어</strong>
           </div>` +
          students
            .map(
              (st) => `
            <div class="custom-word-item">
              <div>
                <strong>${st.nickname}</strong>
                <small>제시어: <strong style="color:#007aff">${st.word || "배정 전"}</strong></small>
              </div>
            </div>`
            )
            .join("")
        : `<div class="empty-state">아직 입장한 학생이 없습니다.</div>`;

      sheetList.innerHTML = roundRows + studentRows;
    };

    formTeacherSheet.addEventListener("submit", async (e) => {
      e.preventDefault();
      const code = inputSheetCode.value.trim();
      if (!/^\d{4}$/.test(code)) {
        toast("4자리 숫자 방 코드를 입력해 주세요.");
        return;
      }
      try {
        const room = await window.MediaQuizSync.watchRoomAsTeacher(code);
        sheetRoomCode.textContent = code;
        renderAnswerSheet(room);
        modalSheet.classList.remove("hidden");
        window.MediaQuizSync.subscribeRoom(code, renderAnswerSheet);
      } catch (err) {
        toast(err.message || "방을 찾을 수 없습니다.");
      }
    });

    btnCloseSheet.addEventListener("click", () => {
      modalSheet.classList.add("hidden");
      window.MediaQuizSync.disconnect();
    });
  }

  document.addEventListener("DOMContentLoaded", init);

  return {
    showStartView,
    toast
  };
})();
