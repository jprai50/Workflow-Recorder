let isRecording = false;
let isHighlighterEnabled = true; 
let activeElement = null;
let activeElementStartValue = "";

// Visual Highlighter Overlay
let highlightOverlay = null;
let variableCounter = 1;

function generateVariableName(element) {
  const candidates = [
    element.getAttribute("aria-label"),
    element.getAttribute("placeholder"),
    element.getAttribute("name"),
    element.getAttribute("id")
  ];

  const value = candidates.find(v => v && v.trim());

  if (!value) {
    return `INPUT_${variableCounter++}`;
  }

  const text = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");

  if (text.includes("EMAIL")) return "EMAIL";
  if (text.includes("USER")) return "USERNAME";
  if (text.includes("LOGIN")) return "USERNAME";
  if (text.includes("PASS")) return "PASSWORD";
  if (text.includes("PHONE")) return "PHONE";
  if (text.includes("SEARCH")) return "SEARCH_TEXT";
  if (text.includes("FIRST")) return "FIRST_NAME";
  if (text.includes("LAST")) return "LAST_NAME";
  if (text.includes("OTP")) return "OTP";

  return text || `INPUT_${variableCounter++}`;
}

function getRecordedValue(element) {
  return `<${generateVariableName(element)}>`;
}

function createHighlightOverlay() {
  if (document.getElementById('-recorder-highlight')) return;
  highlightOverlay = document.createElement('div');
  highlightOverlay.id = '-recorder-highlight';
  highlightOverlay.style.cssText = `
    position: fixed; pointer-events: none; z-index: 2147483647; 
    border: 2px dashed #ef4444; background-color: rgba(239, 68, 68, 0.15);
    display: none; transition: all 0.05s ease; box-sizing: border-box; border-radius: 2px;
  `;
  document.documentElement.appendChild(highlightOverlay);
}

function updateHighlight(target) {
  if (!isRecording || !isConnectionValid() || !target || !isHighlighterEnabled) {
    if (highlightOverlay) highlightOverlay.style.display = 'none';
    return;
  }

  if (target === document.body || target === document.documentElement) {
    if (highlightOverlay) highlightOverlay.style.display = 'none';
    return;
  }

  if (!highlightOverlay) createHighlightOverlay();

  const rect = target.getBoundingClientRect();
  highlightOverlay.style.top = `${rect.top}px`;
  highlightOverlay.style.left = `${rect.left}px`;
  highlightOverlay.style.width = `${rect.width}px`;
  highlightOverlay.style.height = `${rect.height}px`;
  highlightOverlay.style.display = 'block';
}

function isConnectionValid() {
  if (!chrome.runtime?.id) {
    console.warn(" YAML Recorder: Extension was updated. Please refresh this page.");
    return false;
  }
  return true;
}

if (isConnectionValid()) {
  chrome.storage.local.get(['isRecording', 'isHighlighterEnabled'], (result) => {
    isRecording = result.isRecording || false;
    isHighlighterEnabled = result.isHighlighterEnabled !== false;
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.isRecording) {
      isRecording = changes.isRecording.newValue;
      if (!isRecording && highlightOverlay) highlightOverlay.style.display = 'none';
    }
    if (changes.isHighlighterEnabled) {
      isHighlighterEnabled = changes.isHighlighterEnabled.newValue;
      if (!isHighlighterEnabled && highlightOverlay) highlightOverlay.style.display = 'none';
    }
  });
}

// -----------------------------------------------------------------------------
// ADVANCED SELECTOR GENERATION ENGINE
// -----------------------------------------------------------------------------

