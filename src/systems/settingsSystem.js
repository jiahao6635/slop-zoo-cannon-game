export const SETTINGS_VERSION = 2;
export const SETTINGS_STORAGE_KEY = 'slop-zoo-cannon-settings';

export const QUALITY_PRESETS = deepFreeze(['low', 'medium', 'high']);
export const SHADOW_QUALITIES = deepFreeze(['off', 'low', 'medium', 'high']);
export const PARTICLE_QUALITIES = deepFreeze(['low', 'medium', 'high']);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export const DEFAULT_SETTINGS = deepFreeze({
  version: SETTINGS_VERSION,
  audio: {
    masterVolume: 0.8,
    musicVolume: 0.65,
    sfxVolume: 0.85,
  },
  controls: {
    mouseSensitivity: 1,
    gamepadSensitivity: 1,
    gamepadDeadzone: 0.16,
    gamepadAcceleration: 1.35,
    invertY: false,
    vibration: 0.8,
  },
  gameplay: {
    trajectoryLine: true,
    trajectoryMode: 'full',
    aimAssist: 0.35,
    cameraShake: 0.6,
  },
  accessibility: {
    highContrast: false,
    uiScale: 1,
    reducedMotion: false,
  },
  graphics: {
    qualityPreset: 'medium',
    dynamicRenderScale: true,
    shadowQuality: 'medium',
    particleQuality: 'medium',
    renderScale: 1,
  },
});

function finiteNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, min, max) : fallback;
}

function enumValue(value, allowedValues, fallback) {
  return typeof value === 'string' && allowedValues.includes(value) ? value : fallback;
}

function migrateSettings(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const version = Number(raw.version) || 0;
  if (version >= SETTINGS_VERSION) return raw;

  // Version 0 covered early prototypes that stored the public options flat.
  return {
    ...raw,
    audio: {
      ...(raw.audio || {}),
      masterVolume: raw.audio?.masterVolume ?? raw.masterVolume,
      musicVolume: raw.audio?.musicVolume ?? raw.musicVolume,
      sfxVolume: raw.audio?.sfxVolume ?? raw.sfxVolume,
    },
    controls: {
      ...(raw.controls || {}),
      mouseSensitivity: raw.controls?.mouseSensitivity ?? raw.mouseSensitivity,
      gamepadSensitivity: raw.controls?.gamepadSensitivity ?? raw.gamepadSensitivity,
      gamepadDeadzone: raw.controls?.gamepadDeadzone ?? raw.gamepadDeadzone ?? raw.deadzone,
      gamepadAcceleration: raw.controls?.gamepadAcceleration ?? raw.gamepadAcceleration,
      invertY: raw.controls?.invertY ?? raw.invertY,
      vibration: raw.controls?.vibration ?? raw.vibration,
    },
    gameplay: {
      ...(raw.gameplay || {}),
      trajectoryLine: raw.gameplay?.trajectoryLine ?? raw.trajectoryLine,
      trajectoryMode: raw.gameplay?.trajectoryMode ?? raw.trajectoryMode ?? raw.trajectory,
      aimAssist: raw.gameplay?.aimAssist ?? raw.aimAssist,
      cameraShake: raw.gameplay?.cameraShake ?? raw.cameraShake,
    },
    accessibility: {
      ...(raw.accessibility || {}),
      highContrast: raw.accessibility?.highContrast ?? raw.highContrast,
      uiScale: raw.accessibility?.uiScale ?? raw.uiScale,
      reducedMotion: raw.accessibility?.reducedMotion ?? raw.reducedMotion,
    },
    graphics: {
      ...(raw.graphics || {}),
      qualityPreset: raw.graphics?.qualityPreset ?? raw.qualityPreset,
      dynamicRenderScale: raw.graphics?.dynamicRenderScale ?? raw.dynamicRenderScale,
      shadowQuality: raw.graphics?.shadowQuality ?? raw.shadowQuality,
      particleQuality: raw.graphics?.particleQuality ?? raw.particleQuality,
      renderScale: raw.graphics?.renderScale ?? raw.renderScale,
    },
    version: SETTINGS_VERSION,
  };
}

