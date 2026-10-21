// =============================================================
// Snap by Frame — Offscreen Tab Recorder
// =============================================================

let mediaRecorder = null;
let recordedChunks = [];
let renderIntervalId = null;
let currentStream = null;
let activeMimeType = "video/webm";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "offscreen") return false;

  if (message.action === "startRecording") {
    startRecording(message.streamId, message.crop)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error("Offscreen startRecording failed:", err);
        sendResponse({ ok: false, error: err.message });
      });
    return true; // Keep message channel open for async response
  }

  if (message.action === "stopRecording") {
    stopRecording(message.save)
      .then((res) => sendResponse({ ok: true, dataUrl: res?.dataUrl, mimeType: res?.mimeType }))
      .catch((err) => {
        console.error("Offscreen stopRecording failed:", err);
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }

  return false;
});

function getBestSupportedMimeType() {
  const preferredTypes = [
    'video/mp4;codecs="avc1.424028,mp4a.40.2"',
    "video/mp4;codecs=avc1",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm"
  ];
  for (const t of preferredTypes) {
    if (MediaRecorder.isTypeSupported(t)) {
      return t;
    }
  }
  return "video/webm";
}

async function startRecording(streamId, crop) {
  cleanup();
  recordedChunks = [];

  // Capture stream from tabCapture via getUserMedia
  currentStream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
        minWidth: 1280,
        maxWidth: 3840,
        minHeight: 720,
        maxHeight: 2160
      }
    }
  });

  const video = document.getElementById("record-video");
  video.srcObject = currentStream;

  await new Promise((resolve) => {
    video.onloadedmetadata = () => {
      video.play().then(resolve).catch(resolve);
    };
  });

  const canvas = document.getElementById("record-canvas");
  const ctx = canvas.getContext("2d", { alpha: false });

  let recordStream;

  if (crop && crop.width && crop.height) {
    const videoW = video.videoWidth || crop.vw || 1920;
    const videoH = video.videoHeight || crop.vh || 1080;
    const scaleX = videoW / (crop.vw || window.innerWidth);
    const scaleY = videoH / (crop.vh || window.innerHeight);

    const sx = Math.max(0, Math.round(crop.x * scaleX));
    const sy = Math.max(0, Math.round(crop.y * scaleY));
    let sw = Math.min(videoW - sx, Math.round(crop.width * scaleX));
    let sh = Math.min(videoH - sy, Math.round(crop.height * scaleY));

    // Video dimensions must be even integers for video encoding
    if (sw % 2 !== 0) sw -= 1;
    if (sh % 2 !== 0) sh -= 1;
    sw = Math.max(2, sw);
    sh = Math.max(2, sh);

    canvas.width = sw;
    canvas.height = sh;

    // Use setInterval instead of requestAnimationFrame because Chrome pauses
    // requestAnimationFrame in background/offscreen documents, which froze frame capture.
    function renderFrame() {
      if (!currentStream || !video.videoWidth) return;
      try {
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      } catch (e) {}
    }
    renderFrame();
    renderIntervalId = setInterval(renderFrame, 1000 / 30);

    recordStream = canvas.captureStream(30);
  } else {
    // Full tab stream
    recordStream = currentStream;
  }

  activeMimeType = getBestSupportedMimeType();

  mediaRecorder = new MediaRecorder(recordStream, {
    mimeType: activeMimeType,
    videoBitsPerSecond: 4000000 // 4 Mbps high quality
  });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      recordedChunks.push(e.data);
    }
  };

  mediaRecorder.start(250); // Collect data chunks every 250ms
}

async function stopRecording(save) {
  if (renderIntervalId) {
    clearInterval(renderIntervalId);
    renderIntervalId = null;
  }

  return new Promise((resolve, reject) => {
    if (!mediaRecorder || mediaRecorder.state === "inactive") {
      cleanup();
      resolve(null);
      return;
    }

    mediaRecorder.onstop = () => {
      try {
        if (!save || recordedChunks.length === 0) {
          cleanup();
          resolve(null);
          return;
        }

        const blob = new Blob(recordedChunks, { type: activeMimeType });
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result;
          cleanup();
          resolve({ dataUrl: result, mimeType: activeMimeType });
        };
        reader.onerror = () => {
          cleanup();
          reject(new Error("Failed to convert video blob to Data URL"));
        };
        reader.readAsDataURL(blob);
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    mediaRecorder.stop();
  });
}

function cleanup() {
  if (renderIntervalId) {
    clearInterval(renderIntervalId);
    renderIntervalId = null;
  }
  if (currentStream) {
    currentStream.getTracks().forEach((track) => track.stop());
    currentStream = null;
  }
  const video = document.getElementById("record-video");
  if (video) video.srcObject = null;
  mediaRecorder = null;
  recordedChunks = [];
}