function getOptimalSelector(el) {
  if (el === document.body || el === document.documentElement) return "body";
  
  const tag = el.tagName.toLowerCase();
  let candidates = []; 

  if (tag === 'input' && (el.type === 'radio' || el.type === 'checkbox')) {
    if (el.id && !/\d/.test(el.id)) candidates.push(`//${tag}[@id='${el.id}']`);
    const htmlValue = el.getAttribute('value');
    if (el.name && htmlValue) candidates.push(`//${tag}[@name='${el.name}' and @value='${htmlValue}']`);
  }

  const qaPrefixes = ['data-test', 'data-qa', 'data-cy', 'data-automation', 'data-action', 'data-pendo', 'data-e2e'];
  for (let attr of el.attributes) {
    const attrName = attr.name.toLowerCase();
    const attrValue = attr.value.trim();
    if (qaPrefixes.some(prefix => attrName.startsWith(prefix))) {
      if (attrValue.length > 0 && attrValue.length < 50 && !attrValue.includes(' ')) {
        candidates.push(`//${tag}[@${attrName}='${attrValue}']`);
      }
    }
  }

  if (el.getAttribute('aria-label')) candidates.push(`//${tag}[@aria-label='${el.getAttribute('aria-label')}']`);
  if (el.title) candidates.push(`//${tag}[@title='${el.title}']`);
  if (el.alt) candidates.push(`//${tag}[@alt='${el.alt}']`);
  
// 4. Visible Text (Highly readable and robust, but NEVER for form inputs!)
  if (!['input', 'textarea', 'select'].includes(tag)) {
    const visibleText = el.innerText ? el.innerText.trim() : "";
    
    if (visibleText) {
      // Break the element's text into an array of individual lines
      const lines = visibleText.split(/\n+/).map(l => l.trim()).filter(l => l.length > 0);
      
      // NEW FIX: Scan down the lines and find the first one that is safe for XPath & YAML
      const safeText = lines.find(line => line.length < 100 && !line.includes("'") && !line.includes("#"));

      if (safeText) {
        candidates.push(`//${tag}[normalize-space(.)='${safeText}']`);
        candidates.push(`//${tag}[contains(., '${safeText}')]`);
      }
    }
  }

  if (el.id && !/\d/.test(el.id)) candidates.push(`//${tag}[@id='${el.id}']`);
  if (el.name) candidates.push(`//${tag}[@name='${el.name}']`);

  const innerImg = el.querySelector('img[alt]');
  if (innerImg) {
    const altText = innerImg.getAttribute('alt');
    if (altText && altText.trim().length > 0) candidates.push(`//${tag}[.//img[@alt='${altText}']]`);
  }

  for (let candidate of candidates) {
    try {
      const query = document.evaluate(candidate, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      if (query.snapshotLength === 1 && query.snapshotItem(0) === el) return candidate; 
    } catch (e) { /* Ignore bad syntax */ }
  }

  for (let candidate of candidates) {
    try {
      const query = document.evaluate(candidate, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      let matches = [];
      for (let i = 0; i < query.snapshotLength; i++) matches.push(query.snapshotItem(i));
      const index = matches.indexOf(el);
      if (index !== -1) return `(${candidate})[${index + 1}]`; 
    } catch (e) { /* Ignore */ }
  }

  return getCssPath(el, document); 
}

function getCssPath(el, rootNode) {
  let path = [];
  let current = el;
  while (current && current !== rootNode && current.nodeType === Node.ELEMENT_NODE) {
    if (current.id && !/\d/.test(current.id)) {
      path.unshift(`#${current.id}`);
      break; 
    } else {
      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) { index++; sibling = sibling.previousElementSibling; }
      if (current.parentNode && current.parentNode.childElementCount > 1) {
        path.unshift(`${current.tagName.toLowerCase()}:nth-child(${index})`);
      } else {
        path.unshift(current.tagName.toLowerCase());
      }
    }
    current = current.parentNode;
  }
  return path.join(' > ');
}

function buildShadowEval(targetElement) {
  let currentElement = targetElement;
  let querySegments = [];
  while (currentElement) {
    let root = currentElement.getRootNode(); 
    let cssPath = getCssPath(currentElement, root);
    if (root instanceof ShadowRoot) {
      querySegments.unshift(`.shadowRoot.querySelector('${cssPath}')`);
      currentElement = root.host; 
    } else if (root === document) {
      querySegments.unshift(`document.querySelector('${cssPath}')`);
      break;
    } else { break; }
  }
  return querySegments.join('');
}

// -----------------------------------------------------------------------------
// EVENT TARGETING & STATE MANAGEMENT
// -----------------------------------------------------------------------------

const isInIframe = window !== window.top;
let _iframeSelectorCache = undefined; 

function getIframeCssSelector() { return _iframeSelectorCache ?? null; }

if (isInIframe) {
  if (window.frameElement) {
    _iframeSelectorCache = getCssPath(window.frameElement, window.frameElement.ownerDocument);
  } else if (isConnectionValid()) {
    chrome.runtime.sendMessage({ type: "GET_IFRAME_SELECTOR" }, (response) => {
      _iframeSelectorCache = response?.selector ?? null;
    });
  }
}

// --- NEW: PROMISE QUEUE FOR SAFE STORAGE WRITES ---
let saveQueue = Promise.resolve();

function enqueueSave(actionString, redundantClickString = null) {
  if (!isConnectionValid()) return;
  
  saveQueue = saveQueue.then(() => {
    return new Promise(resolve => {
      chrome.storage.local.get({ actions: [] }, (data) => {
        let updatedActions = [...data.actions];
        
        // Handle cleanup of redundant clicks (e.g., from dropdowns or typing)
        if (redundantClickString && updatedActions.length > 0 && updatedActions[updatedActions.length - 1] === redundantClickString) {
          updatedActions.pop(); 
        }
        
        updatedActions.push(actionString);
        chrome.storage.local.set({ actions: updatedActions }, resolve);
      });
    });
  });
}

function getEventTarget(e) {
  const path = e.composedPath();
  let bestTarget = path.length > 0 ? path[0] : e.target;
  let foundQA = null;

  const qaPrefixes = ['data-test', 'data-qa', 'data-cy', 'data-automation', 'data-action', 'data-pendo', 'data-e2e'];

  for (let node of path) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    if (node === document.body || node === document.documentElement) break;

    const tag = node.tagName.toLowerCase();
    const isNativeInteractive = ['button', 'a', 'input', 'select', 'textarea'].includes(tag);
    const hasButtonRole = node.getAttribute('role') === 'button' || node.getAttribute('role') === 'link';
    
    if (isNativeInteractive || hasButtonRole) return node; 
    if (tag.includes('-')) return node; 

    const hasQAAttr = Array.from(node.attributes).some(attr => {
      const attrName = attr.name.toLowerCase();
      const attrValue = attr.value.trim();
      return qaPrefixes.some(prefix => attrName.startsWith(prefix)) && 
             attrValue.length > 0 && attrValue.length < 50 && !attrValue.includes(' ');
    });

    if (hasQAAttr && !foundQA) foundQA = node;
  }

  return foundQA || bestTarget;
}

