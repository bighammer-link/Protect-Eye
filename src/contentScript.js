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

const MAX_INTENSITY = 0.75;
const OVERLAY_ID = "protect-eye-overlay";
const BRIGHTNESS_STYLE_ID = "protect-eye-brightness-style";
const CHECK_INTERVAL_MS = 60 * 1000;

let currentSettings = { ...DEFAULT_SETTINGS };
let overlayEl = null;
let brightnessStyleEl = null;
const currentHost = window.location.host;

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

function ensureDomNodes() {
  if (!overlayEl) {
    overlayEl = document.createElement("div");
    overlayEl.id = OVERLAY_ID;
    overlayEl.style.position = "fixed";
    overlayEl.style.left = "0";
    overlayEl.style.top = "0";
    overlayEl.style.width = "100vw";
    overlayEl.style.height = "100vh";
    overlayEl.style.pointerEvents = "none";
    overlayEl.style.mixBlendMode = "multiply";
    overlayEl.style.zIndex = "2147483647";
    overlayEl.style.transition = "background-color 0.3s ease, opacity 0.3s ease";
    overlayEl.style.backgroundColor = currentSettings.overlayColor;
    const safeIntensity = clamp(Number(currentSettings.intensity) || 0, 0, MAX_INTENSITY);
    overlayEl.style.opacity = String(safeIntensity);
    document.documentElement.appendChild(overlayEl);
  }
  if (!brightnessStyleEl) {
    brightnessStyleEl = document.createElement("style");
    brightnessStyleEl.id = BRIGHTNESS_STYLE_ID;
    document.documentElement.appendChild(brightnessStyleEl);
  }
}

function removeOverlay() {
  if (overlayEl?.parentElement) {
    overlayEl.parentElement.removeChild(overlayEl);
  }
  overlayEl = null;
  if (brightnessStyleEl?.parentElement) {
    brightnessStyleEl.parentElement.removeChild(brightnessStyleEl);
  }
  brightnessStyleEl = null;
}

function isWithinDailyOff(dailyOff, now) {
  if (!dailyOff?.enabled) return false;
  const [startHour, startMinute] = dailyOff.start.split(":").map((v) => parseInt(v, 10));
  const [endHour, endMinute] = dailyOff.end.split(":").map((v) => parseInt(v, 10));
  const start = new Date(now);
  start.setHours(startHour, startMinute, 0, 0);
  const end = new Date(now);
  end.setHours(endHour, endMinute, 0, 0);
  if (startHour === endHour && startMinute === endMinute) {
    return true;
  }
  if (start <= end) {
    return now >= start && now <= end;
  }
  // 跨越午夜
  return now >= start || now <= end;
}

function shouldActivate(settings) {
  if (!settings.enabled) return false;
  if (settings.temporaryOffUntil && Date.now() < settings.temporaryOffUntil) {
    return false;
  }
  if (settings.siteExceptions?.[currentHost]) {
    return false;
  }
  if (isWithinDailyOff(settings.dailyOff, new Date())) {
    return false;
  }
  return true;
}

function applySettings(settings) {
  currentSettings = normalizeSettings(settings);
  if (!shouldActivate(currentSettings)) {
    removeOverlay();
    return;
  }
  ensureDomNodes();

  const color = currentSettings.overlayColor || DEFAULT_SETTINGS.overlayColor;
  const intensity = clamp(Number(currentSettings.intensity) || 0, 0, MAX_INTENSITY);
  overlayEl.style.backgroundColor = color;
  overlayEl.style.opacity = String(intensity);

  const brightness = clamp(1 - intensity * 0.35, 0.35, 1);
  if (brightnessStyleEl) {
    brightnessStyleEl.textContent =
      `html { filter: brightness(${brightness}); transition: filter 0.3s ease; }\n` +
      `img, video { filter: brightness(${1 / brightness}); transition: filter 0.3s ease; }`;
  }
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function watchStorageChanges() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.protectEyeSettings) return;
    applySettings(changes.protectEyeSettings.newValue);
  });
}

function watchRealtimeMessages() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "protect-eye-preview" || !message.settings) {
      return false;
    }
    applySettings(message.settings);
    if (typeof sendResponse === "function") {
      sendResponse({ ok: true });
    }
    return false;
  });
}

function bootstrap() {
  chrome.storage.local.get(["protectEyeSettings"], (result) => {
    applySettings(result.protectEyeSettings || DEFAULT_SETTINGS);
  });
  watchStorageChanges();
  watchRealtimeMessages();
  setInterval(() => applySettings(currentSettings), CHECK_INTERVAL_MS);
}

bootstrap();
