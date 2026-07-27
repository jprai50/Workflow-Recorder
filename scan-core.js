// -----------------------------------------------------------------------------
// A11y Monk — shared accessibility-scan core
// -----------------------------------------------------------------------------
// Loaded by the background service worker (background.js) via importScripts().
// Exposes self.A11yScan.runScanFlow(deps), which drives the app-triggered
// one-click "Run Automation" scan. The screenshot crop differs between contexts
// (DOM canvas vs OffscreenCanvas) and is passed in by the caller.
(function () {
  const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
  const MAX_SHOTS = 100;

  // ---- Functions injected into the target page (must be self-contained) -------
  function axeInPage(tags, selector, exclude) {
    let ctx = document;
    if (selector) {
      let el = null; try { el = document.querySelector(selector); } catch (e) {}
      ctx = el || document;
    } else if (exclude && exclude.length) {
      const valid = [];
      for (const s of exclude) { try { document.querySelector(s); valid.push([s]); } catch (e) {} }
      if (valid.length) ctx = { exclude: valid };
    }
    return window.axe.run(ctx, { runOnly: { type: "tag", values: tags } }).then((r) => {
      const issues = [];
      (r.violations || []).forEach((v) => {
        (v.nodes || []).forEach((n) => {
          issues.push({
            rule: v.id, impact: v.impact,
            selector: (n.target && n.target[0]) ? String(n.target[0]) : "",
            help: v.help || "", helpUrl: v.helpUrl || "",
            failureSummary: n.failureSummary || "", elementHtml: n.html || "",
          });
        });
      });
      return issues;
    }).catch((e) => ({ __error: String((e && e.message) || e) }));
  }

  function highlightAndRect(sel) {
    document.querySelectorAll("[data-a11ymonk-hl]").forEach((el) => {
      el.style.removeProperty("outline"); el.style.removeProperty("outline-offset"); el.style.removeProperty("box-shadow");
      el.removeAttribute("data-a11ymonk-hl");
    });
    let el = null; try { el = document.querySelector(sel); } catch (e) {}
    if (!el) return null;
    el.style.setProperty("outline", "4px solid #ff3b30", "important");
    el.style.setProperty("outline-offset", "2px", "important");
    el.style.setProperty("box-shadow", "0 0 0 6px rgba(255,59,48,.35)", "important");
    el.setAttribute("data-a11ymonk-hl", "true");
    el.scrollIntoView({ block: "center", inline: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, dpr: window.devicePixelRatio || 1 };
  }

  function clearHighlights() {
    document.querySelectorAll("[data-a11ymonk-hl]").forEach((el) => {
      el.style.removeProperty("outline"); el.style.removeProperty("outline-offset"); el.style.removeProperty("box-shadow");
      el.removeAttribute("data-a11ymonk-hl");
    });
  }

  // ---- Orchestration (runs in the side panel or the service worker) ----------
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const captureVisible = (windowId) => new Promise((resolve) => {
    chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
      resolve(chrome.runtime.lastError || !dataUrl ? null : dataUrl);
    });
  });

  // deps: { api, token, tabId, windowId, url, screenshots,
  //         cropDataUrlToBlob(dataUrl, rect) -> Promise<Blob|null>, onStatus(obj) }
  async function runScanFlow(deps) {
    const { api, token, tabId, windowId, url, screenshots, cropDataUrlToBlob } = deps;
    const onStatus = deps.onStatus || function () {};
    const auth = { Authorization: "Bearer " + token };

    onStatus({ phase: "config", text: "Reading scan config…" });
    const cr = await fetch(api + "/api/local-scan/config", { headers: auth });
    const cfg = await cr.json();
    if (!cr.ok || !cfg.ok) throw new Error((cfg && cfg.error) || ("HTTP " + cr.status));

    onStatus({ phase: "inject", text: "Injecting scanner…", label: cfg.label, kind: cfg.kind });
    await chrome.scripting.executeScript({ target: { tabId }, files: ["vendor/axe.min.js"] });

    onStatus({ phase: "scan", text: "Scanning the page…" });
    const res = await chrome.scripting.executeScript({ target: { tabId }, func: axeInPage, args: [WCAG_TAGS, cfg.selector || "", cfg.exclude || []] });
    let issues = res && res[0] && res[0].result;
    if (issues && issues.__error) throw new Error("axe error: " + issues.__error);
    if (!Array.isArray(issues)) issues = [];

    if (screenshots && issues.length) {
      const limit = Math.min(issues.length, MAX_SHOTS);
      for (let i = 0; i < limit; i++) {
        onStatus({ phase: "shots", text: "Capturing screenshots " + (i + 1) + "/" + limit + "…", done: i + 1, total: limit });
        if (!issues[i].selector) continue;
        try {
          const rr = await chrome.scripting.executeScript({ target: { tabId }, func: highlightAndRect, args: [issues[i].selector] });
          const rect = rr && rr[0] && rr[0].result;
          if (!rect) continue;
          await delay(250);
          const shot = await captureVisible(windowId);
          if (!shot) { await delay(700); continue; }
          const blob = await cropDataUrlToBlob(shot, rect);
          if (!blob) continue;
          const up = await fetch(api + "/api/local-scan/screenshot", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "image/png" }, body: blob });
          const ud = await up.json();
          if (up.ok && ud.ok) issues[i].screenshotUrl = ud.url;
        } catch (e) { /* skip this shot */ }
        await delay(500);
      }
      try { await chrome.scripting.executeScript({ target: { tabId }, func: clearHighlights }); } catch (e) {}
    }

    onStatus({ phase: "ingest", text: "Saving results…" });
    const ir = await fetch(api + "/api/local-scan/ingest", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ url: url || "", standard: "WCAG 2.2 AA", issues }),
    });
    const id = await ir.json();
    if (!ir.ok || !id.ok) throw new Error((id && id.error) || ("HTTP " + ir.status));
    const shots = issues.filter((x) => x.screenshotUrl).length;
    return { ok: true, issues: id.issues, shots, bucket: id.bucket || cfg.label, reportUrl: id.reportUrl };
  }

  // Section-clip crop math shared by both crop implementations. Returns
  // {sx,sy,sw,sh} in device pixels, or null if too small.
  function cropRect(imgW, imgH, rect) {
    const dpr = rect.dpr || 1;
    const hPad = Math.max(120, Math.min(280, rect.w * 1.4)) * dpr;
    const vPad = Math.max(100, Math.min(220, rect.h * 1.8)) * dpr;
    const sx = Math.max(0, rect.x * dpr - hPad);
    const sy = Math.max(0, rect.y * dpr - vPad);
    const sw = Math.min(imgW - sx, rect.w * dpr + hPad * 2);
    const sh = Math.min(imgH - sy, rect.h * dpr + vPad * 2);
    if (sw < 2 || sh < 2) return null;
    return { sx, sy, sw, sh };
  }

  self.A11yScan = { runScanFlow, cropRect };
})();
