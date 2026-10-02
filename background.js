// =============================================================
// Snap by Frame — Firefox-Style Screenshot Service Worker (MV3)
// =============================================================
// Features:
//   - Trigger via shortcut (Ctrl+Shift+S / Alt+Shift+S) or toolbar icon
//   - Region selection & Element hover capture
//   - "Save visible" (instant viewport capture)
//   - "Save full page" (smooth scrolling & slice stitching)
//   - In-page Annotation Editor (Draw, Arrow, Box, Line, Text,
//     Highlighter, Blur/Redact, Colors, Undo/Redo)
//   - Instant Clipboard Copy & File Download
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
 * Initiates the screenshot overlay on the active tab
 */
async function startCaptureFlow(tab) {
  if (!tab || !tab.id) {
    notify("Screenshot Failed", "Could not find an active tab to capture.");
    return;
  }

  if (isRestrictedUrl(tab.url)) {
    notify(
      "Screenshot Blocked",
      "Browser security prevents screenshots on this page (e.g. system settings, new tab, or the Chrome Web Store)."
    );
    return;
  }

  try {
    const dataUrl = await captureTabWithRetry(tab.windowId);

    // Try sending message to content script
    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: "initOverlay",
        dataUrl: dataUrl
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
        dataUrl: dataUrl
      });
    }
  } catch (err) {
    console.error("Screenshot capture failed:", err);
    notify(
      "Screenshot Failed",
      "Could not capture this page. Please wait a moment or refresh the tab."
    );
  }
}

// Global keyboard shortcut trigger
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "trigger-screenshot") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    startCaptureFlow(tab);
  }
});

// Extension toolbar icon click trigger
chrome.action.onClicked.addListener((tab) => {
  startCaptureFlow(tab);
});

// Runtime messages from content script
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

  // 3. Trigger capture flow directly (e.g. from in-page keydown)
  if (message.action === "startCaptureFlow") {
    if (sender.tab) {
      startCaptureFlow(sender.tab);
      sendResponse({ ok: true });
    }
    return true;
  }

  // 4. Desktop notification
  if (message.action === "notify") {
    notify(message.title || "Snap by Frame", message.message || "");
    sendResponse({ ok: true });
    return true;
  }

  return false;
});