function checkAndSaveTyping(actualTarget) {

  if (!actualTarget || actualTarget !== activeElement)
    return;

  const tagName = actualTarget.tagName.toUpperCase();
  const isCustomElement = tagName.includes('-');
  const inputType = actualTarget.type
    ? actualTarget.type.toLowerCase()
    : "text";

  const isTextArea = tagName === "TEXTAREA";
  const isTextInput =
    tagName === "INPUT" &&
    !["checkbox", "radio", "button", "submit"].includes(inputType);

  if (!(isTextArea || isTextInput || isCustomElement))
    return;

  const actualValue =
    actualTarget.value ||
    actualTarget.getAttribute("value") ||
    "";

  if (!actualValue.trim())
    return;

  const currentValue = getRecordedValue(actualTarget);

  if (
    actualValue !== activeElementStartValue &&
    currentValue
  ) {

    const isShadow =
      actualTarget.getRootNode() instanceof ShadowRoot;

    const iframeSelector =
      getIframeCssSelector();

    let redundantClickString = "";
    let typeActionString = "";

    if (isShadow) {

      const evalPath =
        buildShadowEval(actualTarget);

      redundantClickString =
        `- eval "${evalPath}.click()"`;

      typeActionString =
        `- eval "${evalPath}.value = '${currentValue}'"`;

    } else if (iframeSelector) {

      const cssPath =
        getCssPath(actualTarget, document);

      redundantClickString =
        `- click element ["${iframeSelector}", "${cssPath}"]`;

      typeActionString =
        `- type "${currentValue}" into element ["${iframeSelector}", "${cssPath}"]`;

    } else {

      const baseSelector =
        getOptimalSelector(actualTarget);

      redundantClickString =
        `- click element "${baseSelector}"`;

      typeActionString =
        `- type "${currentValue}" into element "${baseSelector}"`;

    }

    console.log(
      "Saving typing action:",
      typeActionString
    );

    enqueueSave(
      typeActionString,
      redundantClickString
    );

    activeElementStartValue = actualValue;

  }

}


// -----------------------------------------------------------------------------
// EVENT LISTENERS
// -----------------------------------------------------------------------------

document.addEventListener('focusin', (e) => {
  if (!isConnectionValid() || !isRecording) return;
  const actualTarget = getEventTarget(e);
  if (actualTarget) {
    activeElement = actualTarget;
    activeElementStartValue = actualTarget.value || actualTarget.getAttribute('value') || "";
    activeElement = actualTarget;
  }
}, true);

