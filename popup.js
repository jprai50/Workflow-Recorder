const toggleBtn = document.getElementById('toggleBtn');
const analyzeBtn = document.getElementById('analyzeBtn');
const analyzeTitleInput = document.getElementById('analyzeTitle');
const exportBtn = document.getElementById('exportBtn');
const clearBtn = document.getElementById('clearBtn');
const statusDiv = document.getElementById('status');
const statusText = document.getElementById('statusText');

const waitBtn = document.getElementById('waitBtn');
const waitTimeInput = document.getElementById('waitTime');
const projectNameInput = document.getElementById('projectName');

// Grab the toggle switch
const highlighterToggle = document.getElementById('highlighterToggle');

const actionListUI = document.getElementById('actionList');
const actionCountUI = document.getElementById('actionCount');

// Grab the Modal Elements
const confirmModal = document.getElementById('confirmModal');
const modalMessage = document.getElementById('modalMessage');
const modalCancelBtn = document.getElementById('modalCancelBtn');
const modalConfirmBtn = document.getElementById('modalConfirmBtn');

// Load initial state
chrome.storage.local.get(['isRecording', 'actions', 'projectName', 'isHighlighterEnabled'], (result) => {
  updateUI(result.isRecording);
  renderPreview(result.actions || []);
  if (result.projectName) {
    projectNameInput.value = result.projectName;
  }
  // Default the toggle to true if it hasn't been set yet
  highlighterToggle.checked = result.isHighlighterEnabled !== false;
});

// Save the toggle preference when clicked
highlighterToggle.addEventListener('change', (e) => {
  chrome.storage.local.set({ isHighlighterEnabled: e.target.checked });
});

// Save project name on change
projectNameInput.addEventListener('change', (e) => {
  chrome.storage.local.set({ projectName: e.target.value });
});

// Watchdog for changes from content script or other popup actions
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    if (changes.actions) renderPreview(changes.actions.newValue || []);
    if (changes.isRecording) updateUI(changes.isRecording.newValue);
  }
});

// Toggle Recording On/Off
toggleBtn.addEventListener('click', async () => {
  chrome.storage.local.get(['isRecording'], async (result) => {
    const newState = !result.isRecording;
    let updateData = { isRecording: newState };

    if (newState) {
      let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url) updateData.startUrl = tab.url;
    }
    chrome.storage.local.set(updateData);
  });
});

// Insert Analyze Step
analyzeBtn.addEventListener('click', () => {
  chrome.storage.local.get({ actions: [] }, (data) => {
    const title = analyzeTitleInput.value.trim(); 
    let actionString = "- analyze";
    if (title) actionString = `- analyze with title "${title}"`; 
    chrome.storage.local.set({ actions: [...data.actions, actionString] }, () => {
      analyzeTitleInput.value = ""; 
    });
  });
});

// Insert Wait Step
waitBtn.addEventListener('click', () => {
  chrome.storage.local.get({ actions: [] }, (data) => {
    const seconds = waitTimeInput.value.trim();
    if (!seconds || isNaN(seconds) || seconds <= 0) return alert("Please enter a valid number of seconds.");
    chrome.storage.local.set({ actions: [...data.actions, `- wait for ${seconds}s`] }, () => {
      waitTimeInput.value = ""; 
    });
  });
});

// Reusable Custom Modal Logic
let modalTriggerElement = null;

function closeModal() {
  confirmModal.classList.add('hidden');
  if (modalTriggerElement) {
    modalTriggerElement.focus();
    modalTriggerElement = null;
  }
}

confirmModal.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal();
    return;
  }
  if (e.key === 'Tab') {
    const first = modalCancelBtn;
    const last = modalConfirmBtn;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});

function showConfirmModal(message, onConfirmCallback) {
  modalTriggerElement = document.activeElement;
  modalMessage.textContent = message;
  confirmModal.classList.remove('hidden');
  modalCancelBtn.focus();

  modalConfirmBtn.onclick = () => {
    closeModal();
    onConfirmCallback();
  };

  modalCancelBtn.onclick = () => {
    closeModal();
  };
}

