/**
 * HTML5 Canvas 그림판 모듈
 * 태블릿 터치/펜/마우스 완벽 지원 (드로잉 중 화면 스크롤 방지)
 * Firebase 전송 용량 최적화를 위해 WebP(0.6)로 압축 내보내기 지원
 */
window.MediaQuizCanvas = (function () {
  const COLORS = [
    { name: "검정", hex: "#1c1c1e" },
    { name: "빨강", hex: "#ff3b30" },
    { name: "파랑", hex: "#007aff" },
    { name: "초록", hex: "#34c759" },
    { name: "노랑", hex: "#ffcc00" },
    { name: "보라", hex: "#af52de" }
  ];

  const SIZES = [
    { label: "얇게", width: 4 },
    { label: "보통", width: 10 },
    { label: "굵게", width: 20 }
  ];

  const STAMPS = ["⏰", "🍜", "😱", "💢", "🤫", "🎉", "🔥", "💡"];

  function create(canvasEl) {
    const ctx = canvasEl.getContext("2d");
    let isDrawing = false;
    let tool = "pen"; // 'pen' | 'eraser' | 'stamp'
    let stampEmoji = STAMPS[0];
    let color = COLORS[0].hex;
    let lineWidth = SIZES[1].width;
    let lastX = 0;
    let lastY = 0;
    let hasDrawn = false;
    const history = [];
    const MAX_HISTORY = 15;

    function saveHistory() {
      try {
        if (history.length >= MAX_HISTORY) history.shift();
        history.push(ctx.getImageData(0, 0, canvasEl.width, canvasEl.height));
      } catch (_) {}
    }

    function fillWhite() {
      ctx.save();
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
      ctx.restore();
    }

    // 초기 흰색 배경
    fillWhite();
    saveHistory();

    function getPos(e) {
      const rect = canvasEl.getBoundingClientRect();
      const scaleX = canvasEl.width / rect.width;
      const scaleY = canvasEl.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
      };
    }

    function startDraw(e) {
      e.preventDefault();
      canvasEl.setPointerCapture(e.pointerId);
      const pos = getPos(e);

      if (tool === "stamp") {
        ctx.save();
        ctx.font = "60px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(stampEmoji, pos.x, pos.y);
        ctx.restore();
        hasDrawn = true;
        saveHistory();
        return;
      }

      isDrawing = true;
      lastX = pos.x;
      lastY = pos.y;

      // 점 찍기 지원
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, (tool === "eraser" ? lineWidth * 1.8 : lineWidth) / 2, 0, Math.PI * 2);
      ctx.fillStyle = tool === "eraser" ? "#ffffff" : color;
      ctx.fill();
      hasDrawn = true;
    }

    function moveDraw(e) {
      if (!isDrawing || tool === "stamp") return;
      e.preventDefault();
      const pos = getPos(e);

      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(pos.x, pos.y);
      ctx.strokeStyle = tool === "eraser" ? "#ffffff" : color;
      ctx.lineWidth = tool === "eraser" ? lineWidth * 1.8 : lineWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();

      lastX = pos.x;
      lastY = pos.y;
      hasDrawn = true;
    }

    function endDraw(e) {
      if (!isDrawing) return;
      e.preventDefault();
      isDrawing = false;
      try {
        canvasEl.releasePointerCapture(e.pointerId);
      } catch (_) {}
      saveHistory();
    }

    canvasEl.addEventListener("pointerdown", startDraw);
    canvasEl.addEventListener("pointermove", moveDraw);
    canvasEl.addEventListener("pointerup", endDraw);
    canvasEl.addEventListener("pointercancel", endDraw);

    return {
      COLORS,
      SIZES,
      STAMPS,
      setTool(newTool) {
        tool = newTool;
      },
      setStamp(emoji) {
        stampEmoji = emoji;
        tool = "stamp";
      },
      setColor(newColor) {
        color = newColor;
        tool = "pen";
      },
      setSize(newWidth) {
        lineWidth = newWidth;
      },
      clear() {
        fillWhite();
        hasDrawn = false;
        saveHistory();
      },
      undo() {
        if (history.length <= 1) return false;
        history.pop();
        const prev = history[history.length - 1];
        if (prev) ctx.putImageData(prev, 0, 0);
        return true;
      },
      drawImageFile(file) {
        return new Promise((resolve, reject) => {
          if (!file || !file.type.startsWith("image/")) {
            reject(new Error("이미지 파일만 추가할 수 있습니다."));
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            const img = new Image();
            img.onload = () => {
              // 비율을 유지하며 캔버스 중앙에 맞춤 배치
              const scale = Math.min(canvasEl.width / img.width, canvasEl.height / img.height);
              const drawW = img.width * scale;
              const drawH = img.height * scale;
              const offsetX = (canvasEl.width - drawW) / 2;
              const offsetY = (canvasEl.height - drawH) / 2;

              fillWhite();
              ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
              hasDrawn = true;
              saveHistory();
              resolve();
            };
            img.onerror = () => reject(new Error("이미지를 불러올 수 없습니다."));
            img.src = reader.result;
          };
          reader.onerror = () => reject(new Error("파일을 읽는 중 오류가 발생했습니다."));
          reader.readAsDataURL(file);
        });
      },
      isEmpty() {
        return !hasDrawn;
      },
      exportImage() {
        // WebP 0.6 품질로 가볍게 압축 (미지원 브라우저는 JPEG 폴백)
        let dataUrl = canvasEl.toDataURL("image/webp", 0.6);
        if (!dataUrl || !dataUrl.startsWith("data:image/webp")) {
          dataUrl = canvasEl.toDataURL("image/jpeg", 0.65);
        }
        // 중계 서버 전송 안정성을 위해 45KB 이상이면 자동 축소 압축
        if (dataUrl.length > 45000) {
          const tmp = document.createElement("canvas");
          tmp.width = 480;
          tmp.height = 300;
          const tctx = tmp.getContext("2d");
          tctx.drawImage(canvasEl, 0, 0, tmp.width, tmp.height);
          const smaller = tmp.toDataURL("image/webp", 0.5);
          dataUrl = smaller && smaller.startsWith("data:image/webp") ? smaller : tmp.toDataURL("image/jpeg", 0.5);
        }
        return dataUrl;
      }
    };
  }

  return {
    COLORS,
    SIZES,
    create
  };
})();
