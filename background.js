// =============================================================
// Private Element Screenshot — background service worker (MV3)
// =============================================================
// Responsibilities:
//   1. Capture the visible tab when the user hits the shortcut or
//      clicks the toolbar icon.
//   2. Inject the on-page selection/annotation tool.
//   3. Handle messages from the injected script: retake + save
//      (routed through chrome.downloads for reliability instead of
//      an in-page <a download> link, which can be blocked or
//      ignored by some pages' policies).
// =============================================================

const RESTRICTED_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "edge://",
  "about:",
  "https://chrome.google.com/webstore",
  "https://chromewebstore.google.com"
];

function isRestrictedUrl(url) {
  return !url || RESTRICTED_PREFIXES.some((prefix) => url.startsWith(prefix));
}

// Inline 1x1 transparent PNG — used so notifications never depend on an
// icon file being present at a particular path (a missing manifest-listed
// icon file is enough to make the whole extension fail to load, so we
// avoid file-based icons anywhere that isn't strictly required).
const BLANK_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: BLANK_ICON,
    title,
    message
  });
}

/**
 * Captures the given tab and injects the selection tool.
 * Shared by the keyboard command and the toolbar icon click so both
 * entry points behave identically.
 */
async function startCaptureFlow(tab) {
  if (!tab || !tab.id) {
    notify("Screenshot Failed", "Could not find an active tab to capture.");
    return;
  }

  if (isRestrictedUrl(tab.url)) {
    notify(
      "Screenshot Blocked",
      "Browser security prevents taking screenshots on this page (e.g. chrome:// pages, the Web Store, or new-tab page)."
    );
    return;
  }

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: startAreaSelection,
      args: [dataUrl]
    });
  } catch (err) {
    console.error("Screenshot capture failed:", err);
    // Most common causes: captureVisibleTab rate limit (MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND),
    // or the page not allowing script injection (rare, non-http(s) schemes).
    notify(
      "Screenshot Failed",
      "Could not capture this page. Wait a second and try again, or reload the tab."
    );
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command !== "trigger-screenshot") return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    startCaptureFlow(tabs[0]);
  });
});

// Clicking the toolbar icon does the same thing as the shortcut, so
// people who forget the shortcut can still discover and use the tool.
chrome.action.onClicked.addListener((tab) => {
  startCaptureFlow(tab);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.action === "saveScreenshot") {
    chrome.downloads.download(
      {
        url: message.dataUrl,
        filename: message.filename,
        saveAs: false
      },
      (downloadId) => {
        const err = chrome.runtime.lastError;
        if (err || downloadId === undefined) {
          console.error("Download failed:", err?.message);
          sendResponse({ ok: false, error: err?.message || "Unknown download error" });
        } else {
          sendResponse({ ok: true, downloadId });
        }
      }
    );
    return true; // keep the message channel open for the async sendResponse above
  }

  return false;
});

