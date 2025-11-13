const PRESETS = [
  { key: "sunset", label: "暖阳", color: "#f4e9d8" },
  { key: "amber", label: "琥珀", color: "#ffd6a3" },
  { key: "forest", label: "雾森", color: "#d4f0c1" },
  { key: "ocean", label: "海雾", color: "#c6d5ff" },
  { key: "charcoal", label: "暗墨", color: "#383838" },
  { key: "night", label: "夜读", color: "#1f2535" }
];

const MAX_INTENSITY = 0.75;

const DEFAULT_SETTINGS = {
  enabled: true,
  presetKey: "sunset",
  overlayColor: "#f4e9d8",
  customColor: "#f4e9d8",
  intensity: 0.4,
  siteExceptions: {},
  temporaryOffUntil: 0,
  dailyOff: {
    enabled: false,
    start: "22:00",
    end: "07:00"
  }
};

const refs = {
  statusText: document.getElementById("statusText"),
  masterToggle: document.getElementById("masterToggle"),
  presetList: document.getElementById("presetList"),
  intensityRange: document.getElementById("intensityRange"),
  intensityValue: document.getElementById("intensityValue"),
  customColorInput: document.getElementById("customColorInput"),
  useCustomColorBtn: document.getElementById("useCustomColorBtn"),
  customCloseBtn: document.getElementById("customCloseBtn"),
  closePanel: document.getElementById("closePanel"),
  closePanelCloseBtn: document.getElementById("closePanelCloseBtn"),
  offAlwaysBtn: document.getElementById("offAlwaysBtn"),
  snoozeSelect: document.getElementById("snoozeSelect"),
  snoozeBtn: document.getElementById("snoozeBtn"),
  snoozeStopBtn: document.getElementById("snoozeStopBtn"),
  siteToggleBtn: document.getElementById("siteToggleBtn"),
  siteStatusText: document.getElementById("siteStatusText"),
  dailyOffToggle: document.getElementById("dailyOffToggle"),
  dailyStartInput: document.getElementById("dailyStartInput"),
  dailyEndInput: document.getElementById("dailyEndInput"),
  dailySaveBtn: document.getElementById("dailySaveBtn")
};

let currentSettings = { ...DEFAULT_SETTINGS };
let activeHost = null;
let activeTabId = null;
let presetButtons = [];

init();

async function init() {
  await Promise.all([loadSettings(), detectActiveHost()]);
  buildPresetButtons();
  bindEvents();
  render();
}

function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["protectEyeSettings"], (result) => {
      currentSettings = normalizeSettings(result.protectEyeSettings || DEFAULT_SETTINGS);
      resolve();
    });
  });
}

async function detectActiveHost() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;
    const url = new URL(tab.url);
    if (["http:", "https:"].includes(url.protocol)) {
      activeHost = url.host;
      activeTabId = tab.id ?? null;
    }
  } catch (error) {
    console.warn("无法获取当前站点：", error);
  }
}

function buildPresetButtons() {
  refs.presetList.innerHTML = "";
  presetButtons = PRESETS.map((preset) => {
    const btn = document.createElement("button");
    btn.className = "preset";
    btn.dataset.key = preset.key;
    btn.style.background = `linear-gradient(135deg, ${adjustColor(preset.color, 12)}, ${preset.color})`;
    btn.innerHTML = `<div class="dot" style="width:12px;height:12px;border-radius:50%;background:${preset.color};margin:0 auto;"></div><span>${preset.label}</span>`;
    btn.addEventListener("click", () => setPreset(preset));
    refs.presetList.appendChild(btn);
    return btn;
  });
}

