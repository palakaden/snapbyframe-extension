# Snap by Frame 📸

A lightweight, privacy-first Chrome extension that lets you instantly capture, annotate, and copy specific web elements or custom regions directly to your clipboard. No bloated software, no external servers—just fast, precise screenshots.

## ✨ Features

* **Smart Element Capture:** Hover over any web element to auto-highlight and capture it with a single click.
* **Custom Area Crop:** Click and drag to capture a specific region of the page.
* **Built-in Annotation Editor:** Add arrows, rectangles, straight lines, or freehand drawings in a sleek dark-mode canvas.
* **Undo & Redo:** Full keyboard support to quickly fix mistakes.
* **Instant Clipboard Copy:** Copy your final edited image directly to your clipboard—no need to clutter your hard drive with saved files.
* **Direct Download:** Save the final screenshot as a high-quality PNG.
* **100% Private:** Everything runs locally on your device. No tracking, no analytics, and no data leaves your browser.

## 🚀 Installation (Developer Mode)

To install this extension manually before it is available on the Chrome Web Store:

1. Download or clone this repository to your local machine.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (toggle switch in the top right corner).
4. Click the **Load unpacked** button in the top left.
5. Select the folder containing the extension files (`manifest.json`, `background.js`, icons, etc.).
6. The extension is now installed and ready to use!

## ⌨️ How to Use

1. **Trigger the tool:** Press `Alt + Shift + S` on any standard web page.
2. **Select:** 
   * *Hover* to highlight a specific element, then click to capture it.
   * *Click and drag* to draw a custom bounding box around any area.
3. **Annotate:** Use the toolbar to draw or add shapes.
   * `Ctrl + Z` : Undo
   * `Ctrl + Y` or `Ctrl + Shift + Z` : Redo
   * `Esc` : Close the editor without saving.
4. **Export:** Click **Copy Image** to paste it anywhere (Slack, Discord, Docs), or **Save Image** to download it to your computer.

*(Note: Chrome policies prevent extensions from running on internal pages like `chrome://settings` or the Chrome Web Store itself.)*

## 🛡️ Privacy Policy

This extension operates entirely locally. It does not collect, store, transmit, or share any personal information, user data, or web browsing history. Image processing, cropping, and clipboard copying happen exclusively on your device.

## 📄 License

This project is open-source and available under the [MIT License](LICENSE).