document.addEventListener('input', (e) => {
  if (!isConnectionValid() || !isRecording) return;
  const actualTarget = getEventTarget(e);
  if (actualTarget) {
     activeElement = actualTarget;
  }
}, true);

document.addEventListener('focusout', (e) => {
  if (!isConnectionValid() || !isRecording) return;
  const actualTarget = getEventTarget(e);
  checkAndSaveTyping(actualTarget);
}, true);

document.addEventListener('mouseover', (e) => {
  const actualTarget = getEventTarget(e);
  updateHighlight(actualTarget);
}, true);

document.addEventListener('scroll', () => {
  if (highlightOverlay) highlightOverlay.style.display = 'none';
}, true);

document.addEventListener('mouseout', (e) => {
  if (!e.relatedTarget && highlightOverlay) highlightOverlay.style.display = 'none';
}, true);

document.addEventListener('click', (e) => {
  if (!isConnectionValid() || !isRecording) return; 
  
  const actualTarget = getEventTarget(e);
  if (!actualTarget) return; 

  const tagName = actualTarget.tagName.toUpperCase();
  if (tagName === 'SELECT' || tagName === 'OPTION') return;
  
  const isShadow = actualTarget.getRootNode() instanceof ShadowRoot;
  const iframeSelector = getIframeCssSelector();
  let actionString = "";

  if (isShadow) {
    const evalPath = buildShadowEval(actualTarget);
    actionString = `- eval "${evalPath}.click()"`;
  } else if (iframeSelector) {
    const cssPath = getCssPath(actualTarget, document);
    actionString = `- click element ["${iframeSelector}", "${cssPath}"]`;
  } else {
    const selector = getOptimalSelector(actualTarget);
    actionString = `- click element "${selector}"`;
  }
  
  // 3. Queue the click save safely
  setTimeout(() => {
    enqueueSave(actionString);
    console.log( "Saving click action:",actionString);
  }, 10); 
}, true);

document.addEventListener('change', (e) => {
  if (!isConnectionValid() || !isRecording) return; 
  
  const actualTarget = getEventTarget(e);
  if (!actualTarget) return;

  const tagName = actualTarget.tagName.toUpperCase();
  
  if (tagName === 'SELECT') {
    const isShadow = actualTarget.getRootNode() instanceof ShadowRoot;
    const iframeSelector = getIframeCssSelector();
    const selectedOptionText = actualTarget.options[actualTarget.selectedIndex]?.text.trim() || "";

    let redundantClickString = "";
    let selectActionString = "";

    if (isShadow) {
      const evalPath = buildShadowEval(actualTarget);
      redundantClickString = `- eval "${evalPath}.click()"`;
      selectActionString = `- eval "${evalPath}.value = '${actualTarget.value}'"`;
    } else if (iframeSelector) {
      const cssPath = getCssPath(actualTarget, document);
      redundantClickString = `- click element ["${iframeSelector}", "${cssPath}"]`;
      selectActionString = `- select the "${selectedOptionText}" option in ["${iframeSelector}", "${cssPath}"]`;
    } else {
      const baseSelector = getOptimalSelector(actualTarget);
      redundantClickString = `- click element "${baseSelector}"`;
      selectActionString = `- select the "${selectedOptionText}" option in "${baseSelector}"`;
    }
    
    // 4. Use the new Queue
    enqueueSave(selectActionString, redundantClickString);
  }
}, true);

document.addEventListener('keydown', (e) => {
  if (!isConnectionValid() || !isRecording) return;

  const keyMap = { 'Enter': 'ENTER', 'Tab': 'TAB', 'Escape': 'ESCAPE' };
  if (!keyMap[e.key]) return; 

  const actualTarget = getEventTarget(e);
  if (!actualTarget) return;

  checkAndSaveTyping(actualTarget);

  const keyName = keyMap[e.key];
  const iframeSelector = getIframeCssSelector();
  let actionString = "";

  if (iframeSelector) {
    const cssPath = getCssPath(actualTarget, document);
    actionString = `- press "${keyName}" on ["${iframeSelector}", "${cssPath}"]`;
  } else {
    const baseSelector = getOptimalSelector(actualTarget);
    actionString = `- press "${keyName}" on "${baseSelector}"`;
  }

  // 5. Queue the keydown save safely
  setTimeout(() => {
    enqueueSave(actionString);
  }, 50);
}, true);