function bindEvents() {
  refs.masterToggle.addEventListener("change", (event) => {
    if (event.target.checked) {
      updateSettings((draft) => {
        draft.enabled = true;
        draft.temporaryOffUntil = 0;
      });
      return;
    }
    updateSettings((draft) => {
      draft.enabled = false;
      draft.temporaryOffUntil = 0;
    });
  });

  refs.intensityRange.addEventListener("input", (event) => {
    const percent = clamp(Number(event.target.value) || 0, 0, MAX_INTENSITY * 100);
    const value = percent / 100;
    updateSettings((draft) => {
      draft.intensity = clamp(value, 0, MAX_INTENSITY);
    }, { persist: false });
  });

  ["change", "pointerup", "touchend"].forEach((evt) => {
    refs.intensityRange.addEventListener(evt, persistSettings);
  });

  refs.customColorInput.addEventListener("input", (event) => {
    const color = event.target.value;
    updateSettings((draft) => {
      draft.customColor = color;
      draft.overlayColor = color;
      draft.presetKey = "custom";
    });
  });

  refs.useCustomColorBtn.addEventListener("click", () => {
    updateSettings((draft) => {
      draft.overlayColor = draft.customColor || draft.overlayColor;
      draft.presetKey = "custom";
    });
  });

  refs.customCloseBtn.addEventListener("click", () => {
    toggleClosePanel(refs.closePanel.hidden);
  });

  refs.closePanelCloseBtn.addEventListener("click", () => {
    hideClosePanel();
  });

  refs.offAlwaysBtn.addEventListener("click", () => {
    updateSettings((draft) => {
      draft.enabled = false;
      draft.temporaryOffUntil = 0;
    });
    hideClosePanel();
  });

  refs.snoozeBtn.addEventListener("click", () => {
    const minutes = Number(refs.snoozeSelect.value) || 30;
    const until = Date.now() + minutes * 60 * 1000;
    updateSettings((draft) => {
      draft.enabled = true;
      draft.temporaryOffUntil = until;
    });
    hideClosePanel();
  });

  refs.snoozeStopBtn.addEventListener("click", () => {
    updateSettings((draft) => {
      draft.enabled = true;
      draft.temporaryOffUntil = 0;
    });
    hideClosePanel();
  });

  refs.siteToggleBtn.addEventListener("click", () => {
    if (!activeHost) return;
    updateSettings((draft) => {
      const next = { ...(draft.siteExceptions || {}) };
      if (next[activeHost]) {
        delete next[activeHost];
      } else {
        next[activeHost] = true;
      }
      draft.siteExceptions = next;
    });
  });

  refs.dailyOffToggle.addEventListener("change", (event) => {
    updateSettings((draft) => {
      draft.dailyOff = { ...(draft.dailyOff || DEFAULT_SETTINGS.dailyOff), enabled: event.target.checked };
    });
  });

  refs.dailySaveBtn.addEventListener("click", () => {
    const start = refs.dailyStartInput.value || DEFAULT_SETTINGS.dailyOff.start;
    const end = refs.dailyEndInput.value || DEFAULT_SETTINGS.dailyOff.end;
    updateSettings((draft) => {
      draft.dailyOff = {
        ...(draft.dailyOff || DEFAULT_SETTINGS.dailyOff),
        start,
        end
      };
    });
  });
}

function toggleClosePanel(forceOpen) {
  if (!refs.closePanel) return;
  const nextState = typeof forceOpen === "boolean" ? forceOpen : refs.closePanel.hidden;
  refs.closePanel.hidden = !nextState;
  if (refs.customCloseBtn) {
    refs.customCloseBtn.setAttribute("aria-expanded", String(nextState));
  }
}

function hideClosePanel() {
  toggleClosePanel(false);
}

function setPreset(preset) {
  updateSettings((draft) => {
    draft.presetKey = preset.key;
    draft.overlayColor = preset.color;
  });
}

function render() {
  refs.masterToggle.checked = Boolean(currentSettings.enabled);
  const percentValue = clamp(currentSettings.intensity || 0, 0, MAX_INTENSITY) * 100;
  const intensityPercent = Math.round(percentValue);
  refs.intensityRange.value = String(intensityPercent);
  refs.intensityValue.textContent = `${intensityPercent}%`;
  refs.customColorInput.value = currentSettings.customColor || DEFAULT_SETTINGS.customColor;
  refs.dailyOffToggle.checked = Boolean(currentSettings.dailyOff?.enabled);
  refs.dailyStartInput.value = currentSettings.dailyOff?.start || DEFAULT_SETTINGS.dailyOff.start;
  refs.dailyEndInput.value = currentSettings.dailyOff?.end || DEFAULT_SETTINGS.dailyOff.end;
  refs.statusText.textContent = buildStatusMessage();
  renderPresetHighlight();
  renderSiteStatus();
  renderSnoozeState();
}

