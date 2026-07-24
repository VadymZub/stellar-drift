// Central settings store — persisted to localStorage.
// _cache is the authoritative in-memory copy; localStorage is backup for page reload.
// loadSettings() is called every frame (drawMinimap), so the cache avoids repeated JSON parses.

const KEY = 'sd_settings';

export const UI_SCALE_STEPS = [80, 90, 100, 110, 120];

export const MINIMAP_SIZES = {
  small:  { w: 180, h: 100, pad: 16 },
  medium: { w: 250, h: 140, pad: 16 },
  large:  { w: 340, h: 190, pad: 16 },
};

export const DEFAULTS = {
  // Interface
  uiScale:      100,      // from UI_SCALE_STEPS
  minimapSize:  'medium', // 'small' | 'medium' | 'large'
  // Panels
  chatBg:       true,
  infoBg:       true,
  logBg:        true,
  // Gameplay
  autoTarget:   true,
  autoLoot:     true,
  autoCollect:  false,  // premium: auto-collect dungeon resources within magnet radius
  // Graphics
  engineTrails: true,
  cameraShake:  true,
  bgParallax:   true,
  // Требует перезагрузки страницы — Phaser не умеет менять antialias/antialiasGL
  // у уже созданного WebGL-контекста "на лету" (см. main.js/SettingsScene._save()).
  antialiasing: true,
  showFps:      false,
  showRam:      false, // JS heap usage (performance.memory — Chrome/Chromium only)
  // Sound
  masterVol:    100,
  musicVol:     75,
  sfxVol:       75,
  sfxBg:        true,
  // Language
  lang:         'ru',
  // Gear button position (null = default corner)
  gearX:        null,
  gearY:        null,
  // Social windows transparency (0=100%, 1=55%, 2=22%)
  grpWinAlphaIdx: 0,
  frWinAlphaIdx:  0,
  // Social buttons visibility
  showSocialBtns: true,
  // Чат полностью убран кнопкой ЧАТ на панели аккаунта (см. HudScene._toggleChatWin) —
  // персистится, чтобы не вылезал заново при каждом рестарте сцены/перезагрузке
  // страницы (диалог: "очень раздражает что чат даже в свёрнутом виде постоянно вылазит").
  chatHidden: false,
};

// In-memory cache — updated immediately on save/reset, read on every loadSettings() call.
let _cache = null;

function _fromStorage() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULTS };
}

export function loadSettings() {
  if (!_cache) _cache = _fromStorage();
  return { ..._cache };   // shallow copy — callers can mutate freely
}

export function saveSettings(s) {
  _cache = { ...s };      // store own copy so caller mutations don't affect cache
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}

export function resetSettings() {
  _cache = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch {}
  return { ..._cache };
}

export function getMinimapDims(size) {
  return MINIMAP_SIZES[size] || MINIMAP_SIZES.medium;
}
