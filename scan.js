// -----------------------------------------------------------------------------
// A11y Monk — Accessibility Scan (side panel UI)
// -----------------------------------------------------------------------------
// Thin wrapper over scan-core.js (self.A11yScan). Configured with the App URL + a
// page/component token; scans the ACTIVE tab and shows status in the side panel.
(function () {
  const apiInput = document.getElementById("scanApiUrl");
  const tokenInput = document.getElementById("scanToken");
  const shotsToggle = document.getElementById("scanShots");
  const runBtn = document.getElementById("scanRunBtn");
  const statusEl = document.getElementById("scanStatus");
  const targetEl = document.getElementById("scanTarget");
  if (!runBtn) return;

  const normUrl = (u) => String(u || "").trim().replace(/\/+$/, "");
  const setStatus = (msg, color) => { statusEl.textContent = msg; statusEl.style.color = color || "#334155"; };

  chrome.storage.local.get(["scanApiUrl", "scanToken", "scanShots"], (d) => {
    if (d.scanApiUrl) apiInput.value = d.scanApiUrl;
    if (d.scanToken) tokenInput.value = d.scanToken;
    shotsToggle.checked = d.scanShots !== false;
  });
  apiInput.addEventListener("change", () => chrome.storage.local.set({ scanApiUrl: normUrl(apiInput.value) }));
  tokenInput.addEventListener("change", () => chrome.storage.local.set({ scanToken: tokenInput.value.trim() }));
  shotsToggle.addEventListener("change", () => chrome.storage.local.set({ scanShots: shotsToggle.checked }));

  // Crop a captured viewport PNG (data URL) to an element rect, using a DOM canvas.
  function domCrop(dataUrl, rect) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = self.A11yScan.cropRect(img.width, img.height, rect);
        if (!c) { resolve(null); return; }
        const cv = document.createElement("canvas");
        cv.width = Math.round(c.sw); cv.height = Math.round(c.sh);
        cv.getContext("2d").drawImage(img, c.sx, c.sy, c.sw, c.sh, 0, 0, c.sw, c.sh);
        cv.toBlob((b) => resolve(b), "image/png");
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  async function runScan() {
    const api = normUrl(apiInput.value);
    const token = tokenInput.value.trim();
    if (!api || !token) { setStatus("Enter the App URL and Token first.", "#b91c1c"); return; }
    chrome.storage.local.set({ scanApiUrl: api, scanToken: token });
    runBtn.disabled = true; targetEl.textContent = "";

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (!tab || !tab.id) { setStatus("No active tab.", "#b91c1c"); runBtn.disabled = false; return; }

    try {
      const result = await self.A11yScan.runScanFlow({
        api, token, tabId: tab.id, windowId: tab.windowId, url: tab.url,
        screenshots: shotsToggle.checked, cropDataUrlToBlob: domCrop,
        onStatus: (s) => {
          setStatus(s.text);
          if (s.label) targetEl.textContent = "Target: " + s.label + (s.kind === "component" ? " (component)" : " (page)");
        },
      });
      const link = api + (result.reportUrl || "/consolidated-report/");
      statusEl.innerHTML = "✅ Saved " + result.issues + " issue(s)" + (result.shots ? " (" + result.shots + " with screenshots)" : "") +
        " under " + result.bucket + '. <a href="' + link + '" target="_blank" rel="noopener" style="color:#2563eb">View report ↗</a>';
      statusEl.style.color = "#065f46";
    } catch (e) {
      setStatus((e && e.message) || String(e), "#b91c1c");
    }
    runBtn.disabled = false;
  }

  runBtn.addEventListener("click", () => runScan());
})();
