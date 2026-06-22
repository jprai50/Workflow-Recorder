# Workflow recorder

A Chrome extension that automates the capture of user interactions across any webpage and transforms them into YAML scripts tailored for workflow scanning. Currently optimized for workflow applications; broader CLI integration remains untested.

---

## What It Does

YAML Recorder monitors your browser interactions during an active recording session and logs:

- **Mouse clicks** on buttons, links, form fields, and other clickable components
- **Text input** into text boxes, email fields, text areas, and custom input elements
- **Keyboard events** such as Enter, Tab, and Escape key presses
- **Form selections** from dropdown menus and `<select>` elements
- **Cross-frame interactions** within iframes and Shadow DOM structures

Upon completion, the extension generates a `.yaml` file optimized for workflow accessibility testing. Note: Extended testing with other CLI-based workflows is pending.

---

## How It Works

The extension deploys a content script (`content.js`) across all visited pages. During an active recording session, it monitors DOM events (`click`, `focusin`, `focusout`, `input`, `keydown`, `change`) and translates each user interaction into a YAML action statement.

The selector engine employs a hierarchical approach to identify elements:
1. QA attributes (`data-test`, `data-cy`, `data-qa`, etc.)
2. Accessibility attributes (`aria-label`, `title`, `alt`)
3. Standard `id` and `name` attributes
4. Visible text content
5. Structural CSS path fallback

Captured actions are persisted in `chrome.storage.local` and displayed in real-time within the preview panel.

---

## Getting Started

### 1. Install the Extension

1. Clone or download this repository to your local system.
2. Navigate to `chrome://extensions` in your Chrome browser.
3. Activate **Developer mode** using the toggle in the top-right corner.
4. Select **Load unpacked** and choose the project directory.

### 2. Open the Side Panel

Click the **YAML Recorder** extension icon in your Chrome toolbar to launch the recorder as a side panel.

### 3. Record Your Actions

1. Supply a **Project Name** (this becomes the script identifier and export filename).
2. Browse to the webpage you wish to test.
3. Select **Start Recording** — a pulsing red indicator signals active recording.
4. Perform your intended interactions on the page (clicking, typing, selecting, etc.).
5. Each interaction is immediately visible in the **Live Preview** section.

### 4. Add Manual Steps (Optional)

While recording, you can inject custom steps from the control panel:

- **Analyze Step** — inserts an accessibility check point. Provide an optional label (e.g., `Home Page`) and click **Add Analyze Step**.
- **Wait Step** — introduces a programmed delay. Specify the duration in seconds and click **Add Wait Step**.

### 5. Review and Edit

- View all recorded interactions in the live preview panel.
- Remove unwanted actions by clicking the **✕** icon next to each entry.

### 6. Export

1. Press **Stop Recording**.
2. Press **Export YAML**.
3. Your `.yaml` file downloads instantly with your project name as the filename.

---

## Exported YAML Format

```yaml
---
projects:
- name: My Project
  id: My Project
  pageList:
  - name: My Project
    url: https://example.com
    actions:
    - click element "//button[@id='submit']"
    - type "hello@example.com" into element "//input[@id='email']"
    - press "ENTER" on "//input[@id='email']"
    - analyze with title "Home Page"
    - wait for 3s
```

---

## Options

| Option | Description |
|---|---|
| **Visual Highlighter** | Displays a red dashed outline around targeted elements during recording sessions for enhanced visibility. |
| **Project Name** | Defines the project identifier for the exported YAML file and the downloaded filename. |

---

## Notes

- Page refreshes during recording sessions do not result in data loss — interactions remain cached in `chrome.storage.local`.
- Following an extension update, refresh any open pages to reinitialize the content script binding.
- The extension seamlessly handles interactions across iframes and Shadow DOM elements without additional configuration.