// =============================================================
// Injected content-script function.
// Everything below runs INSIDE the target page (isolated world),
// so it cannot reference anything from the background scope above
// except through chrome.runtime messaging.
// =============================================================
function startAreaSelection(base64Image) {
  // Guard against double-activation (e.g. mashing the shortcut, or
  // the toolbar icon + shortcut firing close together).
  if (document.getElementById("epc-screenshot-host")) return;

  const DPR = window.devicePixelRatio || 1;
  const FIXED_COLOR = "#ff0000";
  const FIXED_WIDTH = 3;

  // ---- Shadow DOM host -------------------------------------------------
  // `all:initial` on the host resets inherited CSS (font, color, line-height,
  // etc.) before it reaches our shadow tree, and the shadow boundary itself
  // blocks the page's own CSS rules (e.g. aggressive `button{all:unset}`
  // resets, or global `*{box-sizing:content-box}` overrides) from leaking
  // in. This is what makes the tool look the same on every site.
  const host = document.createElement("div");
  host.id = "epc-screenshot-host";
  host.style.cssText = "all:initial;position:fixed;top:0;left:0;z-index:2147483647;";
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    :host, * { box-sizing: border-box; }
    * { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
    button { font: inherit; }
    .btn {
      padding: 6px 10px; background: #2b2b2b; color: #eee; border: 1px solid #464646;
      border-radius: 6px; cursor: pointer; font-size: 13px; user-select: none;
      white-space: nowrap; transition: background .15s ease, transform .08s ease;
    }
    .btn:hover { background: #3a3a3a; }
    .btn:active { transform: scale(0.95); }
    .btn:disabled { opacity: .35; cursor: default; }
    .btn:disabled:hover { background: #2b2b2b; }
    .btn.active { background: #0a84ff; border-color: #0a84ff; }
    .btn.primary { background: #0a84ff; border: none; font-weight: 600; }
    .btn.primary:hover { background: #1c90ff; }
    .btn.success { background: #34c759; border: none; font-weight: 600; }
    .btn.success:hover { background: #3fd968; }
    .btn.ghost { background: transparent; border: 1px solid #464646; }
    .btn.close { background: transparent; border: none; font-size: 16px; padding: 4px 8px; color: #aaa; }
    .btn.close:hover { color: #fff; background: #3a3a3a; }
    .toast {
      display: none; padding: 6px 12px; border-radius: 4px; color: #fff; font-size: 12px;
      font-weight: 600; text-align: center;
    }
    .row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  `;
  root.appendChild(style);

  // ---- Phase 1: hover-highlight + drag-to-select overlay ----------------
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;cursor:crosshair;";
  root.appendChild(overlay);

  const highlightBox = document.createElement("div");
  highlightBox.style.cssText =
    "position:fixed;border:2px solid #0a84ff;background:rgba(10,132,255,0.12);pointer-events:none;display:none;";
  root.appendChild(highlightBox);

  const hint = document.createElement("div");
  hint.textContent = "Click an element, or drag to select an area. Esc to cancel.";
  hint.style.cssText =
    "position:fixed;left:50%;top:16px;transform:translateX(-50%);background:#1e1e1eee;color:#eee;" +
    "padding:6px 14px;border-radius:20px;font-size:13px;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.4);";
  root.appendChild(hint);

  let isMouseDown = false;
  let isDraggingArea = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let selectionRect = null;
  let hoverRafPending = false;

  // captureVisibleTab only ever captures the current viewport (0,0) to
  // (innerWidth, innerHeight). An element's bounding box can extend above,
  // below, or beside that (e.g. a tall table with rows below the fold), so
  // any selection must be clamped to the viewport or the crop will read
  // pixels that were never captured — which paints as blank/transparent
  // in the editor. Returns null if nothing of the rect is actually visible.
  function clampToViewport(left, top, width, height) {
    const clampedLeft = Math.max(left, 0);
    const clampedTop = Math.max(top, 0);
    const right = Math.min(left + width, window.innerWidth);
    const bottom = Math.min(top + height, window.innerHeight);
    const clampedWidth = right - clampedLeft;
    const clampedHeight = bottom - clampedTop;
    if (clampedWidth <= 0 || clampedHeight <= 0) return null;
    return { left: clampedLeft, top: clampedTop, width: clampedWidth, height: clampedHeight };
  }

  function updateHover(clientX, clientY) {
    overlay.style.pointerEvents = "none";
    const elementUnderCursor = document.elementFromPoint(clientX, clientY);
    overlay.style.pointerEvents = "auto";

    if (!elementUnderCursor || elementUnderCursor === document.body || elementUnderCursor === document.documentElement) {
      highlightBox.style.display = "none";
      selectionRect = null;
      return;
    }

    const rect = elementUnderCursor.getBoundingClientRect();
    const clamped = clampToViewport(rect.left, rect.top, rect.width, rect.height);
    if (!clamped) {
      highlightBox.style.display = "none";
      selectionRect = null;
      return;
    }
    selectionRect = clamped;

    highlightBox.style.display = "block";
    highlightBox.style.left = `${clamped.left}px`;
    highlightBox.style.top = `${clamped.top}px`;
    highlightBox.style.width = `${clamped.width}px`;
    highlightBox.style.height = `${clamped.height}px`;
  }

  function onMouseMove(e) {
    if (isMouseDown) {
      const dist = Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY);
      if (dist > 3) isDraggingArea = true;
    }

    if (isDraggingArea) {
      const rawLeft = Math.min(dragStartX, e.clientX);
      const rawTop = Math.min(dragStartY, e.clientY);
      const rawWidth = Math.abs(e.clientX - dragStartX);
      const rawHeight = Math.abs(e.clientY - dragStartY);

      const clamped = clampToViewport(rawLeft, rawTop, rawWidth, rawHeight);
      if (!clamped) return;
      const { left, top, width, height } = clamped;

      selectionRect = { left, top, width, height };
      highlightBox.style.display = "block";
      highlightBox.style.left = `${left}px`;
      highlightBox.style.top = `${top}px`;
      highlightBox.style.width = `${width}px`;
      highlightBox.style.height = `${height}px`;
      return;
    }

    // Throttle elementFromPoint hit-testing to one per animation frame so
    // hovering over heavy pages doesn't cause visible jank.
    if (hoverRafPending) return;
    hoverRafPending = true;
    requestAnimationFrame(() => {
      hoverRafPending = false;
      updateHover(e.clientX, e.clientY);
    });
  }

  function onMouseDown(e) {
    if (e.button !== 0) return; // left-click only
    isMouseDown = true;
    isDraggingArea = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
  }

  function onMouseUp() {
    isMouseDown = false;
    isDraggingArea = false;

    if (!selectionRect || selectionRect.width < 3 || selectionRect.height < 3) {
      return;
    }

    const cropParams = {
      x: selectionRect.left * DPR,
      y: selectionRect.top * DPR,
      width: selectionRect.width * DPR,
      height: selectionRect.height * DPR,
      displayWidth: selectionRect.width,
      displayHeight: selectionRect.height,
      dpr: DPR
    };

    cleanupSelectionPhase();

    if (cropParams.width < 2 || cropParams.height < 2) {
      teardownHost();
      return;
    }

    const img = new Image();
    img.onload = () => {
      // Safety net: clamp against the image's real pixel dimensions in case
      // of any sub-pixel rounding drift between CSS coordinates and the
      // captured bitmap (e.g. fractional devicePixelRatio). Without this,
      // a 1px overshoot at the viewport edge would still read blank pixels.
      cropParams.x = Math.max(0, Math.min(cropParams.x, img.naturalWidth - 1));
      cropParams.y = Math.max(0, Math.min(cropParams.y, img.naturalHeight - 1));
      cropParams.width = Math.min(cropParams.width, img.naturalWidth - cropParams.x);
      cropParams.height = Math.min(cropParams.height, img.naturalHeight - cropParams.y);
      openEditorModal(img, cropParams);
    };
    img.onerror = () => {
      notifyFailureAndClose("Could not load the captured image.");
    };
    img.src = base64Image;
  }

  function cleanupSelectionPhase() {
    overlay.removeEventListener("mousemove", onMouseMove);
    overlay.removeEventListener("mousedown", onMouseDown);
    overlay.removeEventListener("mouseup", onMouseUp);
    window.removeEventListener("keydown", selectionEscKey, true);
    overlay.remove();
    highlightBox.remove();
    hint.remove();
  }

  function selectionEscKey(e) {
    if (e.key === "Escape") {
      cleanupSelectionPhase();
      teardownHost();
    }
  }

  function teardownHost() {
    host.remove();
  }

  function notifyFailureAndClose(msg) {
    console.error(msg);
    teardownHost();
  }

  overlay.addEventListener("mousemove", onMouseMove);
  overlay.addEventListener("mousedown", onMouseDown);
  overlay.addEventListener("mouseup", onMouseUp);
  window.addEventListener("keydown", selectionEscKey, true);

  // ---- Phase 2: annotation editor ---------------------------------------
  function openEditorModal(img, crop) {
    const modal = document.createElement("div");
    modal.style.cssText =
      "position:fixed;top:40px;left:40px;background:#1e1e1e;padding:12px;border-radius:10px;" +
      "box-shadow:0 8px 32px rgba(0,0,0,0.6);display:flex;flex-direction:column;gap:10px;" +
      "max-width:90vw;max-height:90vh;overflow:hidden;color:#eee;";

    // --- toast -----------------------------------------------------------
    const toast = document.createElement("div");
    toast.className = "toast";
    let toastTimer = null;
    function showToast(msg, type = "success") {
      toast.style.display = "block";
      toast.style.background = type === "error" ? "#d9534f" : "#28a745";
      toast.textContent = msg;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (toast.style.display = "none"), 2500);
    }
    modal.appendChild(toast);

    // --- title bar (drag handle + close) ---------------------------------
    const titleBar = document.createElement("div");
    titleBar.className = "row";
    titleBar.style.cssText = "justify-content:space-between;cursor:move;width:100%;";

    const titleText = document.createElement("span");
    titleText.textContent = "📸 Screenshot Editor";
    titleText.style.cssText = "font-size:13px;font-weight:600;color:#ccc;user-select:none;";

    const closeBtn = document.createElement("button");
    closeBtn.className = "btn close";
    closeBtn.textContent = "✕";
    closeBtn.title = "Close (Esc)";
    closeBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    closeBtn.addEventListener("click", () => cleanupModal());

    titleBar.appendChild(titleText);
    titleBar.appendChild(closeBtn);
    modal.appendChild(titleBar);

    // --- tool row ----------------------------------------------------------
    const toolRow = document.createElement("div");
    toolRow.className = "row";

    let activeTool = null;
    const toolButtons = {};

    const tools = [
      { id: "pen", label: "✏️ Draw" },
      { id: "line", label: "➖ Line" },
      { id: "arrow", label: "➡️ Arrow" },
      { id: "rectangle", label: "🔲 Box" }
    ];

    tools.forEach((t) => {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = t.label;
      btn.addEventListener("mousedown", (e) => e.stopPropagation());
      btn.addEventListener("click", () => setActiveTool(activeTool === t.id ? null : t.id));
      toolButtons[t.id] = btn;
      toolRow.appendChild(btn);
    });

    function setActiveTool(id) {
      activeTool = id;
      Object.entries(toolButtons).forEach(([key, b]) => b.classList.toggle("active", key === id));
      canvas.style.cursor = id ? "crosshair" : "default";
    }

    modal.appendChild(toolRow);

    // --- canvas area ---------------------------------------------------------
    const canvasContainer = document.createElement("div");
    canvasContainer.style.cssText =
      "max-width:100%;max-height:65vh;overflow:auto;border:1px solid #444;border-radius:6px;" +
      "background:repeating-conic-gradient(#151515 0% 25%, #1c1c1c 0% 50%) 50% / 16px 16px;" +
      "display:flex;justify-content:center;align-items:center;padding:12px;position:relative;";

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(crop.width);
    canvas.height = Math.round(crop.height);
    canvas.style.cssText = `width:${crop.displayWidth}px;height:${crop.displayHeight}px;display:block;margin:auto;max-width:100%;`;

    canvasContainer.appendChild(canvas);
    modal.appendChild(canvasContainer);
    root.appendChild(modal);

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      showToast("This browser cannot render the editor canvas.", "error");
      return;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    function drawBaseImage() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(
        img,
        Math.round(crop.x),
        Math.round(crop.y),
        Math.round(crop.width),
        Math.round(crop.height),
        0,
        0,
        Math.round(crop.width),
        Math.round(crop.height)
      );
    }
    drawBaseImage();

    // --- undo / redo history ---------------------------------------------
    const MAX_HISTORY = 25;
    const historyStack = [];
    const redoStack = [];

    function saveHistoryState() {
      historyStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
      if (historyStack.length > MAX_HISTORY) historyStack.shift();
      redoStack.length = 0;
    }
    saveHistoryState();

    // Undo/redo stay available via Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y (see
    // editorKeyHandler below) without cluttering the toolbar with buttons.
    function performUndo() {
      if (historyStack.length <= 1) return;
      redoStack.push(historyStack.pop());
      ctx.putImageData(historyStack[historyStack.length - 1], 0, 0);
    }

    function performRedo() {
      if (redoStack.length === 0) return;
      const next = redoStack.pop();
      historyStack.push(next);
      ctx.putImageData(next, 0, 0);
    }

    // --- drawing tools ------------------------------------------------------
    const snapshotCanvas = document.createElement("canvas");
    let isDrawing = false;
    let startX = 0;
    let startY = 0;

    function getCanvasCoords(e) {
      const rect = canvas.getBoundingClientRect();
      // Clamp to canvas bounds so a fast drag that exits the element while
      // the mouse button is held doesn't throw coordinates off-canvas.
      const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
      const y = Math.min(Math.max(e.clientY - rect.top, 0), rect.height);
      return { x: x * crop.dpr, y: y * crop.dpr };
    }

    function setupCtxStyle() {
      ctx.strokeStyle = FIXED_COLOR;
      ctx.fillStyle = FIXED_COLOR;
      ctx.lineWidth = FIXED_WIDTH * crop.dpr;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    }

    function drawArrow(fromX, fromY, toX, toY) {
      const headLength = Math.max(14, FIXED_WIDTH * 3) * crop.dpr;
      const angle = Math.atan2(toY - fromY, toX - fromX);
      const lineEndX = toX - (headLength / 2) * Math.cos(angle);
      const lineEndY = toY - (headLength / 2) * Math.sin(angle);

      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.lineTo(lineEndX, lineEndY);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(toX, toY);
      ctx.lineTo(toX - headLength * Math.cos(angle - Math.PI / 6), toY - headLength * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(toX - headLength * Math.cos(angle + Math.PI / 6), toY - headLength * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
    }

    canvas.addEventListener("mousedown", (e) => {
      if (!activeTool) return;
      const pos = getCanvasCoords(e);

      isDrawing = true;
      startX = pos.x;
      startY = pos.y;

      snapshotCanvas.width = canvas.width;
      snapshotCanvas.height = canvas.height;
      snapshotCanvas.getContext("2d").drawImage(canvas, 0, 0);

      setupCtxStyle();
      if (activeTool === "pen") {
        ctx.beginPath();
        ctx.moveTo(startX, startY);
      }
    });

    canvas.addEventListener("mousemove", (e) => {
      if (!isDrawing || !activeTool) return;
      const pos = getCanvasCoords(e);

      if (activeTool === "pen") {
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        return;
      }

      // Non-freehand tools preview against the pre-stroke snapshot so the
      // shape can be redrawn cleanly as the mouse moves.
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(snapshotCanvas, 0, 0);
      setupCtxStyle();

      if (activeTool === "line") {
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      } else if (activeTool === "arrow") {
        drawArrow(startX, startY, pos.x, pos.y);
      } else if (activeTool === "rectangle") {
        ctx.strokeRect(startX, startY, pos.x - startX, pos.y - startY);
      }
    });

    function endDrawing(e) {
      if (!isDrawing) return;
      isDrawing = false;
      saveHistoryState();
    }

    canvas.addEventListener("mouseup", endDrawing);
    canvas.addEventListener("mouseleave", (e) => {
      // Only finalize on leave if a button is still down (drag continued
      // past the canvas edge); otherwise ignore stray leave events.
      if (isDrawing && e.buttons === 1) endDrawing(e);
    });

    // --- dragging the modal around the page --------------------------------
    let isDraggingModal = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    titleBar.addEventListener("mousedown", (e) => {
      if (e.target !== titleBar && e.target !== titleText) return;
      isDraggingModal = true;
      const rect = modal.getBoundingClientRect();
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
      e.preventDefault();
    });

    function onWindowMouseMove(e) {
      if (!isDraggingModal) return;
      const maxLeft = window.innerWidth - modal.offsetWidth;
      const maxTop = window.innerHeight - modal.offsetHeight;
      modal.style.left = `${Math.min(Math.max(0, e.clientX - dragOffsetX), Math.max(0, maxLeft))}px`;
      modal.style.top = `${Math.min(Math.max(0, e.clientY - dragOffsetY), Math.max(0, maxTop))}px`;
    }
    function onWindowMouseUp() {
      isDraggingModal = false;
    }
    window.addEventListener("mousemove", onWindowMouseMove);
    window.addEventListener("mouseup", onWindowMouseUp);

    // --- keyboard shortcuts --------------------------------------------------
    function editorKeyHandler(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        cleanupModal();
        return;
      }
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;
      if (isCmdOrCtrl && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? performRedo() : performUndo();
      } else if (isCmdOrCtrl && e.key.toLowerCase() === "y") {
        e.preventDefault();
        performRedo();
      }
    }
    window.addEventListener("keydown", editorKeyHandler, true);

    // --- footer actions: retake / scroll toggle / copy / save --------------
    const actionRow = document.createElement("div");
    actionRow.className = "row";
    actionRow.style.justifyContent = "space-between";

    const leftActions = document.createElement("div");
    leftActions.className = "row";

    let scrollable = true;
    const scrollBtn = document.createElement("button");
    scrollBtn.className = "btn ghost";
    scrollBtn.textContent = "📜 Scroll: ON";
    scrollBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    scrollBtn.addEventListener("click", () => {
      scrollable = !scrollable;
      canvasContainer.style.overflow = scrollable ? "auto" : "hidden";
      scrollBtn.textContent = scrollable ? "📜 Scroll: ON" : "🔒 Scroll: OFF";
    });

    leftActions.appendChild(scrollBtn);

    const rightActions = document.createElement("div");
    rightActions.className = "row";

    const copyBtn = document.createElement("button");
    copyBtn.className = "btn success";
    copyBtn.textContent = "📋 Copy";
    copyBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    copyBtn.addEventListener("click", async () => {
      if (!document.hasFocus()) {
        // Clipboard writes silently fail on an unfocused document; this is
        // the single most common real-world failure mode for this feature.
        window.focus();
      }
      canvas.toBlob(async (blob) => {
        if (!blob) {
          showToast("Failed to generate image.", "error");
          return;
        }
        try {
          await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
          showToast("Copied to clipboard!");
          setTimeout(cleanupModal, 600);
        } catch (err) {
          console.error("Clipboard copy failed:", err);
          showToast("Copy failed — try Save instead.", "error");
        }
      }, "image/png");
    });

    const saveBtn = document.createElement("button");
    saveBtn.className = "btn primary";
    saveBtn.textContent = "💾 Save";
    saveBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    saveBtn.addEventListener("click", () => {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const dataUrl = canvas.toDataURL("image/png");
      chrome.runtime.sendMessage(
        { action: "saveScreenshot", dataUrl, filename: `screenshot-${timestamp}.png` },
        (response) => {
          if (chrome.runtime.lastError || !response?.ok) {
            showToast("Save failed. Try Copy instead.", "error");
            return;
          }
          showToast("Saved!");
          setTimeout(cleanupModal, 600);
        }
      );
    });

    rightActions.appendChild(copyBtn);
    rightActions.appendChild(saveBtn);

    actionRow.appendChild(leftActions);
    actionRow.appendChild(rightActions);
    modal.appendChild(actionRow);

    // --- teardown ------------------------------------------------------------
    function cleanupModal() {
      window.removeEventListener("mousemove", onWindowMouseMove);
      window.removeEventListener("mouseup", onWindowMouseUp);
      window.removeEventListener("keydown", editorKeyHandler, true);
      teardownHost();
    }
  }
}