// =============================================================
// Snap by Frame — Screenshot & Screen Recorder (Content Script)
// =============================================================

(() => {
  // Listen for background messages
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "initOverlay") {
      openScreenshotOverlay(message.dataUrl, message.mode || "screenshot");
      sendResponse({ ok: true });
    }
    return false;
  });

  // In-page shortcut listeners (Alt+Shift+S for screenshot, Alt+Shift+R for recording)
  window.addEventListener(
    "keydown",
    (e) => {
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (
        (e.altKey && e.shiftKey && key === "s") ||
        (isCmdOrCtrl && e.shiftKey && key === "s")
      ) {
        if (document.getElementById("snapbyframe-host")) return;
        e.preventDefault();
        chrome.runtime.sendMessage({ action: "startCaptureFlow", mode: "screenshot" });
      } else if (
        (e.altKey && e.shiftKey && key === "r") ||
        (isCmdOrCtrl && e.shiftKey && key === "r")
      ) {
        if (document.getElementById("snapbyframe-host")) return;
        e.preventDefault();
        chrome.runtime.sendMessage({ action: "startCaptureFlow", mode: "record" });
      }
    },
    true
  );

  /**
   * Main overlay controller
   */
  function openScreenshotOverlay(initialBase64Image, initialMode = "screenshot") {
    if (document.getElementById("snapbyframe-host")) return;

    const DPR = window.devicePixelRatio || 1;
    const initialScrollX = window.scrollX;
    const initialScrollY = window.scrollY;
    const initialViewportWidth = window.innerWidth;
    const initialViewportHeight = window.innerHeight;

    // Attach Shadow DOM Host
    const host = document.createElement("div");
    host.id = "snapbyframe-host";
    host.style.cssText =
      "all:initial;position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:none;";
    document.documentElement.appendChild(host);
    const root = host.attachShadow({ mode: "open" });

    // CSS Styles
    const style = document.createElement("style");
    style.textContent = `
      :host, * { box-sizing: border-box; margin: 0; padding: 0; }
      * { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
      button { font: inherit; outline: none; border: none; cursor: pointer; }

      /* Fullscreen dark overlay backdrop */
      .backdrop {
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(0, 0, 0, 0.58);
        cursor: crosshair; pointer-events: auto;
        touch-action: none;
        transition: background 0.12s ease;
      }

      /* Hover highlight box */
      .hover-box {
        position: fixed; display: none; pointer-events: none;
        border: 2px dashed #00ddff;
        background: rgba(0, 221, 255, 0.15);
        border-radius: 4px;
        box-shadow: 0 0 12px rgba(0, 221, 255, 0.35);
        z-index: 10;
      }

      /* Compact, sleek Initial Top-Right Controls */
      .top-bar {
        position: fixed; top: 14px; right: 20px;
        display: flex; align-items: center; gap: 7px;
        background: rgba(18, 18, 24, 0.92);
        backdrop-filter: blur(20px);
        padding: 5px 8px; border-radius: 9999px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.55);
        user-select: none; pointer-events: auto;
        z-index: 100;
        animation: fadeInDown 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      }

      @keyframes fadeInDown {
        from { opacity: 0; transform: translateY(-6px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .compact-btn {
        display: flex; align-items: center; gap: 6px;
        padding: 6px 13px; border-radius: 9999px;
        font-size: 12px; font-weight: 600; letter-spacing: -0.1px;
        white-space: nowrap; cursor: pointer;
        transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .compact-btn svg { width: 15px; height: 15px; }

      .btn-fullpage {
        background: #2b2a33;
        color: #fbfbfe;
        border: 1px solid #52525e;
      }
      .btn-fullpage:hover {
        background: #383742;
        border-color: #8f8f9d;
        transform: translateY(-1px);
        box-shadow: 0 3px 12px rgba(0, 0, 0, 0.3);
      }
      .btn-fullpage:active { transform: translateY(0) scale(0.97); }

      .btn-visible {
        background: rgba(255, 255, 255, 0.08); color: #fbfbfe;
        border: 1px solid rgba(255, 255, 255, 0.18);
      }
      .btn-visible:hover {
        background: rgba(255, 255, 255, 0.15);
        border-color: rgba(255, 255, 255, 0.3);
        transform: translateY(-1px);
      }
      .btn-visible:active { transform: translateY(0) scale(0.97); }

      .top-divider {
        width: 1px; height: 18px;
        background: rgba(255, 255, 255, 0.15);
        margin: 0 2px;
      }

      /* Center helper text & icon */
      .center-guide {
        position: fixed; left: 50%; top: 50%;
        transform: translate(-50%, -50%);
        display: flex; flex-direction: column; align-items: center; gap: 12px;
        text-align: center; pointer-events: none; user-select: none;
        z-index: 50;
        animation: fadeIn 0.25s ease;
      }

      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      .guide-viewfinder { color: #fbfbfe; opacity: 0.9; }

      .guide-text {
        color: #ffffff; font-size: 16px; font-weight: 500;
        text-shadow: 0 2px 8px rgba(0, 0, 0, 0.8), 0 0 2px rgba(0, 0, 0, 0.9);
        max-width: 360px; line-height: 1.45;
      }

      .guide-cancel-btn {
        pointer-events: auto; cursor: pointer;
        background: #2b2a33; color: #fbfbfe;
        border: 1px solid #52525e;
        border-radius: 9999px; padding: 7px 22px;
        font-size: 13px; font-weight: 500;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
        transition: all 0.15s ease;
      }
      .guide-cancel-btn:hover {
        background: #383742; border-color: #8f8f9d; transform: translateY(-1px);
      }

      /* Selection Box with Cutout Mask (Firefox Style Dashed Border) */
      .selection-box {
        position: fixed; display: none;
        border: 2px dashed #ffffff;
        box-shadow: 0 0 0 99999px rgba(0, 0, 0, 0.65);
        cursor: move; pointer-events: auto;
        touch-action: none;
        z-index: 20;
      }

      /* In-Place Annotation Canvas directly on selection */
      .annotation-canvas {
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        pointer-events: none; z-index: 15;
      }

      /* 8 Resize Handles */
      .resize-handle {
        position: absolute; width: 12px; height: 12px;
        background: #ffffff; border: 2px solid #0060df;
        border-radius: 50%; box-shadow: 0 1px 6px rgba(0,0,0,0.6);
        pointer-events: auto; z-index: 25;
        touch-action: none;
      }
      .resize-handle::before {
        content: ""; position: absolute;
        top: -8px; left: -8px; width: 28px; height: 28px;
        border-radius: 50%;
      }

      .handle-nw { top: -7px; left: -7px; cursor: nwse-resize; }
      .handle-n  { top: -7px; left: calc(50% - 6px); cursor: ns-resize; }
      .handle-ne { top: -7px; right: -7px; cursor: nesw-resize; }
      .handle-e  { top: calc(50% - 6px); right: -7px; cursor: ew-resize; }
      .handle-se { bottom: -7px; right: -7px; cursor: nwse-resize; }
      .handle-s  { bottom: -7px; left: calc(50% - 6px); cursor: ns-resize; }
      .handle-sw { bottom: -7px; left: -7px; cursor: nesw-resize; }
      .handle-w  { top: calc(50% - 6px); left: -7px; cursor: ew-resize; }

      /* Dimension Badge */
      .dim-badge {
        position: absolute; bottom: 8px; right: 8px;
        font-size: 11px; font-weight: 600; color: #fbfbfe;
        padding: 3px 8px; background: rgba(0, 0, 0, 0.75);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 6px; white-space: nowrap; pointer-events: none;
        z-index: 22;
      }

      /* Unified In-Page Toolbar */
      .unified-toolbar {
        position: fixed; display: none; align-items: center; gap: 7px;
        background: rgba(22, 22, 28, 0.94);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-radius: 9999px; padding: 6px 14px;
        box-shadow: 0 10px 32px rgba(0, 0, 0, 0.75);
        pointer-events: auto; z-index: 2147483647; user-select: none;
        animation: fadeIn 0.15s ease;
      }

      .tool-btn {
        width: 32px; height: 32px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        background: transparent; color: #a0a0b2; cursor: pointer;
        border: none;
        transition: all 0.12s ease;
      }
      .tool-btn svg {
        width: 17px; height: 17px;
        pointer-events: none;
      }
      .tool-btn:hover { background: rgba(255, 255, 255, 0.12); color: #fff; transform: scale(1.05); }
      .tool-btn.active {
        background: #0060df; color: #fff; font-weight: 600;
        box-shadow: 0 0 10px rgba(0, 96, 223, 0.5);
      }

      .color-dot {
        width: 14px; height: 14px; border-radius: 50%; cursor: pointer;
        border: 2px solid transparent; transition: transform 0.1s;
      }
      .color-dot:hover { transform: scale(1.2); }
      .color-dot.active { border-color: #fff; transform: scale(1.25); }

      .color-palette {
        display: flex; align-items: center; gap: 6px;
        padding: 0 4px;
      }

      /* Small, subtle Undo & Redo Buttons */
      .btn-circle-small {
        width: 26px; height: 26px; border-radius: 50%;
        background: rgba(255, 255, 255, 0.08); color: #ccc;
        display: flex; align-items: center; justify-content: center;
        font-size: 13px; cursor: pointer; transition: all 0.15s ease;
        border: 1px solid rgba(255, 255, 255, 0.16);
      }
      .btn-circle-small:hover {
        background: rgba(255, 255, 255, 0.18); color: #fff; transform: scale(1.05);
      }
      .btn-circle-small:active { transform: scale(0.95); }

      /* Small, subtle Cancel Button (not heavily highlighted) */
      .btn-cancel-small {
        width: 24px; height: 24px; border-radius: 50%;
        background: transparent; color: #8f8f9d;
        display: flex; align-items: center; justify-content: center;
        font-size: 12px; cursor: pointer; transition: all 0.15s ease;
        border: 1px solid rgba(255, 255, 255, 0.14);
        margin: 0 2px;
      }
      .btn-cancel-small:hover {
        background: rgba(255, 255, 255, 0.15); color: #fff;
        border-color: rgba(255, 255, 255, 0.3);
      }
      .btn-cancel-small:active { transform: scale(0.94); }

      /* Firefox Screenshot Action Buttons */
      .act-copy-btn {
        background: #2b2a33; color: #ffffff;
        border: 1.5px solid #52525e;
        border-radius: 9999px; padding: 6px 16px;
        font-size: 13px; font-weight: 600;
        display: flex; align-items: center; gap: 6px;
        white-space: nowrap; cursor: pointer;
        transition: all 0.15s ease;
      }
      .act-copy-btn:hover {
        background: #383742; border-color: #8f8f9d; transform: translateY(-1px);
        box-shadow: 0 3px 12px rgba(0,0,0,0.3);
      }
      .act-copy-btn:active { transform: translateY(0) scale(0.97); }

      .act-download-btn {
        background: #2b2a33; color: #ffffff;
        border: 1.5px solid #52525e;
        border-radius: 9999px; padding: 6px 16px;
        font-size: 13px; font-weight: 600;
        display: flex; align-items: center; gap: 6px;
        white-space: nowrap; cursor: pointer;
        transition: all 0.15s ease;
      }
      .act-download-btn:hover {
        background: #383742; border-color: #8f8f9d; transform: translateY(-1px);
        box-shadow: 0 3px 12px rgba(0,0,0,0.3);
      }
      .act-download-btn:active { transform: translateY(0) scale(0.97); }

      /* Mode Switching Pills in Top Bar */
      .mode-toggle-group {
        display: flex; align-items: center; background: rgba(0, 0, 0, 0.45);
        border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 9999px;
        padding: 2px; gap: 2px; margin: 0 4px;
      }
      .mode-btn {
        padding: 4px 10px; border-radius: 9999px; font-size: 11.5px; font-weight: 600;
        color: #a0a0b2; background: transparent; border: none; cursor: pointer;
        display: flex; align-items: center; gap: 5px; transition: all 0.12s ease;
      }
      .mode-btn svg { width: 13px; height: 13px; }
      .mode-btn:hover { color: #fff; }
      .mode-btn.active { background: #0060df; color: #fff; box-shadow: 0 1px 6px rgba(0, 96, 223, 0.4); }
      .mode-btn.active.rec-mode { background: #ff3b30; box-shadow: 0 1px 6px rgba(255, 59, 48, 0.4); }

      /* Recording Action Button */
      .act-record-btn {
        background: #ff3b30; color: #ffffff;
        border: none; border-radius: 9999px; padding: 6px 16px;
        font-size: 13px; font-weight: 600;
        display: flex; align-items: center; gap: 6px;
        white-space: nowrap; cursor: pointer;
        box-shadow: 0 2px 10px rgba(255, 59, 48, 0.4);
        transition: all 0.15s ease;
      }
      .act-record-btn svg { width: 14px; height: 14px; }
      .act-record-btn:hover {
        background: #ff453a; transform: translateY(-1px);
        box-shadow: 0 4px 14px rgba(255, 59, 48, 0.55);
      }
      .act-record-btn:active { transform: translateY(0) scale(0.97); }

      /* Active Recording Bounding Box */
      .selection-box.is-recording {
        border: 2.5px solid #ff3b30 !important;
        box-shadow: 0 0 16px rgba(255, 59, 48, 0.6) !important;
        cursor: default !important;
      }
      .selection-box.is-recording .resize-handle {
        display: none !important;
      }

      /* Floating Recording Control Bar */
      .floating-record-bar {
        position: fixed; display: none; align-items: center; gap: 12px;
        bottom: 28px; left: 50%; transform: translateX(-50%);
        background: rgba(20, 20, 26, 0.96);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 59, 48, 0.45);
        border-radius: 9999px; padding: 7px 18px;
        box-shadow: 0 10px 32px rgba(0, 0, 0, 0.8), 0 0 16px rgba(255, 59, 48, 0.3);
        pointer-events: auto; z-index: 2147483647; user-select: none;
        animation: fadeIn 0.15s ease;
      }
      .rec-indicator {
        display: flex; align-items: center; gap: 6px;
        font-size: 11.5px; font-weight: 700; color: #ff3b30;
      }
      .rec-dot {
        width: 9px; height: 9px; border-radius: 50%; background: #ff3b30;
        animation: pulseRed 1s infinite;
      }
      @keyframes pulseRed {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.3; transform: scale(0.8); }
      }
      .rec-timer {
        font-family: monospace, monospace; font-size: 14px; font-weight: 700;
        color: #ffffff; letter-spacing: 0.5px; min-width: 44px; text-align: center;
      }
      .btn-stop-rec {
        background: #ff3b30; color: #ffffff; border: none;
        border-radius: 9999px; padding: 6px 14px; font-size: 12.5px; font-weight: 600;
        cursor: pointer; display: flex; align-items: center; gap: 6px;
        box-shadow: 0 2px 8px rgba(255, 59, 48, 0.4);
        transition: all 0.12s ease;
      }
      .btn-stop-rec svg { width: 12px; height: 12px; }
      .btn-stop-rec:hover { background: #ff453a; transform: scale(1.04); }
      .btn-stop-rec:active { transform: scale(0.96); }

      /* Toast Notification */
      .toast {
        position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%);
        background: #1c1b22; color: #fff; padding: 10px 22px;
        border-radius: 10px; font-size: 13px; font-weight: 600;
        box-shadow: 0 8px 24px rgba(0,0,0,0.6);
        border: 1px solid rgba(255, 255, 255, 0.15);
        display: none; z-index: 2147483647; pointer-events: none;
        animation: popToast 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes popToast {
        from { opacity: 0; transform: translate(-50%, 10px); }
        to { opacity: 1; transform: translate(-50%, 0); }
      }
    `;
    root.appendChild(style);

    // ---- Inline SVGs ----------------------------------------------------
    const ICONS = {
      fullPage: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="5" y="2" width="14" height="20" rx="3"></rect>
        <line x1="8" y1="7" x2="16" y2="7"></line>
        <line x1="8" y1="11" x2="16" y2="11"></line>
        <line x1="8" y1="15" x2="13" y2="15"></line>
      </svg>`,
      visible: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="15" rx="2"></rect>
        <line x1="8" y1="21" x2="16" y2="21"></line>
        <line x1="12" y1="18" x2="12" y2="21"></line>
      </svg>`,
      viewfinder: `<svg width="40" height="40" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 11V6a2 2 0 0 1 2-2h5"></path>
        <path d="M32 11V6a2 2 0 0 0-2-2h-5"></path>
        <path d="M4 25v5a2 2 0 0 0 2 2h5"></path>
        <path d="M32 25v5a2 2 0 0 1-2 2h-5"></path>
        <rect x="10" y="12" width="16" height="12" rx="2"></rect>
        <circle cx="18" cy="18" r="3.5"></circle>
        <path d="M14 12V10a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"></path>
      </svg>`,
      copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>`,
      download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>`,
      close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>`,
      camera: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
        <circle cx="12" cy="13" r="4"></circle>
      </svg>`,
      videoCam: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="23 7 16 12 23 17 23 7"></polygon>
        <rect x="1" y="5" width="15" height="14" rx="2"></rect>
      </svg>`,
      recordCircle: `<svg viewBox="0 0 24 24" fill="currentColor">
        <circle cx="12" cy="12" r="7"></circle>
      </svg>`,
      stopSquare: `<svg viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="6" width="12" height="12" rx="2"></rect>
      </svg>`,
      pen: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
      </svg>`,
      highlight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m9 11-6 6v3h3l6-6"></path>
        <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"></path>
      </svg>`,
      arrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="5" y1="12" x2="19" y2="12"></line>
        <polyline points="12 5 19 12 12 19"></polyline>
      </svg>`,
      rect: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="3"></rect>
      </svg>`,
      line: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
        <line x1="4" y1="20" x2="20" y2="4"></line>
      </svg>`
    };

    // ---- DOM Elements ---------------------------------------------------
    const backdrop = document.createElement("div");
    backdrop.className = "backdrop";
    root.appendChild(backdrop);

    const hoverBox = document.createElement("div");
    hoverBox.className = "hover-box";
    root.appendChild(hoverBox);

    // Selection Box with In-Place Canvas & Handles
    const selectionBox = document.createElement("div");
    selectionBox.className = "selection-box";

    const annotationCanvas = document.createElement("canvas");
    annotationCanvas.className = "annotation-canvas";
    selectionBox.appendChild(annotationCanvas);

    const dimBadge = document.createElement("div");
    dimBadge.className = "dim-badge";
    dimBadge.textContent = "0 × 0";
    selectionBox.appendChild(dimBadge);

    const handlePositions = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
    handlePositions.forEach((pos) => {
      const h = document.createElement("div");
      h.className = `resize-handle handle-${pos}`;
      h.dataset.handle = pos;
      selectionBox.appendChild(h);
    });
    root.appendChild(selectionBox);

    // Initial Sleek Top Bar
    const topBar = document.createElement("div");
    topBar.className = "top-bar";
    topBar.innerHTML = `
      <div class="mode-toggle-group">
        <button class="mode-btn ${initialMode === "screenshot" ? "active" : ""}" id="sbf-mode-screenshot" title="Screenshot mode (Alt+Shift+S)">
          ${ICONS.camera}
          <span>Screenshot</span>
        </button>
        <button class="mode-btn rec-mode ${initialMode === "record" ? "active" : ""}" id="sbf-mode-record" title="Screen record mode (Alt+Shift+R)">
          ${ICONS.videoCam}
          <span>Record</span>
        </button>
      </div>
      <div class="top-divider"></div>
      <button class="compact-btn btn-fullpage" id="sbf-btn-fullpage" title="Capture the entire scrollable page" style="display:${initialMode === "record" ? "none" : "flex"};">
        ${ICONS.fullPage}
        <span>Full page</span>
      </button>
      <button class="compact-btn btn-visible" id="sbf-btn-visible" title="Select visible screen">
        ${ICONS.visible}
        <span>Visible area</span>
      </button>
      <div class="top-divider"></div>
      <button class="btn-cancel-small" id="sbf-btn-close-top" title="Cancel (ESC)">✕</button>
    `;
    root.appendChild(topBar);

    // Center Guide
    const centerGuide = document.createElement("div");
    centerGuide.className = "center-guide";
    centerGuide.innerHTML = `
      <div class="guide-viewfinder">${ICONS.viewfinder}</div>
      <div class="guide-text">${initialMode === "record" ? "Drag or click on the page to select recording area. Press ESC to cancel." : "Drag or click on the page to select a region. Press ESC to cancel."}</div>
      <button class="guide-cancel-btn" id="sbf-guide-cancel">Cancel</button>
    `;
    root.appendChild(centerGuide);

    // Unified Toolbar (Screenshot Annotation Tools & Recording Trigger)
    const unifiedToolbar = document.createElement("div");
    unifiedToolbar.className = "unified-toolbar";
    unifiedToolbar.innerHTML = `
      <div id="sbf-screenshot-tools" style="display:${initialMode === "screenshot" ? "flex" : "none"};align-items:center;gap:6px;">
        <button class="tool-btn active" data-tool="pen" title="Draw (Pen)">${ICONS.pen}</button>
        <button class="tool-btn" data-tool="highlight" title="Highlighter (Subtle)">${ICONS.highlight}</button>
        <button class="tool-btn" data-tool="arrow" title="Draw Arrow">${ICONS.arrow}</button>
        <button class="tool-btn" data-tool="rect" title="Draw Box">${ICONS.rect}</button>
        <button class="tool-btn" data-tool="line" title="Draw Line">${ICONS.line}</button>

        <div class="color-palette">
          <div class="color-dot active" data-color="#ff3b30" style="background:#ff3b30;" title="Red"></div>
          <div class="color-dot" data-color="#0a84ff" style="background:#0a84ff;" title="Blue"></div>
          <div class="color-dot" data-color="#30d158" style="background:#30d158;" title="Green"></div>
          <div class="color-dot" data-color="#ffd60a" style="background:#ffd60a;" title="Yellow"></div>
          <div class="color-dot" data-color="#ffffff" style="background:#ffffff;" title="White"></div>
          <div class="color-dot" data-color="#000000" style="background:#000000;border:1px solid #666;" title="Black"></div>
        </div>

        <div class="top-divider"></div>

        <button class="btn-circle-small" id="sbf-tool-undo" title="Undo one action (Ctrl+Z)">⟲</button>
        <button class="btn-circle-small" id="sbf-tool-redo" title="Redo (Ctrl+Y)">⟳</button>
        <button class="btn-cancel-small" id="sbf-tool-cancel" title="Cancel selection (ESC)">✕</button>
        <button class="act-copy-btn" id="sbf-tool-copy" title="Copy to clipboard">${ICONS.copy} Copy</button>
        <button class="act-download-btn" id="sbf-tool-download" title="Download image">${ICONS.download} Download</button>
      </div>

      <div id="sbf-record-tools" style="display:${initialMode === "record" ? "flex" : "none"};align-items:center;gap:8px;">
        <div style="font-size:12.5px;font-weight:600;color:#c0c0d0;padding:0 4px;">Area ready to record</div>
        <div class="top-divider"></div>
        <button class="btn-cancel-small" id="sbf-tool-rec-cancel" title="Cancel selection (ESC)">✕</button>
        <button class="act-record-btn" id="sbf-tool-start-record" title="Start recording this region">
          ${ICONS.recordCircle} <span>Start Recording</span>
        </button>
      </div>
    `;
    root.appendChild(unifiedToolbar);

    // Floating Recording Bar (Visible only while actively recording)
    const floatingRecordBar = document.createElement("div");
    floatingRecordBar.className = "floating-record-bar";
    floatingRecordBar.innerHTML = `
      <div class="rec-indicator">
        <div class="rec-dot"></div>
        <span>REC</span>
      </div>
      <div class="rec-timer" id="sbf-rec-timer">00:00</div>
      <button class="btn-stop-rec" id="sbf-btn-stop-rec" title="Finish and save recording">
        ${ICONS.stopSquare} <span>Finish</span>
      </button>
      <button class="btn-cancel-small" id="sbf-btn-cancel-rec" title="Cancel recording">✕</button>
    `;
    root.appendChild(floatingRecordBar);

    // Toast
    const toast = document.createElement("div");
    toast.className = "toast";
    root.appendChild(toast);
    let toastTimer = null;
    function showToast(msg, isError = false) {
      toast.textContent = msg;
      toast.style.borderColor = isError ? "#ff3b30" : "rgba(255, 255, 255, 0.2)";
      toast.style.display = "block";
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (toast.style.display = "none"), 2200);
    }

    // ---- State Management ------------------------------------------------
    let activeMode = initialMode; // "screenshot" | "record"
    let isRecording = false;
    let recordTimerInterval = null;
    let recordSeconds = 0;

    let isMouseDown = false;
    let isDraggingArea = false;
    let isResizing = false;
    let isMovingBox = false;
    let activeHandle = null;

    let dragStartPageX = 0;
    let dragStartPageY = 0;
    let selectionRect = null; // { pageX, pageY, width, height }
    let hoverRafPending = false;
    let autoscrollInterval = null;

    // Pristine Viewport Image (from initial tab capture)
    const pristineViewportImage = new Image();
    pristineViewportImage.src = initialBase64Image;

    // Full Page Cache (stores pre-stitched canvas from "Full page" capture)
    let cachedFullPageCanvas = null;
    let isFullPageMode = false;

    // Drawing Tool State
    let activeTool = "pen"; // 'pen' | 'highlight' | 'arrow' | 'rect' | 'line'
    let currentColor = "#ff3b30";
    let isDrawingOnCanvas = false;
    let drawStartX = 0;
    let drawStartY = 0;
    let lastDrawX = 0;
    let lastDrawY = 0;

    const canvasCtx = annotationCanvas.getContext("2d");
    const snapshotCanvas = document.createElement("canvas");
    const snapCtx = snapshotCanvas.getContext("2d");

    // History Stacks
    const undoStack = [];
    const redoStack = [];

    function onStrokeFinished() {
      if (annotationCanvas.width > 0 && annotationCanvas.height > 0) {
        const state = canvasCtx.getImageData(0, 0, annotationCanvas.width, annotationCanvas.height);
        undoStack.push(state);
        if (undoStack.length > 35) undoStack.shift();
        redoStack.length = 0;
      }
    }

    function undoDrawing() {
      if (undoStack.length === 0) return;
      const current = undoStack.pop();
      redoStack.push(current);

      if (undoStack.length > 0) {
        const prev = undoStack[undoStack.length - 1];
        canvasCtx.putImageData(prev, 0, 0);
      } else {
        canvasCtx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);
      }
    }

    function redoDrawing() {
      if (redoStack.length === 0) return;
      const next = redoStack.pop();
      undoStack.push(next);
      canvasCtx.putImageData(next, 0, 0);
    }

    /**
     * Hides all sticky and fixed elements right before capturing a slice
     * to eliminate duplicate search bars, floating headers, etc.
     */
    function hideStickyHeadersNow() {
      const hidden = [];
      try {
        const all = document.querySelectorAll("*");
        for (const el of all) {
          if (el.id === "snapbyframe-host" || el.closest("#snapbyframe-host")) continue;
          const s = window.getComputedStyle(el);
          if (s.position === "fixed" || s.position === "sticky") {
            const r = el.getBoundingClientRect();
            // Headers/navbars that stay stuck at the top of the viewport
            if (r.top <= 60 && r.height > 0 && r.height < window.innerHeight * 0.5) {
              hidden.push({
                el,
                vis: el.style.getPropertyValue("visibility"),
                visP: el.style.getPropertyPriority("visibility"),
                op: el.style.getPropertyValue("opacity"),
                opP: el.style.getPropertyPriority("opacity")
              });
              el.style.setProperty("visibility", "hidden", "important");
              el.style.setProperty("opacity", "0", "important");
            }
          }
        }
        // Explicitly catch Google searchbar container & common header IDs
        const gSearchSelectors = ["#searchform", "#tsf", ".sfbg", "#sfcnt", "header[role='banner']"];
        for (const sel of gSearchSelectors) {
          const el = document.querySelector(sel);
          if (el && !hidden.some((h) => h.el === el)) {
            hidden.push({
              el,
              vis: el.style.getPropertyValue("visibility"),
              visP: el.style.getPropertyPriority("visibility"),
              op: el.style.getPropertyValue("opacity"),
              opP: el.style.getPropertyPriority("opacity")
            });
            el.style.setProperty("visibility", "hidden", "important");
            el.style.setProperty("opacity", "0", "important");
          }
        }
      } catch (err) {
        console.error("hideStickyHeadersNow error:", err);
      }
      return () => {
        for (const h of hidden) {
          if (h.vis) h.el.style.setProperty("visibility", h.vis, h.visP);
          else h.el.style.removeProperty("visibility");
          if (h.op) h.el.style.setProperty("opacity", h.op, h.opP);
          else h.el.style.removeProperty("opacity");
        }
      };
    }

    // Element Hover detection
    function updateHover(clientX, clientY) {
      if (selectionRect || isDraggingArea || isResizing || isMovingBox) return;

      backdrop.style.pointerEvents = "none";
      const elem = document.elementFromPoint(clientX, clientY);
      backdrop.style.pointerEvents = "auto";

      if (!elem || elem === document.body || elem === document.documentElement) {
        hoverBox.style.display = "none";
        return;
      }

      const rect = elem.getBoundingClientRect();
      if (rect.width <= 2 || rect.height <= 2) {
        hoverBox.style.display = "none";
        return;
      }

      // Clamp hover highlight to the visible viewport (matches what element-click will select)
      const visLeft   = Math.max(0, rect.left);
      const visTop    = Math.max(0, rect.top);
      const visRight  = Math.min(window.innerWidth, rect.right);
      const visBottom = Math.min(window.innerHeight, rect.bottom);
      const visW = visRight  - visLeft;
      const visH = visBottom - visTop;

      if (visW <= 2 || visH <= 2) {
        hoverBox.style.display = "none";
        return;
      }

      hoverBox.style.display = "block";
      hoverBox.style.left   = `${visLeft}px`;
      hoverBox.style.top    = `${visTop}px`;
      hoverBox.style.width  = `${visW}px`;
      hoverBox.style.height = `${visH}px`;
    }

    /**
     * Position Unified Toolbar:
     * - Top-Right if selection covers the top area
     * - Bottom-Right if user scrolled down or selection extends to bottom
     */
    function positionUnifiedToolbar() {
      if (!selectionRect || isRecording) {
        unifiedToolbar.style.display = "none";
        return;
      }

      unifiedToolbar.style.display = "flex";
      const screenTop = selectionRect.pageY - window.scrollY;
      const screenBottom = screenTop + selectionRect.height;

      const isTopArea = screenTop <= 60 && screenBottom > 180;
      const isScrolledOrBottom = window.scrollY > 80 || screenBottom >= window.innerHeight - 80;

      if (isTopArea && !isScrolledOrBottom) {
        unifiedToolbar.style.top = "16px";
        unifiedToolbar.style.right = "24px";
        unifiedToolbar.style.bottom = "auto";
        unifiedToolbar.style.left = "auto";
      } else {
        unifiedToolbar.style.bottom = "20px";
        unifiedToolbar.style.right = "24px";
        unifiedToolbar.style.top = "auto";
        unifiedToolbar.style.left = "auto";
      }
    }

    // Render Selection Box & Remove Dimness inside Selected Area
    function updateSelectionView() {
      if (isRecording) {
        if (!selectionRect) return;
        const screenLeft = selectionRect.pageX - window.scrollX;
        const screenTop = selectionRect.pageY - window.scrollY;
        selectionBox.style.display = "block";
        selectionBox.style.left = `${screenLeft}px`;
        selectionBox.style.top = `${screenTop}px`;
        selectionBox.style.width = `${selectionRect.width}px`;
        selectionBox.style.height = `${selectionRect.height}px`;
        return;
      }

      if (!selectionRect) {
        backdrop.style.background = "rgba(0, 0, 0, 0.58)";
        selectionBox.style.display = "none";
        unifiedToolbar.style.display = "none";
        centerGuide.style.display = "flex";
        topBar.style.display = "flex";
        return;
      }

      // 100% Original Webpage Lighting inside the box!
      backdrop.style.background = "transparent";

      topBar.style.display = "none";
      centerGuide.style.display = "none";
      hoverBox.style.display = "none";

      const screenLeft = selectionRect.pageX - window.scrollX;
      const screenTop = selectionRect.pageY - window.scrollY;

      selectionBox.style.display = "block";
      selectionBox.style.left = `${screenLeft}px`;
      selectionBox.style.top = `${screenTop}px`;
      selectionBox.style.width = `${selectionRect.width}px`;
      selectionBox.style.height = `${selectionRect.height}px`;

      // Ensure canvas internal pixel resolution strictly matches selectionRect bounds scaled by DPR.
      // This guarantees aspect ratio consistency so all 4 sides of rectangles and shapes have identical thickness.
      const targetCanvasW = Math.round(selectionRect.width * DPR);
      const targetCanvasH = Math.round(selectionRect.height * DPR);

      if (annotationCanvas.width !== targetCanvasW || annotationCanvas.height !== targetCanvasH) {
        const temp = document.createElement("canvas");
        temp.width = annotationCanvas.width;
        temp.height = annotationCanvas.height;
        if (temp.width > 0 && temp.height > 0) {
          temp.getContext("2d").drawImage(annotationCanvas, 0, 0);
        }

        annotationCanvas.width = targetCanvasW;
        annotationCanvas.height = targetCanvasH;
        if (temp.width > 0 && temp.height > 0) {
          canvasCtx.drawImage(temp, 0, 0);
        }
      }

      // Update dimension badge with comma formatting (1,100 × 2,283)
      const wFormatted = Math.round(selectionRect.width).toLocaleString();
      const hFormatted = Math.round(selectionRect.height).toLocaleString();
      dimBadge.textContent = `${wFormatted} × ${hFormatted}`;

      const scTools = root.getElementById("sbf-screenshot-tools");
      const recTools = root.getElementById("sbf-record-tools");

      if (activeMode === "record") {
        if (scTools) scTools.style.display = "none";
        if (recTools) recTools.style.display = "flex";
        annotationCanvas.style.pointerEvents = "none";
        selectionBox.style.cursor = "move";
      } else {
        if (scTools) scTools.style.display = "flex";
        if (recTools) recTools.style.display = "none";
        if (activeTool) {
          annotationCanvas.style.pointerEvents = "auto";
          annotationCanvas.style.cursor = "crosshair";
          selectionBox.style.cursor = "default";
        } else {
          annotationCanvas.style.pointerEvents = "none";
          selectionBox.style.cursor = "move";
        }
      }

      positionUnifiedToolbar();
    }

    window.addEventListener("scroll", updateSelectionView, { passive: true });

    // Backdrop Pointer Events
    backdrop.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      isMouseDown = true;
      isDraggingArea = false;
      dragStartPageX = e.clientX + window.scrollX;
      dragStartPageY = e.clientY + window.scrollY;
      try {
        backdrop.setPointerCapture(e.pointerId);
      } catch {}
    });

    backdrop.addEventListener("pointerup", (e) => {
      try {
        backdrop.releasePointerCapture(e.pointerId);
      } catch {}

      if (isMouseDown && !isDraggingArea) {
        backdrop.style.pointerEvents = "none";
        const elem = document.elementFromPoint(e.clientX, e.clientY);
        backdrop.style.pointerEvents = "auto";

        if (elem && elem !== document.body && elem !== document.documentElement) {
          const rect = elem.getBoundingClientRect();
          if (rect.width > 2 && rect.height > 2) {
            // Clamp element rect to the visible viewport so the selection never
            // extends below/beyond the screen. User can drag handles to expand it.
            const clampedLeft   = Math.max(0, rect.left);
            const clampedTop    = Math.max(0, rect.top);
            const clampedRight  = Math.min(window.innerWidth,  rect.right);
            const clampedBottom = Math.min(window.innerHeight, rect.bottom);
            const clampedW = clampedRight  - clampedLeft;
            const clampedH = clampedBottom - clampedTop;

            if (clampedW > 2 && clampedH > 2) {
              selectionRect = {
                pageX:  clampedLeft + window.scrollX,
                pageY:  clampedTop  + window.scrollY,
                width:  clampedW,
                height: clampedH
              };
              isFullPageMode = false;
              updateSelectionView();
            } // end if clampedW > 2
          } // end if rect.width > 2
        } // end if elem
      } // end if isMouseDown && !isDraggingArea

      isMouseDown = false;
      isDraggingArea = false;
      clearInterval(autoscrollInterval);
    });

    backdrop.addEventListener("pointercancel", (e) => {
      try {
        backdrop.releasePointerCapture(e.pointerId);
      } catch {}
      isMouseDown = false;
      isDraggingArea = false;
      clearInterval(autoscrollInterval);
    });

    // Autoscroll only for resize handles (lets user pull selection beyond viewport edge).
    // Initial drag stays clamped to viewport for clean UX.
    function startResizeAutoscroll(clientY) {
      clearInterval(autoscrollInterval);
      if (clientY > window.innerHeight - 30) {
        autoscrollInterval = setInterval(() => {
          window.scrollBy(0, 14);
          updateSelectionView();
        }, 30);
      } else if (clientY < 30 && window.scrollY > 0) {
        autoscrollInterval = setInterval(() => {
          window.scrollBy(0, -14);
          updateSelectionView();
        }, 30);
      } else {
        clearInterval(autoscrollInterval);
      }
    }

    // Global Pointer Move Listener
    window.addEventListener("pointermove", (e) => {
      if ((e.buttons & 1) === 0) {
        if (isMouseDown || isDraggingArea || isResizing || isMovingBox) {
          isMouseDown = false;
          isDraggingArea = false;
          isResizing = false;
          isMovingBox = false;
          activeHandle = null;
          clearInterval(autoscrollInterval);
          updateSelectionView();
        }
      }

      const currentPageX = e.clientX + window.scrollX;
      const currentPageY = e.clientY + window.scrollY;

      // 1. Resizing Selection Box — no viewport clamp, user can extend beyond edge
      if (isResizing && selectionRect && activeHandle) {
        startResizeAutoscroll(e.clientY); // scroll page when handle near edge

        let { pageX, pageY, width, height } = selectionRect;
        const startR = pageX + width;
        const startB = pageY + height;

        if (activeHandle.includes("e")) width = Math.max(10, currentPageX - pageX);
        if (activeHandle.includes("s")) height = Math.max(10, currentPageY - pageY);
        if (activeHandle.includes("w")) {
          const newLeft = Math.min(startR - 10, currentPageX);
          width = startR - newLeft;
          pageX = newLeft;
        }
        if (activeHandle.includes("n")) {
          const newTop = Math.min(startB - 10, currentPageY);
          height = startB - newTop;
          pageY = newTop;
        }

        selectionRect = { pageX, pageY, width, height };
        isFullPageMode = false;
        updateSelectionView();
        return;
      }

      // 2. Moving Selection Box (clamp so box stays within viewport)
      if (isMovingBox && selectionRect) {
        const dx = currentPageX - dragStartPageX;
        const dy = currentPageY - dragStartPageY;
        dragStartPageX = currentPageX;
        dragStartPageY = currentPageY;

        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const sx = window.scrollX;
        const sy = window.scrollY;

        let newPageX = selectionRect.pageX + dx;
        let newPageY = selectionRect.pageY + dy;
        // Clamp so box stays inside visible viewport
        newPageX = Math.max(sx, Math.min(newPageX, sx + vw - selectionRect.width));
        newPageY = Math.max(sy, Math.min(newPageY, sy + vh - selectionRect.height));

        selectionRect.pageX = newPageX;
        selectionRect.pageY = newPageY;
        isFullPageMode = false;
        updateSelectionView();
        return;
      }

      // 3. Dragging Area to Create Selection (clamped to visible viewport — no autoscroll)
      if (isMouseDown) {
        const dist = Math.hypot(currentPageX - dragStartPageX, currentPageY - dragStartPageY);
        if (dist > 3) isDraggingArea = true;
      }

      if (isDraggingArea) {
        // Clamp drag endpoint to current visible viewport
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const sx = window.scrollX;
        const sy = window.scrollY;
        const clampedX = Math.max(sx, Math.min(sx + vw, currentPageX));
        const clampedY = Math.max(sy, Math.min(sy + vh, currentPageY));

        const pageX = Math.min(dragStartPageX, clampedX);
        const pageY = Math.min(dragStartPageY, clampedY);
        const width = Math.abs(clampedX - dragStartPageX);
        const height = Math.abs(clampedY - dragStartPageY);

        if (width > 2 && height > 2) {
          selectionRect = { pageX, pageY, width, height };
          isFullPageMode = false;
          updateSelectionView();
        }
        return;
      }

      // 4. Hover element highlight
      if (!hoverRafPending) {
        hoverRafPending = true;
        requestAnimationFrame(() => {
          hoverRafPending = false;
          updateHover(e.clientX, e.clientY);
        });
      }
    });

    window.addEventListener("pointerup", () => {
      clearInterval(autoscrollInterval);
      if (isResizing) {
        isResizing = false;
        activeHandle = null;
        updateSelectionView();
      }
      if (isMovingBox) {
        isMovingBox = false;
        updateSelectionView();
      }
      isMouseDown = false;
      isDraggingArea = false;
    });

    // Resize Handles Pointer Listeners
    selectionBox.querySelectorAll(".resize-handle").forEach((handle) => {
      handle.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        isResizing = true;
        activeHandle = handle.dataset.handle;
        dragStartPageX = e.clientX + window.scrollX;
        dragStartPageY = e.clientY + window.scrollY;
        try {
          handle.setPointerCapture(e.pointerId);
        } catch {}
      });

      handle.addEventListener("pointerup", (e) => {
        try {
          handle.releasePointerCapture(e.pointerId);
        } catch {}
        isResizing = false;
        activeHandle = null;
        clearInterval(autoscrollInterval);
        updateSelectionView();
      });

      handle.addEventListener("pointercancel", (e) => {
        try {
          handle.releasePointerCapture(e.pointerId);
        } catch {}
        isResizing = false;
        activeHandle = null;
        clearInterval(autoscrollInterval);
        updateSelectionView();
      });
    });

    // Selection box move pointer listener
    selectionBox.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.classList.contains("resize-handle")) return;
      if (activeTool) return;

      e.stopPropagation();
      isMovingBox = true;
      dragStartPageX = e.clientX + window.scrollX;
      dragStartPageY = e.clientY + window.scrollY;
      try {
        selectionBox.setPointerCapture(e.pointerId);
      } catch {}
    });

    selectionBox.addEventListener("pointerup", (e) => {
      try {
        selectionBox.releasePointerCapture(e.pointerId);
      } catch {}
      isMovingBox = false;
      updateSelectionView();
    });

    // =========================================================================
    // In-Place Drawing (Pen, Subtle Highlighter, Arrow, Box, Line)
    // =========================================================================

    const toolBtns = unifiedToolbar.querySelectorAll(".tool-btn[data-tool]");
    toolBtns.forEach((btn) => {
      btn.onclick = () => {
        const tool = btn.dataset.tool;
        if (activeTool === tool) {
          activeTool = null;
          btn.classList.remove("active");
          annotationCanvas.style.pointerEvents = "none";
          selectionBox.style.cursor = "move";
        } else {
          toolBtns.forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          activeTool = tool;
          if (tool === "highlight" && (currentColor === "#ff3b30" || currentColor === "#000000")) {
            const yellowDot = unifiedToolbar.querySelector(".color-dot[data-color='#ffd60a']");
            if (yellowDot) yellowDot.click();
          }
          annotationCanvas.style.pointerEvents = "auto";
          annotationCanvas.style.cursor = "crosshair";
          selectionBox.style.cursor = "default";
        }
      };
    });

    const colorDots = unifiedToolbar.querySelectorAll(".color-dot");
    colorDots.forEach((dot) => {
      dot.onclick = () => {
        colorDots.forEach((d) => d.classList.remove("active"));
        dot.classList.add("active");
        currentColor = dot.dataset.color;
      };
    });

    function getCanvasCoords(e) {
      const rect = annotationCanvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * annotationCanvas.width;
      const y = ((e.clientY - rect.top) / rect.height) * annotationCanvas.height;
      return {
        x: Math.max(0, Math.min(annotationCanvas.width, x)),
        y: Math.max(0, Math.min(annotationCanvas.height, y))
      };
    }

    function drawArrowOnCtx(ctx, x0, y0, x1, y1) {
      const headLen = 15 * DPR;
      const angle = Math.atan2(y1 - y0, x1 - x0);
      const lineEndX = x1 - (headLen / 2) * Math.cos(angle);
      const lineEndY = y1 - (headLen / 2) * Math.sin(angle);

      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(lineEndX, lineEndY);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - headLen * Math.cos(angle - Math.PI / 6), y1 - headLen * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(x1 - headLen * Math.cos(angle + Math.PI / 6), y1 - headLen * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
    }

    annotationCanvas.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || !activeTool) return;
      e.stopPropagation();
      const pos = getCanvasCoords(e);
      drawStartX = pos.x;
      drawStartY = pos.y;
      lastDrawX = pos.x;
      lastDrawY = pos.y;

      isDrawingOnCanvas = true;

      snapshotCanvas.width = annotationCanvas.width;
      snapshotCanvas.height = annotationCanvas.height;
      snapCtx.clearRect(0, 0, snapshotCanvas.width, snapshotCanvas.height);
      snapCtx.drawImage(annotationCanvas, 0, 0);
    });

    annotationCanvas.addEventListener("mousemove", (e) => {
      if (!isDrawingOnCanvas || !activeTool) return;
      e.stopPropagation();
      const pos = getCanvasCoords(e);

      if (activeTool === "highlight") {
        // Windows Snipping Tool text highlighter:
        // Clears preview back to snapshot (eliminates dark overlapping blobs)
        // and draws a clean, straight horizontal highlight bar over the text line.
        canvasCtx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);
        canvasCtx.drawImage(snapshotCanvas, 0, 0);

        canvasCtx.save();
        canvasCtx.globalAlpha = 0.42;
        canvasCtx.strokeStyle = currentColor;
        canvasCtx.lineWidth = 18 * DPR;
        canvasCtx.lineCap = "square";
        canvasCtx.lineJoin = "miter";

        // Lock to a straight horizontal line across the text unless dragged vertically
        const dx = pos.x - drawStartX;
        const dy = pos.y - drawStartY;
        let endX = pos.x;
        let endY = drawStartY; // straight horizontal highlight across text line

        if (Math.abs(dy) > Math.abs(dx) * 1.5) {
          // Dragging vertically down a column
          endX = drawStartX;
          endY = pos.y;
        }

        canvasCtx.beginPath();
        canvasCtx.moveTo(drawStartX, drawStartY);
        canvasCtx.lineTo(endX, endY);
        canvasCtx.stroke();
        canvasCtx.restore();
        return;
      }

      if (activeTool === "pen") {
        canvasCtx.save();
        canvasCtx.globalAlpha = 1.0;
        canvasCtx.strokeStyle = currentColor;
        canvasCtx.lineWidth = 3.5 * DPR;
        canvasCtx.lineCap = "round";
        canvasCtx.lineJoin = "round";
        canvasCtx.beginPath();
        canvasCtx.moveTo(lastDrawX, lastDrawY);
        canvasCtx.lineTo(pos.x, pos.y);
        canvasCtx.stroke();
        canvasCtx.restore();
        lastDrawX = pos.x;
        lastDrawY = pos.y;
        return;
      }

      canvasCtx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);
      canvasCtx.drawImage(snapshotCanvas, 0, 0);

      canvasCtx.save();
      canvasCtx.globalAlpha = 1.0;
      canvasCtx.strokeStyle = currentColor;
      canvasCtx.fillStyle = currentColor;
      canvasCtx.lineWidth = 3 * DPR;
      canvasCtx.lineCap = "round";
      canvasCtx.lineJoin = "round";

      if (activeTool === "line") {
        canvasCtx.beginPath();
        canvasCtx.moveTo(drawStartX, drawStartY);
        canvasCtx.lineTo(pos.x, pos.y);
        canvasCtx.stroke();
      } else if (activeTool === "arrow") {
        drawArrowOnCtx(canvasCtx, drawStartX, drawStartY, pos.x, pos.y);
      } else if (activeTool === "rect") {
        canvasCtx.strokeRect(drawStartX, drawStartY, pos.x - drawStartX, pos.y - drawStartY);
      }
      canvasCtx.restore();
    });

    function endDrawingOnCanvas(e) {
      if (!isDrawingOnCanvas) return;
      e?.stopPropagation();
      isDrawingOnCanvas = false;
      onStrokeFinished();
    }
    annotationCanvas.addEventListener("mouseup", endDrawingOnCanvas);
    annotationCanvas.addEventListener("mouseleave", endDrawingOnCanvas);

    // =========================================================================
    // Screenshot Retrieval & Compositing Engine
    // =========================================================================

    // Detects true webpage background color (e.g. #202124 for dark theme, #ffffff for light theme)
    function getPageBackgroundColor() {
      try {
        let el = document.body;
        while (el) {
          const bg = window.getComputedStyle(el).backgroundColor;
          if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") {
            return bg;
          }
          el = el.parentElement;
        }
      } catch {}
      try {
        const docBg = window.getComputedStyle(document.documentElement).backgroundColor;
        if (docBg && docBg !== "transparent" && docBg !== "rgba(0, 0, 0, 0)") {
          return docBg;
        }
      } catch {}
      if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
        return "#202124";
      }
      return "#ffffff";
    }

    /**
     * Obtains the base screenshot canvas for selectionRect.
     *
     * 1. Full page mode → cachedFullPageCanvas (instant, zero work).
     * 2. Selection fits in current viewport → fresh single capture + 1:1 crop (no quality loss).
     * 3. Selection extends beyond viewport → multi-slice capture with host hidden
     *    (no visible page rendering flicker).
     */
    async function getBaseScreenshotCanvas(rect) {
      const pageBg = getPageBackgroundColor();

      // 1. Full Page Mode: use cached stitched canvas (instant)
      if (isFullPageMode && cachedFullPageCanvas) {
        return cachedFullPageCanvas;
      }

      // Determine if the selection fits entirely within the current viewport
      const curScrollX = window.scrollX;
      const curScrollY = window.scrollY;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const selClientLeft   = rect.pageX - curScrollX;
      const selClientTop    = rect.pageY - curScrollY;
      const selClientRight  = selClientLeft + rect.width;
      const selClientBottom = selClientTop  + rect.height;

      const fitsInViewport =
        selClientLeft >= -1 && selClientTop >= -1 &&
        selClientRight  <= vw + 1 && selClientBottom <= vh + 1;

      // ── CASE 2: Fits in current viewport ──────────────────────────────────
      if (fitsInViewport) {
        host.style.display = "none";
        await new Promise((r) => setTimeout(r, 60));

        const res = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: "captureSlice" }, resolve);
        });

        host.style.display = "block";

        if (!res?.ok || !res.dataUrl) {
          const blank = document.createElement("canvas");
          blank.width  = Math.round(rect.width  * DPR);
          blank.height = Math.round(rect.height * DPR);
          const bCtx = blank.getContext("2d");
          bCtx.fillStyle = pageBg;
          bCtx.fillRect(0, 0, blank.width, blank.height);
          return blank;
        }

        const snapScrollX = window.scrollX;
        const snapScrollY = window.scrollY;

        const canvas = document.createElement("canvas");
        await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            // Convert page → screen → pixel coordinates at moment of capture
            const srcX = Math.round((rect.pageX - snapScrollX) * DPR);
            const srcY = Math.round((rect.pageY - snapScrollY) * DPR);
            const srcW = Math.round(rect.width  * DPR);
            const srcH = Math.round(rect.height * DPR);

            // Clamp to image bounds
            const safeX = Math.max(0, Math.min(srcX, img.width  - 1));
            const safeY = Math.max(0, Math.min(srcY, img.height - 1));
            const safeW = Math.min(srcW, img.width  - safeX);
            const safeH = Math.min(srcH, img.height - safeY);

            // 1:1 pixel copy with opaque page background
            canvas.width  = safeW;
            canvas.height = safeH;
            const cCtx = canvas.getContext("2d");
            cCtx.fillStyle = pageBg;
            cCtx.fillRect(0, 0, safeW, safeH);
            cCtx.drawImage(img, safeX, safeY, safeW, safeH, 0, 0, safeW, safeH);
            resolve();
          };
          img.onerror = () => { canvas.width = 1; canvas.height = 1; resolve(); };
          img.src = res.dataUrl;
        });

        return canvas;
      }

      // ── CASE 3: Selection extends beyond viewport — multi-slice capture ────
      // Host is hidden so there is NO visible page rendering during scroll.
      host.style.display = "none";

      const origScrollX = window.scrollX;
      const origScrollY = window.scrollY;
      const maxScrollY  = Math.max(0, document.documentElement.scrollHeight - vh);

      // Build slices covering the full selection height
      const slicePositions = [];
      let sliceTop = rect.pageY;
      const selEndY = rect.pageY + rect.height;

      while (sliceTop < selEndY) {
        const targetScrollY = Math.min(Math.max(0, Math.floor(sliceTop)), maxScrollY);
        const sliceH = Math.min(vh, selEndY - sliceTop);
        slicePositions.push({ targetScrollY, captureStartY: sliceTop, captureHeight: sliceH });
        sliceTop += sliceH;
        if (targetScrollY >= maxScrollY) break;
      }

      const finalCanvas = document.createElement("canvas");
      finalCanvas.width  = Math.round(rect.width  * DPR);
      finalCanvas.height = Math.round(rect.height * DPR);
      const ctx = finalCanvas.getContext("2d");
      // Pre-fill entire canvas with opaque page background
      ctx.fillStyle = pageBg;
      ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);

      for (let i = 0; i < slicePositions.length; i++) {
        const slice = slicePositions[i];
        window.scrollTo({ left: 0, top: slice.targetScrollY, behavior: "instant" });
        await new Promise((r) => setTimeout(r, 70));

        // Hide sticky headers on slices after the first to prevent duplicates
        const restoreHeaders = i > 0 ? hideStickyHeadersNow() : () => {};
        if (i > 0) await new Promise((r) => setTimeout(r, 30));

        const actualScrollX = window.scrollX;
        const actualScrollY = window.scrollY;

        const res = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: "captureSlice" }, resolve);
        });
        restoreHeaders();

        if (res?.ok && res.dataUrl) {
          await new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
              const srcX = Math.round((rect.pageX - actualScrollX) * DPR);
              const srcY = Math.round((slice.captureStartY - actualScrollY) * DPR);

              const safeX = Math.max(0, Math.min(srcX, img.width  - 1));
              const safeY = Math.max(0, Math.min(srcY, img.height - 1));
              const safeW = Math.min(Math.round(rect.width * DPR), img.width  - safeX);

              // Calculate exact destination bounds with 1px overlap to guarantee ZERO seams
              const dstY = Math.round((slice.captureStartY - rect.pageY) * DPR);
              const nextDstY = (i < slicePositions.length - 1)
                ? Math.round((slicePositions[i + 1].captureStartY - rect.pageY) * DPR)
                : finalCanvas.height;
              const dstH = Math.max(1, (nextDstY - dstY) + (i < slicePositions.length - 1 ? 1 : 0));
              const safeH = Math.min(dstH, img.height - safeY);

              // Draw slice seamlessly spanning full canvas width
              ctx.drawImage(img, safeX, safeY, safeW, safeH, 0, dstY, finalCanvas.width, dstH);
              resolve();
            };
            img.onerror = () => resolve();
            img.src = res.dataUrl;
          });
        }
      }

      window.scrollTo({ left: origScrollX, top: origScrollY, behavior: "instant" });
      host.style.display = "block";
      return finalCanvas;
    }

    /**
     * Composites base webpage screenshot and any in-place user annotations
     */
    async function getFinalAnnotatedCanvas() {
      if (!selectionRect) return null;
      const baseCanvas = await getBaseScreenshotCanvas(selectionRect);

      const pageBg = getPageBackgroundColor();
      const finalCanvas = document.createElement("canvas");
      finalCanvas.width = baseCanvas.width;
      finalCanvas.height = baseCanvas.height;
      const ctx = finalCanvas.getContext("2d");

      // Fill with opaque page background
      ctx.fillStyle = pageBg;
      ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);

      ctx.drawImage(baseCanvas, 0, 0);

      // Composite user drawings if any were drawn
      if (annotationCanvas.width > 0 && annotationCanvas.height > 0) {
        ctx.drawImage(annotationCanvas, 0, 0, finalCanvas.width, finalCanvas.height);
      }

      return finalCanvas;
    }

    // Helper: Copy canvas to clipboard (Guaranteed 100% opaque, ZERO white lines)
    async function copyCanvas(canvas) {
      const pageBg = getPageBackgroundColor();
      // Flatten onto a guaranteed opaque canvas so Windows clipboard never turns
      // transparent pixels or anti-aliasing into white lines
      const opaqueCanvas = document.createElement("canvas");
      opaqueCanvas.width = canvas.width;
      opaqueCanvas.height = canvas.height;
      const oCtx = opaqueCanvas.getContext("2d");
      oCtx.fillStyle = pageBg;
      oCtx.fillRect(0, 0, opaqueCanvas.width, opaqueCanvas.height);
      oCtx.drawImage(canvas, 0, 0);

      return new Promise((resolve) => {
        opaqueCanvas.toBlob(async (blob) => {
          if (!blob) {
            showToast("Failed to generate image.", true);
            resolve(false);
            return;
          }
          try {
            if (!document.hasFocus()) window.focus();
            await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
            showToast("Copied to clipboard!");
            resolve(true);
          } catch (err) {
            console.error("Clipboard copy failed:", err);
            showToast("Clipboard copy failed. Try Download instead.", true);
            resolve(false);
          }
        }, "image/png");
      });
    }

    // Helper: Download canvas via Data URL (100% reliable with chrome.downloads in MV3)
    function downloadCanvas(canvas, filename = "screenshot.png") {
      try {
        const dataUrl = canvas.toDataURL("image/png");
        chrome.runtime.sendMessage(
          { action: "saveScreenshot", dataUrl, filename },
          (response) => {
            if (chrome.runtime.lastError || !response?.ok) {
              showToast("Download failed.", true);
            } else {
              showToast("Screenshot downloaded!");
            }
          }
        );
      } catch (err) {
        console.error("downloadCanvas error:", err);
        showToast("Download failed.", true);
      }
    }

    // ---- Actions --------------------------------------------------------

    function setMode(mode) {
      if (isRecording) return;
      activeMode = mode;
      const btnSc = root.getElementById("sbf-mode-screenshot");
      const btnRec = root.getElementById("sbf-mode-record");
      const btnFullPage = root.getElementById("sbf-btn-fullpage");
      const guideText = root.querySelector(".guide-text");

      if (mode === "record") {
        btnSc?.classList.remove("active");
        btnRec?.classList.add("active");
        if (btnFullPage) btnFullPage.style.display = "none";
        if (guideText) guideText.textContent = "Drag or click on the page to select recording area. Press ESC to cancel.";
      } else {
        btnRec?.classList.remove("active");
        btnSc?.classList.add("active");
        if (btnFullPage) btnFullPage.style.display = "flex";
        if (guideText) guideText.textContent = "Drag or click on the page to select a region. Press ESC to cancel.";
      }
      updateSelectionView();
    }

    // Start / Stop Recording
    async function startRecordingFlow() {
      if (!selectionRect || isRecording) return;
      isRecording = true;

      // Crop coordinates relative to current visible viewport
      const crop = {
        x: Math.max(0, selectionRect.pageX - window.scrollX),
        y: Math.max(0, selectionRect.pageY - window.scrollY),
        width: Math.min(window.innerWidth, selectionRect.width),
        height: Math.min(window.innerHeight, selectionRect.height),
        vw: window.innerWidth,
        vh: window.innerHeight
      };

      // Hide toolbars and dim badges
      unifiedToolbar.style.display = "none";
      topBar.style.display = "none";
      centerGuide.style.display = "none";
      dimBadge.style.display = "none";

      // Make overlay completely transparent & click-through so user can interact with webpage
      backdrop.style.display = "none";
      backdrop.style.pointerEvents = "none";
      selectionBox.classList.add("is-recording");
      selectionBox.style.pointerEvents = "none";
      annotationCanvas.style.pointerEvents = "none";

      // Show floating record bar
      floatingRecordBar.style.display = "flex";
      recordSeconds = 0;
      const timerEl = root.getElementById("sbf-rec-timer");
      if (timerEl) timerEl.textContent = "00:00";

      recordTimerInterval = setInterval(() => {
        recordSeconds++;
        const mins = String(Math.floor(recordSeconds / 60)).padStart(2, "0");
        const secs = String(recordSeconds % 60).padStart(2, "0");
        if (timerEl) timerEl.textContent = `${mins}:${secs}`;
      }, 1000);

      // Tell background service worker to start tabCapture & offscreen recording
      chrome.runtime.sendMessage({ action: "startRecording", crop }, (res) => {
        if (chrome.runtime.lastError || !res?.ok) {
          console.error("Start recording error:", chrome.runtime.lastError || res?.error);
          stopRecordingFlow(false);
          showToast("Could not start recording. Refresh tab and try again.", true);
        }
      });
    }

    async function stopRecordingFlow(save = true) {
      if (!isRecording) return;
      isRecording = false;

      if (recordTimerInterval) {
        clearInterval(recordTimerInterval);
        recordTimerInterval = null;
      }
      floatingRecordBar.style.display = "none";

      if (save) {
        showToast("Saving recording...");
      }

      chrome.runtime.sendMessage({ action: "stopRecording", save }, (res) => {
        if (chrome.runtime.lastError || !res?.ok) {
          console.error("Stop recording error:", chrome.runtime.lastError || res?.error);
          if (save) showToast("Failed to save recording.", true);
        } else if (save && res?.saved) {
          showToast("Recording saved! Check downloads.");
        }
        setTimeout(teardownOverlay, 500);
      });
    }

    function resetSelection() {
      if (isRecording) {
        stopRecordingFlow(false);
        return;
      }
      selectionRect = null;
      isFullPageMode = false;
      cachedFullPageCanvas = null;
      undoStack.length = 0;
      redoStack.length = 0;
      canvasCtx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);
      annotationCanvas.style.pointerEvents = "none";
      updateSelectionView();
    }

    // Mode Switchers
    root.getElementById("sbf-mode-screenshot").onclick = () => setMode("screenshot");
    root.getElementById("sbf-mode-record").onclick = () => setMode("record");

    // Record Action Buttons
    root.getElementById("sbf-tool-rec-cancel").onclick = resetSelection;
    root.getElementById("sbf-tool-start-record").onclick = startRecordingFlow;
    root.getElementById("sbf-btn-stop-rec").onclick = () => stopRecordingFlow(true);
    root.getElementById("sbf-btn-cancel-rec").onclick = () => stopRecordingFlow(false);

    root.getElementById("sbf-tool-undo").onclick = undoDrawing;
    root.getElementById("sbf-tool-redo").onclick = redoDrawing;
    root.getElementById("sbf-tool-cancel").onclick = resetSelection;
    root.getElementById("sbf-guide-cancel").onclick = teardownOverlay;
    root.getElementById("sbf-btn-close-top").onclick = teardownOverlay;

    // Unified Toolbar: Copy (INSTANT — 0 delay, 0 re-scrolling!)
    root.getElementById("sbf-tool-copy").onclick = async () => {
      const canvas = await getFinalAnnotatedCanvas();
      if (!canvas) return;
      const ok = await copyCanvas(canvas);
      if (ok) setTimeout(teardownOverlay, 500);
    };

    // Unified Toolbar: Download (INSTANT — 0 delay, 0 re-scrolling!)
    root.getElementById("sbf-tool-download").onclick = async () => {
      const canvas = await getFinalAnnotatedCanvas();
      if (!canvas) return;
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      downloadCanvas(canvas, `screenshot-${timestamp}.png`);
      setTimeout(teardownOverlay, 500);
    };

    // Top Bar: "Visible area" button (Instant viewport capture from initial image!)
    root.getElementById("sbf-btn-visible").onclick = () => {
      isFullPageMode = false;
      cachedFullPageCanvas = null;
      selectionRect = {
        pageX: window.scrollX,
        pageY: window.scrollY,
        width: window.innerWidth,
        height: window.innerHeight
      };
      updateSelectionView();
    };

    // Top Bar: "Full page" button
    root.getElementById("sbf-btn-fullpage").onclick = async () => {
      // 1. Give instant feedback
      showToast("Capturing full page...");

      const origX = window.scrollX;
      const origY = window.scrollY;

      const docEl = document.documentElement;
      const body = document.body;
      const totalWidth = Math.max(docEl.scrollWidth, body ? body.scrollWidth : 0, window.innerWidth);
      const totalHeight = Math.min(
        24000,
        Math.max(
          docEl.scrollHeight,
          body ? body.scrollHeight : 0,
          docEl.offsetHeight,
          body ? body.offsetHeight : 0,
          window.innerHeight
        )
      );

      const vh = window.innerHeight;
      const maxScrollY = Math.max(0, totalHeight - vh);

      // CRITICAL: HIDE overlay host completely so NO toolbars/toasts are captured!
      host.style.display = "none";

      // Slice 0: capture top of document
      window.scrollTo({ left: 0, top: 0, behavior: "instant" });
      await new Promise((r) => setTimeout(r, 70));

      const slice0Res = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "captureSlice" }, resolve);
      });

      const slices = [
        {
          destY: 0,
          srcOffsetInViewport: 0,
          dataUrl: slice0Res?.dataUrl
        }
      ];

      // Subsequent slices: hide sticky headers to prevent duplicate search bars!
      let curY = vh;
      while (curY < totalHeight) {
        const targetY = Math.min(curY, maxScrollY);

        window.scrollTo({ left: 0, top: targetY, behavior: "instant" });
        await new Promise((r) => setTimeout(r, 60));

        // Hide fixed & sticky headers on slice 1+
        const restoreHeaders = hideStickyHeadersNow();
        await new Promise((r) => setTimeout(r, 30));

        const actualScrollY = window.scrollY;
        const res = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: "captureSlice" }, resolve);
        });

        restoreHeaders();

        if (res?.ok && res.dataUrl) {
          slices.push({
            destY: curY,
            srcOffsetInViewport: curY - actualScrollY,
            dataUrl: res.dataUrl
          });
        }

        curY += vh;
        if (targetY >= maxScrollY) break;
      }

      // Restore original scroll position immediately
      window.scrollTo({ left: origX, top: origY, behavior: "instant" });
      // Bring back overlay host
      host.style.display = "block";

      // Stitch onto canvas with seamless integer coverage (ZERO gaps, ZERO lines)
      const stitchedWidth = Math.round(window.innerWidth * DPR);
      const stitchedHeight = Math.round(totalHeight * DPR);
      const stitchedCanvas = document.createElement("canvas");
      stitchedCanvas.width = stitchedWidth;
      stitchedCanvas.height = stitchedHeight;
      const ctx = stitchedCanvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, stitchedWidth, stitchedHeight);

      for (let i = 0; i < slices.length; i++) {
        const slice = slices[i];
        if (!slice.dataUrl) continue;

        await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            const destY = Math.round(slice.destY * DPR);
            const nextDestY =
              i < slices.length - 1 ? Math.round(slices[i + 1].destY * DPR) : stitchedHeight;
            const destH = nextDestY - destY; // Exact coverage up to next slice

            let srcY = Math.round(slice.srcOffsetInViewport * DPR);
            srcY = Math.max(0, Math.min(srcY, img.height - 1));
            const srcH = Math.min(destH, img.height - srcY);

            ctx.drawImage(img, 0, srcY, img.width, srcH, 0, destY, stitchedWidth, destH);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = slice.dataUrl;
        });
      }

      // Store in memory cache
      cachedFullPageCanvas = stitchedCanvas;
      isFullPageMode = true;

      // Set selection to full page & show toolbar
      selectionRect = {
        pageX: 0,
        pageY: 0,
        width: totalWidth,
        height: totalHeight
      };
      updateSelectionView();
      showToast("Full page captured! Click Copy or Download.");
    };

    // Keyboard Handler
    function onKeyDown(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (isRecording) {
          stopRecordingFlow(false);
          return;
        }
        if (selectionRect) {
          resetSelection();
        } else {
          teardownOverlay();
        }
        return;
      }

      const isCmdOrCtrl = e.ctrlKey || e.metaKey;
      if (isCmdOrCtrl && e.key.toLowerCase() === "z" && selectionRect) {
        e.preventDefault();
        e.shiftKey ? redoDrawing() : undoDrawing();
        return;
      }

      if (isCmdOrCtrl && e.key.toLowerCase() === "y" && selectionRect) {
        e.preventDefault();
        redoDrawing();
        return;
      }

      if (e.key === "Enter" && selectionRect) {
        e.preventDefault();
        getFinalAnnotatedCanvas().then((canvas) => {
          if (canvas) {
            copyCanvas(canvas).then((ok) => {
              if (ok) setTimeout(teardownOverlay, 500);
            });
          }
        });
        return;
      }

      if (isCmdOrCtrl && e.key.toLowerCase() === "c" && selectionRect) {
        e.preventDefault();
        getFinalAnnotatedCanvas().then((canvas) => {
          if (canvas) copyCanvas(canvas);
        });
        return;
      }

      if (isCmdOrCtrl && e.key.toLowerCase() === "s" && selectionRect) {
        e.preventDefault();
        getFinalAnnotatedCanvas().then((canvas) => {
          if (canvas) downloadCanvas(canvas);
        });
        return;
      }
    }
    window.addEventListener("keydown", onKeyDown, true);

    function teardownOverlay() {
      if (recordTimerInterval) {
        clearInterval(recordTimerInterval);
        recordTimerInterval = null;
      }
      if (isRecording) {
        chrome.runtime.sendMessage({ action: "stopRecording", save: false });
        isRecording = false;
      }
      clearInterval(autoscrollInterval);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", updateSelectionView);
      host.remove();
    }

    if (initialMode === "record") {
      setMode("record");
    }
  }
})();
