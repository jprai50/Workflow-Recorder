// Shared accessibility-scan core (used here for the app-driven background scan).
importScripts("scan-core.js");

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

// -----------------------------------------------------------------------------
// APP-DRIVEN ACCESSIBILITY SCAN (externally connectable)
// -----------------------------------------------------------------------------
// The A11y Monk web app (see externally_connectable in manifest) opens a port and
// asks us to scan a page tab it has open. We foreground that tab, run the shared
// scan flow with screenshots, stream progress back, then return focus to the app.

const normUrl = (u) => String(u || "").trim().replace(/\/+$/, "");

// SW-safe screenshot crop: data URL -> ImageBitmap -> OffscreenCanvas -> PNG Blob.
async function offscreenCrop(dataUrl, rect) {
  const resp = await fetch(dataUrl);
  const blob = await resp.blob();
  const bitmap = await createImageBitmap(blob);
  const c = self.A11yScan.cropRect(bitmap.width, bitmap.height, rect);
  if (!c) return null;
  const canvas = new OffscreenCanvas(Math.round(c.sw), Math.round(c.sh));
  canvas.getContext("2d").drawImage(bitmap, c.sx, c.sy, c.sw, c.sh, 0, 0, c.sw, c.sh);
  return await canvas.convertToBlob({ type: "image/png" });
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Find the browser tab whose URL matches the target (by origin + pathname).
// Returns { tab, matchCount } so the caller can surface WHICH document it scanned
// and warn when several tabs matched (a common reason modal/interactive state is
// "missing" — a stale duplicate tab gets picked instead of the one you set up).
// Preference order: the active (foreground) matching tab, then most-recently
// accessed — the tab you just interacted with is almost always the right one.
async function findTargetTab(targetUrl) {
  let want;
  try { const u = new URL(targetUrl); want = u.origin + u.pathname.replace(/\/+$/, ""); }
  catch (e) { return { tab: null, matchCount: 0 }; }
  const tabs = await chrome.tabs.query({});
  const matches = tabs.filter((t) => {
    if (!t.url) return false;
    try { const u = new URL(t.url); return (u.origin + u.pathname.replace(/\/+$/, "")) === want; }
    catch (e) { return false; }
  });
  if (!matches.length) return { tab: null, matchCount: 0 };
  matches.sort((a, b) => {
    if (!!b.active !== !!a.active) return b.active ? 1 : -1; // active tab first
    return (b.lastAccessed || 0) - (a.lastAccessed || 0);    // then most recent
  });
  return { tab: matches[0], matchCount: matches.length };
}

chrome.runtime.onConnectExternal.addListener((port) => {
  if (port.name !== "a11ymonk-scan") return;
  const senderTabId = port.sender && port.sender.tab && port.sender.tab.id;

  port.onMessage.addListener(async (msg) => {
    if (!msg || msg.type !== "START") return;
    try {
      const { tab: target, matchCount } = await findTargetTab(msg.targetUrl);
      if (!target) {
        port.postMessage({ type: "ERROR", error: "Open the target page in a tab first, then click Run Automation." });
        return;
      }
      // Surface exactly which document we're about to scan (and warn on duplicates)
      // so a wrong-tab match is visible instead of silently scanning stale state.
      port.postMessage({
        type: "STATUS",
        text: matchCount > 1
          ? "Scanning " + target.url + " (⚠ " + matchCount + " tabs match this URL — scanning the active one)"
          : "Scanning " + target.url,
      });

      // Bring the target tab to front so captureVisibleTab captures it, then let it
      // settle/repaint (a focus-triggered re-render can otherwise race the scan).
      await chrome.tabs.update(target.id, { active: true });
      try { await chrome.windows.update(target.windowId, { focused: true }); } catch (e) {}
      await delay(450);

      const result = await self.A11yScan.runScanFlow({
        api: normUrl(msg.apiUrl), token: msg.token,
        tabId: target.id, windowId: target.windowId, url: target.url,
        screenshots: msg.screenshots !== false,
        cropDataUrlToBlob: offscreenCrop,
        onStatus: (s) => { try { port.postMessage({ type: "STATUS", ...s }); } catch (e) {} },
      });

      // Return focus to the app (manual-test) tab.
      if (senderTabId) { try { await chrome.tabs.update(senderTabId, { active: true }); } catch (e) {} }
      port.postMessage({ type: "DONE", scannedUrl: target.url, matchCount: matchCount, ...result });
    } catch (e) {
      port.postMessage({ type: "ERROR", error: (e && e.message) || String(e) });
    }
  });
});