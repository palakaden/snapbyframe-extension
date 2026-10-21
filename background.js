// =============================================================
// Snap by Frame — Screenshot & Screen Recorder Service Worker (MV3)
// =============================================================

const RESTRICTED_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "edge://",
  "about:",
  "view-source:",
  "https://chrome.google.com/webstore",
  "https://chromewebstore.google.com"
];

function isRestrictedUrl(url) {
  return !url || RESTRICTED_PREFIXES.some((prefix) => url.startsWith(prefix));
}

function notify(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("icon48.png"),
    title: title || "Snap by Frame",
    message: message || ""
  });
}

/**
 * Capture visible tab with retry for rate limiting during slice capture
 */
async function captureTabWithRetry(windowId, retries = 3, delay = 250) {
  for (let i = 0; i < retries; i++) {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
      if (dataUrl) return dataUrl;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("Failed to capture tab after retries");
}

/**
 * Ensures the offscreen document is ready for audio/video recording
 */
async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"]
  });
  if (existingContexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["USER_MEDIA"],
      justification: "Recording tab video"
    });
  }
}

/**
 * Closes the offscreen document safely
 */
async function closeOffscreenDocument() {
  try {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"]
    });
    if (existingContexts.length > 0) {
      await chrome.offscreen.closeDocument();
    }
  } catch (err) {
    console.error("closeOffscreenDocument error:", err);
  }
}

/**
 * Initiates the capture/recording overlay on the target tab
 */
async function startCaptureFlow(tab, mode = "screenshot") {
  if (!tab || !tab.id) {
    notify("Snap by Frame", "Please open a webpage first.");
    return;
  }

  if (isRestrictedUrl(tab.url)) {
    notify(
      "Snap by Frame",
      "Extensions don't work on new/blank tabs, browser settings, or the Web Store. Please open any regular website!"
    );
    return;
  }

  try {
    // For screenshot or recording, grab initial tab snapshot
    let dataUrl = null;
    try {
      dataUrl = await captureTabWithRetry(tab.windowId, 2, 200);
    } catch (e) {
      console.warn("Initial capture slice optional fallback:", e);
    }

    // Try sending message to content script
    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: "initOverlay",
        dataUrl: dataUrl,
        mode: mode
      });
    } catch {
      // Content script not yet injected into this tab; inject it now
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });

      // Send the init message now that content.js is loaded
      await chrome.tabs.sendMessage(tab.id, {
        action: "initOverlay",
        dataUrl: dataUrl,
        mode: mode
      });
    }
  } catch (err) {
    console.error("startCaptureFlow failed:", err);
    notify(
      "Snap by Frame",
      "Could not open on this page. Please refresh the page and try again!"
    );
  }
}

// Global keyboard shortcut triggers
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  if (command === "trigger-screenshot") {
    startCaptureFlow(tab, "screenshot");
  } else if (command === "trigger-recording") {
    startCaptureFlow(tab, "record");
  }
});

// Runtime messages from content script & popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  // 1. Save screenshot to disk via chrome.downloads
  if (message.action === "saveScreenshot") {
    chrome.downloads.download(
      {
        url: message.dataUrl,
        filename: message.filename || "screenshot.png",
        saveAs: false
      },
      (downloadId) => {
        const err = chrome.runtime.lastError;
        if (err || downloadId === undefined) {
          console.error("Download failed:", err?.message);
          sendResponse({ ok: false, error: err?.message || "Download failed" });
        } else {
          sendResponse({ ok: true, downloadId });
        }
      }
    );
    return true; // Keep channel open for async response
  }

  // 2. Capture a slice for full-page scrolling capture
  if (message.action === "captureSlice") {
    const windowId = sender.tab ? sender.tab.windowId : chrome.windows.WINDOW_ID_CURRENT;
    captureTabWithRetry(windowId)
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // 3. Trigger capture flow directly (e.g. from popup or in-page keydown)
  if (message.action === "startCaptureFlow") {
    const mode = message.mode || "screenshot";
    if (message.tabId) {
      chrome.tabs.get(message.tabId, (tab) => {
        if (tab) startCaptureFlow(tab, mode);
      });
    } else if (sender.tab) {
      startCaptureFlow(sender.tab, mode);
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (tab) startCaptureFlow(tab, mode);
      });
    }
    sendResponse({ ok: true });
    return true;
  }

  // 4. Start Screen Recording via tabCapture & offscreen
  if (message.action === "startRecording") {
    (async () => {
      try {
        const tab = sender.tab;
        if (!tab || !tab.id) throw new Error("No active tab found");

        await ensureOffscreenDocument();

        // Obtain media stream id for the active tab
        const streamId = await chrome.tabCapture.getMediaStreamId({
          targetTabId: tab.id
        });

        const res = await chrome.runtime.sendMessage({
          target: "offscreen",
          action: "startRecording",
          streamId: streamId,
          crop: message.crop
        });

        sendResponse(res || { ok: true });
      } catch (err) {
        console.error("startRecording error in background:", err);
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  // 5. Stop Screen Recording & download video
  if (message.action === "stopRecording") {
    (async () => {
      try {
        const res = await chrome.runtime.sendMessage({
          target: "offscreen",
          action: "stopRecording",
          save: message.save
        });

        await closeOffscreenDocument();

        if (message.save && res?.dataUrl) {
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
          const ext = res.mimeType && res.mimeType.includes("mp4") ? "mp4" : "webm";
          const filename = `recording-${timestamp}.${ext}`;
          chrome.downloads.download({
            url: res.dataUrl,
            filename: filename,
            saveAs: false
          });
        }

        sendResponse({ ok: true, saved: !!(message.save && res?.dataUrl) });
      } catch (err) {
        console.error("stopRecording error in background:", err);
        await closeOffscreenDocument();
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  // 6. Desktop notification
  if (message.action === "notify") {
    notify(message.title || "Snap by Frame", message.message || "");
    sendResponse({ ok: true });
    return true;
  }

  return false;
});