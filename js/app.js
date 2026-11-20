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
  }

  document.addEventListener("DOMContentLoaded", init);

  return {
    showStartView,
    toast
  };
})();