export function normalizeSettings(settings = {}) {
  const source = migrateSettings(settings);
  return {
    version: SETTINGS_VERSION,
    audio: {
      masterVolume: finiteNumber(source.audio?.masterVolume, DEFAULT_SETTINGS.audio.masterVolume, 0, 1),
      musicVolume: finiteNumber(source.audio?.musicVolume, DEFAULT_SETTINGS.audio.musicVolume, 0, 1),
      sfxVolume: finiteNumber(source.audio?.sfxVolume, DEFAULT_SETTINGS.audio.sfxVolume, 0, 1),
    },
    controls: {
      mouseSensitivity: finiteNumber(
        source.controls?.mouseSensitivity,
        DEFAULT_SETTINGS.controls.mouseSensitivity,
        0.1,
        4,
      ),
      gamepadSensitivity: finiteNumber(
        source.controls?.gamepadSensitivity,
        DEFAULT_SETTINGS.controls.gamepadSensitivity,
        0.1,
        4,
      ),
      gamepadDeadzone: finiteNumber(
        source.controls?.gamepadDeadzone,
        DEFAULT_SETTINGS.controls.gamepadDeadzone,
        0,
        0.6,
      ),
      gamepadAcceleration: finiteNumber(
        source.controls?.gamepadAcceleration,
        DEFAULT_SETTINGS.controls.gamepadAcceleration,
        0.5,
        3,
      ),
      invertY: typeof source.controls?.invertY === 'boolean'
        ? source.controls.invertY
        : DEFAULT_SETTINGS.controls.invertY,
      vibration: finiteNumber(
        source.controls?.vibration,
        DEFAULT_SETTINGS.controls.vibration,
        0,
        1,
      ),
    },
    gameplay: {
      trajectoryLine: typeof source.gameplay?.trajectoryLine === 'boolean'
        ? source.gameplay.trajectoryLine
        : DEFAULT_SETTINGS.gameplay.trajectoryLine,
      trajectoryMode: ['full', 'short', 'off'].includes(source.gameplay?.trajectoryMode)
        ? source.gameplay.trajectoryMode
        : (source.gameplay?.trajectoryLine === false ? 'off' : DEFAULT_SETTINGS.gameplay.trajectoryMode),
      aimAssist: finiteNumber(
        source.gameplay?.aimAssist,
        DEFAULT_SETTINGS.gameplay.aimAssist,
        0,
        1,
      ),
      cameraShake: finiteNumber(
        source.gameplay?.cameraShake,
        DEFAULT_SETTINGS.gameplay.cameraShake,
        0,
        1,
      ),
    },
    accessibility: {
      highContrast: typeof source.accessibility?.highContrast === 'boolean'
        ? source.accessibility.highContrast
        : DEFAULT_SETTINGS.accessibility.highContrast,
      uiScale: finiteNumber(source.accessibility?.uiScale, DEFAULT_SETTINGS.accessibility.uiScale, 0.8, 1.5),
      reducedMotion: typeof source.accessibility?.reducedMotion === 'boolean'
        ? source.accessibility.reducedMotion
        : DEFAULT_SETTINGS.accessibility.reducedMotion,
    },
    graphics: {
      qualityPreset: enumValue(
        source.graphics?.qualityPreset,
        QUALITY_PRESETS,
        DEFAULT_SETTINGS.graphics.qualityPreset,
      ),
      dynamicRenderScale: typeof source.graphics?.dynamicRenderScale === 'boolean'
        ? source.graphics.dynamicRenderScale
        : DEFAULT_SETTINGS.graphics.dynamicRenderScale,
      shadowQuality: enumValue(
        source.graphics?.shadowQuality,
        SHADOW_QUALITIES,
        DEFAULT_SETTINGS.graphics.shadowQuality,
      ),
      particleQuality: enumValue(
        source.graphics?.particleQuality,
        PARTICLE_QUALITIES,
        DEFAULT_SETTINGS.graphics.particleQuality,
      ),
      renderScale: finiteNumber(
        source.graphics?.renderScale,
        DEFAULT_SETTINGS.graphics.renderScale,
        0.5,
        1.5,
      ),
    },
  };
}

