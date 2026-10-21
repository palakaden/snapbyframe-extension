document.addEventListener("DOMContentLoaded", () => {
  const btnScreenshot = document.getElementById("btn-screenshot");
  const btnRecord = document.getElementById("btn-record");

  btnScreenshot.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.runtime.sendMessage({
        action: "startCaptureFlow",
        mode: "screenshot",
        tabId: tab.id
      });
    }
    window.close();
  });

  btnRecord.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.runtime.sendMessage({
        action: "startCaptureFlow",
        mode: "record",
        tabId: tab.id
      });
    }
    window.close();
  });
});

