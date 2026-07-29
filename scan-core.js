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
    } else {
      // Always exclude our own injected nodes (the sr-only announcer, the visible
      // progress pill, and any highlight outline) so they can never be reported as
      // violations, plus any caller-supplied excludes (e.g. a page scan excluding
      // shared components).
      const valid = [["#a11ymonk-progress-live"], ["#a11ymonk-progress-pill"], ["[data-a11ymonk-hl]"]];
      for (const s of (exclude || [])) { try { document.querySelector(s); valid.push([s]); } catch (e) {} }
      ctx = { exclude: valid };
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
    // Report the progress pill's on-screen bottom so the crop can clip its band out of
    // the screenshot (instead of hiding it per shot, which flickers). The pill is fixed
    // at the top of the viewport; its rect is viewport-relative, matching the capture.
    var pill = document.getElementById("a11ymonk-progress-pill");
    var pillBottom = 0;
    if (pill) { try { var pr = pill.getBoundingClientRect(); if (pr && pr.width) pillBottom = pr.bottom; } catch (e) {} }
    return { x: r.left, y: r.top, w: r.width, h: r.height, dpr: window.devicePixelRatio || 1, pillBottom: pillBottom };
  }

  function clearHighlights() {
    document.querySelectorAll("[data-a11ymonk-hl]").forEach((el) => {
      el.style.removeProperty("outline"); el.style.removeProperty("outline-offset"); el.style.removeProperty("box-shadow");
      el.removeAttribute("data-a11ymonk-hl");
    });
  }

  // Injected into the target tab: surface scan progress to BOTH audiences on the page
  // the user is actually focused on (the extension foregrounds this tab during the
  // scan, so any indicator in the backgrounded app tab would be unseen/unspoken).
  //  - Screen readers: a singleton visually-hidden polite live region. Text is set on
  //    a timeout AFTER the (possibly new) node is in the DOM so it registers as a live
  //    change rather than initial content — some screen readers skip the latter.
  //  - Sighted users: a visible, aria-hidden top-center pill with a mini progress bar.
  function updateProgressUi(pct, label, announce) {
    var msg = String(label) + " — " + pct + "%";

    // (a) Screen-reader live region — only when announce !== false. Per-shot pill
    //     updates during screenshot capture pass announce=false so the screen reader
    //     hears the phase once instead of being spammed on every shot.
    if (announce !== false) {
      var live = document.getElementById("a11ymonk-progress-live");
      if (!live) {
        live = document.createElement("div");
        live.id = "a11ymonk-progress-live";
        live.setAttribute("role", "status");
        live.setAttribute("aria-live", "polite");
        live.setAttribute("aria-atomic", "true");
        live.style.cssText = "position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0";
        (document.body || document.documentElement).appendChild(live);
      }
      setTimeout(function () { live.textContent = msg; }, 30);
    }

    // (b) Visible pill (aria-hidden so it doesn't double-announce). Self-contained
    //     inline styles — it lives in an arbitrary third-party page.
    var reduce = false;
    try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
    var pill = document.getElementById("a11ymonk-progress-pill");
    if (!pill) {
      pill = document.createElement("div");
      pill.id = "a11ymonk-progress-pill";
      pill.setAttribute("aria-hidden", "true");
      pill.style.cssText =
        "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
        "pointer-events:none;background:#1e1b4b;color:#fff;padding:10px 14px;border-radius:12px;" +
        "box-shadow:0 8px 24px rgba(0,0,0,.35);font:600 13px/1.3 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;" +
        "min-width:220px;max-width:90vw;text-align:center;display:flex;flex-direction:column;gap:6px";
      pill.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;gap:6px">' +
          '<span>⚡ A11y Monk</span><span id="a11ymonk-pill-label" style="opacity:.85;font-weight:500"></span>' +
        '</div>' +
        '<div style="height:6px;background:rgba(255,255,255,.22);border-radius:999px;overflow:hidden">' +
          '<div id="a11ymonk-pill-fill" style="height:100%;width:0%;background:#a5b4fc;border-radius:999px' +
          (reduce ? "" : ";transition:width .3s ease") + '"></div>' +
        '</div>' +
        '<div id="a11ymonk-pill-pct" style="font-size:12px;font-weight:700">0%</div>';
      (document.body || document.documentElement).appendChild(pill);
    }
    var lab = document.getElementById("a11ymonk-pill-label");
    var fill = document.getElementById("a11ymonk-pill-fill");
    var pctEl = document.getElementById("a11ymonk-pill-pct");
    if (lab) lab.textContent = "— " + String(label);
    if (fill) fill.style.width = pct + "%";
    if (pctEl) pctEl.textContent = pct + "%";
  }

  // Remove both progress nodes at the end of a run so nothing lingers on the page.
  function removeProgressUi() {
    ["a11ymonk-progress-pill", "a11ymonk-progress-live"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
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

    // Update the on-page progress UI (sr-only live region + visible pill) on the
    // scanned page — the active tab during the scan. Fire-and-forget; a failed
    // injection must not break the scan. The screenshot-capture phase is the long
    // one and drives the headline 25 → 50 → 75 → 100 batches; the quick prepare/scan
    // steps ramp below 25 (5, 15) so the bar never moves backward.
    const updateProgress = (pct, label, announce) =>
      chrome.scripting.executeScript({ target: { tabId }, func: updateProgressUi, args: [pct, label, announce !== false] }).catch(function () {});

    try {
      onStatus({ phase: "config", text: "Reading scan config…" });
      updateProgress(5, "Preparing scan");
      const cr = await fetch(api + "/api/local-scan/config", { headers: auth });
      const cfg = await cr.json();
      if (!cr.ok || !cfg.ok) throw new Error((cfg && cfg.error) || ("HTTP " + cr.status));

      onStatus({ phase: "inject", text: "Injecting scanner…", label: cfg.label, kind: cfg.kind });
      await chrome.scripting.executeScript({ target: { tabId }, files: ["vendor/axe.min.js"] });

      onStatus({ phase: "scan", text: "Scanning the page…" });
      updateProgress(15, "Scanning the page");
      const res = await chrome.scripting.executeScript({ target: { tabId }, func: axeInPage, args: [WCAG_TAGS, cfg.selector || "", cfg.exclude || []] });
      let issues = res && res[0] && res[0].result;
      if (issues && issues.__error) throw new Error("axe error: " + issues.__error);
      if (!Array.isArray(issues)) issues = [];

      if (screenshots && issues.length) {
        const limit = Math.min(issues.length, MAX_SHOTS);
        let lastBatchPct = -1;
        for (let i = 0; i < limit; i++) {
          // Report capture progress in 25% batches (quarters of the shot count):
          // 25 → 50 → 75 → 100. Update the pill AND announce only when the batch
          // changes, so the screen reader hears four milestones instead of one per
          // shot. The app-tab bar tracks the finer i/N via onStatus below.
          const batchPct = Math.min(100, Math.ceil(((i + 1) / limit) * 4) * 25);
          if (batchPct !== lastBatchPct) {
            lastBatchPct = batchPct;
            updateProgress(batchPct, "Capturing screenshots", true);
          }
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
      updateProgress(100, "Saving results");
      const ir = await fetch(api + "/api/local-scan/ingest", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ url: url || "", standard: "WCAG 2.2 AA", issues }),
      });
      const id = await ir.json();
      if (!ir.ok || !id.ok) throw new Error((id && id.error) || ("HTTP " + ir.status));
      const shots = issues.filter((x) => x.screenshotUrl).length;
      return { ok: true, issues: id.issues, shots, bucket: id.bucket || cfg.label, reportUrl: id.reportUrl };
    } finally {
      // Let the last (90%) update paint/announce, then remove both progress nodes so
      // nothing lingers on the user's page (runs on success and error alike).
      await delay(300);
      try { await chrome.scripting.executeScript({ target: { tabId }, func: removeProgressUi }); } catch (e) {}
    }
  }

  // Section-clip crop math shared by both crop implementations. Returns
  // {sx,sy,sw,sh} in device pixels, or null if too small.
  function cropRect(imgW, imgH, rect) {
    const dpr = rect.dpr || 1;
    const hPad = Math.max(120, Math.min(280, rect.w * 1.4)) * dpr;
    const vPad = Math.max(100, Math.min(220, rect.h * 1.8)) * dpr;
    const sx = Math.max(0, rect.x * dpr - hPad);
    let sy = Math.max(0, rect.y * dpr - vPad);
    const sw = Math.min(imgW - sx, rect.w * dpr + hPad * 2);
    let sh = Math.min(imgH - sy, rect.h * dpr + vPad * 2);
    // Keep the always-visible top progress pill out of the evidence crop (so it never
    // appears in the screenshot) WITHOUT hiding it — hiding per shot would flicker.
    if (rect.pillBottom) {
      const pb = Math.min(imgH, Math.max(0, rect.pillBottom * dpr));
      if (sy < pb) { const bottom = sy + sh; sy = pb; sh = Math.min(imgH - sy, bottom - pb); }
    }
    if (sw < 2 || sh < 2) return null;
    return { sx, sy, sw, sh };
  }

  self.A11yScan = { runScanFlow, cropRect };
})();