function resolveStorage(storage) {
  if (storage !== undefined) return storage;
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** Loads, migrates and validates settings. Corrupt or unavailable storage is safe. */
export function loadSettings(options = {}) {
  const storage = resolveStorage(options.storage);
  const key = options.key || SETTINGS_STORAGE_KEY;
  if (!storage) return clone(DEFAULT_SETTINGS);

  try {
    const serialized = storage.getItem(key);
    if (!serialized) return clone(DEFAULT_SETTINGS);
    return normalizeSettings(JSON.parse(serialized));
  } catch (error) {
    options.onError?.(error, 'load');
    return clone(DEFAULT_SETTINGS);
  }
}

/** Validates before writing and returns the exact normalized object persisted. */
export function saveSettings(settings, options = {}) {
  const normalized = normalizeSettings(settings);
  const storage = resolveStorage(options.storage);
  const key = options.key || SETTINGS_STORAGE_KEY;
  if (!storage) return normalized;

  try {
    storage.setItem(key, JSON.stringify(normalized));
  } catch (error) {
    options.onError?.(error, 'save');
  }
  return normalized;
}

export function resetSettings(options = {}) {
  const storage = resolveStorage(options.storage);
  const key = options.key || SETTINGS_STORAGE_KEY;
  try {
    storage?.removeItem(key);
  } catch (error) {
    options.onError?.(error, 'reset');
  }
  return clone(DEFAULT_SETTINGS);
}

function setAudioVolume(masterGain, volume) {
  if (!masterGain) return;
  const parameter = masterGain.gain || masterGain;
  if (typeof parameter.setTargetAtTime === 'function') {
    const time = parameter.context?.currentTime || 0;
    parameter.setTargetAtTime(volume, time, 0.015);
  } else if (parameter && typeof parameter === 'object' && 'value' in parameter) {
    parameter.value = volume;
  }
}

function dispatchAppliedEvent(target, settings) {
  if (!target?.dispatchEvent) return;
  let event;
  if (typeof CustomEvent === 'function') {
    event = new CustomEvent('slopzoo:settingsapplied', { detail: { settings } });
  } else if (typeof Event === 'function') {
    event = new Event('slopzoo:settingsapplied');
    Object.defineProperty(event, 'detail', { value: { settings } });
  }
  if (event) target.dispatchEvent(event);
}

/**
 * Applies settings to optional adapters without coupling this module to Three.js.
 * Every adapter is optional, so this is also useful during staged integration.
 */
export function applySettings(settings, adapters = {}) {
  const normalized = normalizeSettings(settings);
  const root = adapters.root === undefined
    ? (typeof document !== 'undefined' ? document.documentElement : null)
    : adapters.root;

  adapters.inputSystem?.setSettings?.(normalized.controls);
  adapters.setMasterVolume?.(normalized.audio.masterVolume);
  adapters.setMusicVolume?.(normalized.audio.musicVolume);
  adapters.setSfxVolume?.(normalized.audio.sfxVolume);
  setAudioVolume(adapters.masterGain, normalized.audio.masterVolume);

  if (adapters.trajectory) adapters.trajectory.visible = normalized.gameplay.trajectoryMode !== 'off';
  adapters.setTrajectoryLine?.(normalized.gameplay.trajectoryMode !== 'off');
  adapters.setTrajectoryMode?.(normalized.gameplay.trajectoryMode);
  adapters.setAimAssist?.(normalized.gameplay.aimAssist);
  adapters.setCameraShake?.(normalized.gameplay.cameraShake);

  if (root) {
    root.classList?.toggle('high-contrast', normalized.accessibility.highContrast);
    root.classList?.toggle('reduced-motion', normalized.accessibility.reducedMotion);
    if (root.dataset) root.dataset.highContrast = String(normalized.accessibility.highContrast);
    if (root.dataset) root.dataset.reducedMotion = String(normalized.accessibility.reducedMotion);
    root.style?.setProperty('--ui-scale', String(normalized.accessibility.uiScale));
  }

  if (adapters.renderer?.setPixelRatio) {
    const devicePixelRatio = finiteNumber(
      adapters.devicePixelRatio ?? globalThis.devicePixelRatio,
      1,
      0.5,
      adapters.maxDevicePixelRatio || 4,
    );
    adapters.renderer.setPixelRatio(devicePixelRatio * normalized.graphics.renderScale);
  }
  adapters.setQualityPreset?.(normalized.graphics.qualityPreset);
  adapters.setDynamicRenderScale?.(normalized.graphics.dynamicRenderScale);
  adapters.setShadowQuality?.(normalized.graphics.shadowQuality);
  adapters.setParticleQuality?.(normalized.graphics.particleQuality);
  adapters.setRenderScale?.(normalized.graphics.renderScale);
  adapters.onApplied?.(normalized);
  dispatchAppliedEvent(adapters.eventTarget || root, normalized);
  return normalized;
}
