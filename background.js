// This tells Chrome to open the side panel when you click the extension icon
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

// -----------------------------------------------------------------------------
// EXTENSION INITIALIZATION
// -----------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {

  chrome.storage.local.get(
    [
      "isRecording",
      "actions",
      "projectName",
      "isHighlighterEnabled",
      "startUrl"
    ],
    (data) => {

      chrome.storage.local.set({

        isRecording:
          data.isRecording ?? false,

        actions:
          data.actions ?? [],

        projectName:
          data.projectName ?? "",

        isHighlighterEnabled:
          data.isHighlighterEnabled ?? true,

        startUrl:
          data.startUrl ?? ""

      });

    }
  );

});

// -----------------------------------------------------------------------------
// SERVICE WORKER STARTUP RECOVERY
// -----------------------------------------------------------------------------

chrome.runtime.onStartup.addListener(() => {

  chrome.storage.local.get(
    ["isRecording"],
    (data) => {

      if (data.isRecording) {

        chrome.storage.local.set({
          isRecording: false
        });

      }

    }
  );

});

// -----------------------------------------------------------------------------
// LOGGING
// -----------------------------------------------------------------------------

function log(message, data = null) {

  console.log(
    "[A11Y Monk Recorder]",
    message,
    data || ""
  );

}

// Helps cross-origin iframe content scripts find their own <iframe> element's CSS path
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type !== "GET_IFRAME_SELECTOR") {
  return;
}

log(
  "Resolving iframe selector",
  sender.url
);

  const tabId = sender.tab?.id;
  const frameId = sender.frameId;
  if (!tabId || !frameId) { sendResponse({ selector: null }); return; }

  chrome.webNavigation.getAllFrames({ tabId }, (frames) => {
    if (!frames) { sendResponse({ selector: null }); return; }

    const myFrame = frames.find(f => f.frameId === frameId);
    if (!myFrame || myFrame.parentFrameId == null || myFrame.parentFrameId === -1) {
      sendResponse({ selector: null }); return;
    }

    chrome.scripting.executeScript({
      target: { tabId, frameIds: [myFrame.parentFrameId] },
      func: (childUrl) => {
        function getCssPathSimple(el) {
          let path = [];
          let current = el;
          while (current && current.nodeType === 1) {
            if (current.id && !/\d/.test(current.id)) {
              path.unshift(`#${current.id}`);
              break;
            }
            let index = 1;
            let sibling = current.previousElementSibling;
            while (sibling) { index++; sibling = sibling.previousElementSibling; }
            const parent = current.parentNode;
            if (parent && parent.childElementCount > 1) {
              path.unshift(`${current.tagName.toLowerCase()}:nth-child(${index})`);
            } else {
              path.unshift(current.tagName.toLowerCase());
            }
            current = current.parentNode;
          }
          return path.join(' > ');
        }

        let childOrigin;
        try { childOrigin = new URL(childUrl).origin; } catch (e) { return null; }

        for (const iframe of document.querySelectorAll('iframe')) {
          try {
            const src = new URL(iframe.src || '', location.href).href;
            if (new URL(src).origin === childOrigin) return getCssPathSimple(iframe);
          } catch (e) {}
        }
        return null;
      },
      args: [sender.url || '']
    }, (results) => {
      if (chrome.runtime.lastError) {

        console.warn(
          "[A11Y Monk Recorder]",
          chrome.runtime.lastError.message
        );

        sendResponse({
          selector: null
        });

        return;
    }
      sendResponse({ selector: results?.[0]?.result || null });
    });
  });

  return true; // Keep the message channel open for the async response
});

// -----------------------------------------------------------------------------
// FUTURE READY MESSAGE HANDLER
// -----------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((request) => {

  switch (request.type) {

    case "START_RECORDING":
      log("Recording started");
      break;

    case "STOP_RECORDING":
      log("Recording stopped");
      break;

    default:
      break;

  }

});