function buildStatusMessage() {
  if (!currentSettings.enabled) {
    return "已关闭：手动停用";
  }
  if (isTemporarilySuspended()) {
    const minutes = Math.max(
      1,
      Math.ceil((currentSettings.temporaryOffUntil - Date.now()) / 60000)
    );
    return `暂停中，${minutes} 分钟后恢复`;
  }
  if (activeHost && currentSettings.siteExceptions?.[activeHost]) {
    return "当前网站已关闭护眼效果";
  }
  if (currentSettings.dailyOff?.enabled) {
    return `每天 ${currentSettings.dailyOff.start} - ${currentSettings.dailyOff.end} 自动关闭`;
  }
  return "运行中，保护你的双眼";
}

function renderPresetHighlight() {
  presetButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.key === currentSettings.presetKey);
  });
}

function renderSiteStatus() {
  if (!activeHost) {
    refs.siteStatusText.textContent = "需要有可访问的网址";
    refs.siteToggleBtn.disabled = true;
    refs.siteToggleBtn.textContent = "不可用";
    return;
  }
  const disabled = Boolean(currentSettings.siteExceptions?.[activeHost]);
  refs.siteStatusText.textContent = disabled ? `已对 ${activeHost} 关闭` : `当前网站：${activeHost}`;
  refs.siteToggleBtn.disabled = false;
  refs.siteToggleBtn.textContent = disabled ? "重新开启当前网站" : "仅当前网站关闭";
}

function renderSnoozeState() {
  if (!refs.snoozeBtn || !refs.snoozeStopBtn) return;
  const snoozed = isTemporarilySuspended();
  refs.snoozeBtn.textContent = snoozed ? "重新设置" : "开始";
  refs.snoozeStopBtn.disabled = !snoozed;
}

function isTemporarilySuspended() {
  return Boolean(currentSettings.temporaryOffUntil && Date.now() < currentSettings.temporaryOffUntil);
}

function normalizeSettings(raw) {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_SETTINGS };
  }
  const merged = {
    ...DEFAULT_SETTINGS,
    ...raw,
    dailyOff: {
      ...DEFAULT_SETTINGS.dailyOff,
      ...(raw.dailyOff || {})
    },
    siteExceptions: {
      ...DEFAULT_SETTINGS.siteExceptions,
      ...(raw.siteExceptions || {})
    }
  };
  merged.intensity = clamp(Number(merged.intensity) || 0, 0, MAX_INTENSITY);
  return merged;
}

function updateSettings(mutator, options = {}) {
  const { persist = true, realtime = true } = options;
  const next = cloneSettings(currentSettings);
  mutator(next);
  currentSettings = normalizeSettings(next);
  render();
  if (realtime) {
    broadcastRealtime();
  }
  if (persist) {
    scheduleSave(currentSettings);
  }
}

const scheduleSave = debounce((settings) => {
  chrome.storage.local.set({ protectEyeSettings: cloneSettings(settings) });
}, 120);

function persistSettings() {
  scheduleSave(currentSettings);
}

function broadcastRealtime() {
  if (!activeTabId) return;
  chrome.tabs.sendMessage(
    activeTabId,
    { type: "protect-eye-preview", settings: cloneSettings(currentSettings) },
    () => {
      const error = chrome.runtime.lastError;
      if (error && !isIgnorableSyncError(error.message)) {
        console.warn("实时同步失败：", error.message);
      }
    }
  );
}

function isIgnorableSyncError(message) {
  if (!message) return false;
  return IGNORED_SYNC_ERRORS.some((snippet) => message.includes(snippet));
}

function debounce(fn, wait = 200) {
  let timer = null;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

function cloneSettings(obj) {
  if (typeof structuredClone === "function") {
    return structuredClone(obj);
  }
  return JSON.parse(JSON.stringify(obj));
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function adjustColor(hex, amount = 10) {
  const num = parseInt(hex.replace("#", ""), 16);
  if (Number.isNaN(num)) return hex;
  const r = clamp(((num >> 16) & 0xff) + amount, 0, 255);
  const g = clamp(((num >> 8) & 0xff) + amount, 0, 255);
  const b = clamp((num & 0xff) + amount, 0, 255);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
const IGNORED_SYNC_ERRORS = [
  "Receiving end does not exist",
  "The message port closed before a response was received"
];