// Clear all actions with Modal confirmation
clearBtn.addEventListener('click', () => {
  showConfirmModal("Are you sure you want to clear ALL recorded actions? This cannot be undone.", () => {
    // UPDATED: We now pass isRecording: false so the recorder shuts down alongside the clear
    chrome.storage.local.set({
    actions: [],
    startUrl: "",
    isRecording: false,
    projectName: projectNameInput.value
    });
  });
});

function extractVariables(actions) {
  const variables = new Set();

  actions.forEach(action => {
    const matches = action.match(/<([A-Z0-9_]+)>/g);

    if (matches) {
      matches.forEach(match => {
        variables.add(match.replace(/[<>]/g, ""));
      });
    }
  });

  return Array.from(variables).sort();
}

// Export YAML
exportBtn.addEventListener('click', () => {
  // UPDATED: Automatically stop recording before we compile the export
  chrome.storage.local.set({ isRecording: false }, () => {
    chrome.storage.local.get(['actions', 'startUrl'], (result) => {
      const actions = result.actions || [];
      const url = result.startUrl || "URL_NOT_FOUND"; 
      
      if (actions.length === 0) return alert("No actions recorded yet!");

      const rawProjectName = projectNameInput.value.trim();
      const projectName = rawProjectName || "My Recorded Project";
      const fileName = rawProjectName ? `${rawProjectName.replace(/[^a-zA-Z0-9]/g, "_")}.yaml`: "recorded_actions.yaml";

      const variables = extractVariables(actions);

let yamlString = "---\n";

if (variables.length > 0) {
    yamlString += "variables:\n";

    variables.forEach(variable => {
        yamlString += `  ${variable}: ""\n`;
    });

    yamlString += "\n";
}

yamlString +=
`projects:
  - name: ${projectName}
    id: ${projectName}
    pageList:
      - name: ${projectName}
        url: ${url}
        actions:
`;

actions.forEach(action => {
    yamlString += `              ${action}\n`;
});

      const blob = new Blob([yamlString], { type: "text/yaml" });
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(downloadUrl);
    });
  });
});

// Update UI Buttons visually
function updateUI(isRecording) {
  if (isRecording) {
    statusText.textContent = "Recording...";
    statusDiv.className = "recording";
    toggleBtn.textContent = "Stop Recording";
    toggleBtn.classList.add("recording");
    toggleBtn.setAttribute('aria-pressed', 'true');
  } else {
    statusText.textContent = "Stopped";
    statusDiv.className = "stopped";
    toggleBtn.textContent = "Start Recording";
    toggleBtn.classList.remove("recording");
    toggleBtn.setAttribute('aria-pressed', 'false');
  }
}

// Delete single action with Modal confirmation
function deleteAction(indexToRemove) {
  showConfirmModal("Are you sure you want to delete this action?", () => {
    chrome.storage.local.get({ actions: [] }, (data) => {
      const updatedActions = [...data.actions];
      updatedActions.splice(indexToRemove, 1);
      chrome.storage.local.set({ actions: updatedActions });
    });
  });
}

// Render the Live Preview list
function renderPreview(actions) {
  actionCountUI.textContent = `${actions.length} action${actions.length === 1 ? '' : 's'}`;
  
  if (actions.length === 0) {
    actionListUI.innerHTML = '<li class="empty-state">No actions recorded yet.</li>';
    return;
  }

  actionListUI.innerHTML = '';
  
  actions.forEach((action, index) => {
    const li = document.createElement('li');
    li.className = 'action-item';

    const textSpan = document.createElement('span');
    textSpan.className = 'action-text';
    textSpan.textContent = action;
    li.appendChild(textSpan);

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '✕';
    deleteBtn.className = 'delete-btn';
    deleteBtn.setAttribute('aria-label', `Delete action: ${action}`);
    deleteBtn.onclick = () => deleteAction(index);
    
    li.appendChild(deleteBtn);
    actionListUI.appendChild(li);
  });

  actionListUI.scrollTop = actionListUI.scrollHeight;
}