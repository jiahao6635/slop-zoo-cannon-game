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

export const INPUT_DEVICES = Object.freeze({
  KEYBOARD_MOUSE: 'keyboard-mouse',
  GAMEPAD: 'gamepad',
});

export const DEFAULT_INPUT_SETTINGS = deepFreeze({
  mouseSensitivity: 1,
  gamepadSensitivity: 1,
  gamepadDeadzone: 0.16,
  gamepadAcceleration: 1.35,
  invertY: false,
  vibration: 0.8,
});

/**
 * Declarative action map used by createInputSystem(). Custom maps can replace
 * one source at a time, e.g. { fire: { keyboard: ['KeyF'] } }.
 *
 * Axis actions use -1..1. Button actions use 0..1 (analogue triggers retain
 * their pressure). Positive aimY means aiming up; positive menuY means down.
 */
export const DEFAULT_ACTION_MAP = deepFreeze({
  aimX: {
    type: 'axis',
    keyboard: { negative: ['ArrowLeft', 'KeyA'], positive: ['ArrowRight', 'KeyD'] },
    mouse: { axis: 'x', scale: 1 },
    gamepad: { axis: 2, scale: 1 },
  },
  aimY: {
    type: 'axis',
    keyboard: { negative: ['ArrowDown', 'KeyS'], positive: ['ArrowUp', 'KeyW'] },
    mouse: { axis: 'y', scale: -1, invertWithSetting: true },
    gamepad: { axis: 3, scale: -1, invertWithSetting: true },
  },
  fire: {
    type: 'button',
    keyboard: ['Space'],
    mouse: { buttons: [0] },
    gamepad: { buttons: [7] },
  },
  previousAmmo: {
    type: 'button',
    keyboard: ['KeyQ', 'BracketLeft'],
    mouse: { wheel: 'up' },
    gamepad: { buttons: [4] },
  },
  nextAmmo: {
    type: 'button',
    keyboard: ['KeyE', 'BracketRight'],
    mouse: { wheel: 'down' },
    gamepad: { buttons: [5] },
  },
  ability: {
    type: 'button',
    keyboard: ['ShiftLeft', 'ShiftRight'],
    mouse: { buttons: [2] },
    gamepad: { buttons: [0] },
  },
  confirm: {
    type: 'button',
    keyboard: ['Enter'],
    gamepad: { buttons: [0] },
  },
  cancel: {
    type: 'button',
    keyboard: ['Escape', 'Backspace'],
    gamepad: { buttons: [1] },
  },
  pause: {
    type: 'button',
    keyboard: ['Escape', 'KeyP'],
    gamepad: { buttons: [9] },
  },
  restart: {
    type: 'button',
    keyboard: ['KeyR'],
    gamepad: { buttons: [3] },
  },
  menuX: {
    type: 'axis',
    keyboard: { negative: ['ArrowLeft', 'KeyA'], positive: ['ArrowRight', 'KeyD'] },
    gamepad: { axis: 0, negativeButtons: [14], positiveButtons: [15] },
  },
  menuY: {
    type: 'axis',
    keyboard: { negative: ['ArrowUp', 'KeyW'], positive: ['ArrowDown', 'KeyS'] },
    gamepad: { axis: 1, negativeButtons: [12], positiveButtons: [13] },
  },
});

function mergeActionMap(overrides = {}) {
  const result = clone(DEFAULT_ACTION_MAP);
  for (const [action, override] of Object.entries(overrides || {})) {
    if (override === null) {
      delete result[action];
      continue;
    }

    const original = result[action] || {};
    result[action] = { ...original, ...override };
    for (const source of ['keyboard', 'mouse', 'gamepad']) {
      if (
        original[source]
        && override[source]
        && !Array.isArray(original[source])
        && !Array.isArray(override[source])
      ) {
        result[action][source] = { ...original[source], ...override[source] };
      }
    }
  }
  return result;
}

function normalizeInputSettings(settings = {}) {
  const source = settings?.controls || settings || {};
  return {
    mouseSensitivity: clamp(Number(source.mouseSensitivity) || DEFAULT_INPUT_SETTINGS.mouseSensitivity, 0.1, 4),
    gamepadSensitivity: clamp(Number(source.gamepadSensitivity) || DEFAULT_INPUT_SETTINGS.gamepadSensitivity, 0.1, 4),
    gamepadDeadzone: clamp(
      Number.isFinite(Number(source.gamepadDeadzone))
        ? Number(source.gamepadDeadzone)
        : DEFAULT_INPUT_SETTINGS.gamepadDeadzone,
      0,
      0.6,
    ),
    gamepadAcceleration: clamp(
      Number(source.gamepadAcceleration) || DEFAULT_INPUT_SETTINGS.gamepadAcceleration,
      0.5,
      3,
    ),
    invertY: typeof source.invertY === 'boolean' ? source.invertY : DEFAULT_INPUT_SETTINGS.invertY,
    vibration: clamp(
      Number.isFinite(Number(source.vibration)) ? Number(source.vibration) : DEFAULT_INPUT_SETTINGS.vibration,
      0,
      1,
    ),
  };
}

function createEvent(type, detail) {
  if (typeof CustomEvent === 'function') return new CustomEvent(type, { detail });
  if (typeof Event === 'function') {
    const event = new Event(type);
    Object.defineProperty(event, 'detail', { value: detail });
    return event;
  }
  return { type, detail };
}

function createEventBus() {
  if (typeof EventTarget === 'function') return new EventTarget();
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) || []) listener.call(this, event);
      return true;
    },
  };
}

function summarizeGamepad(gamepad) {
  if (!gamepad) return null;
  return {
    index: gamepad.index,
    id: gamepad.id,
    mapping: gamepad.mapping,
    connected: gamepad.connected !== false,
  };
}

function radialAxis(gamepad, axisIndex, deadzone) {
  if (!gamepad?.axes) return 0;
  const pairStart = axisIndex % 2 === 0 ? axisIndex : axisIndex - 1;
  const x = Number(gamepad.axes[pairStart]) || 0;
  const y = Number(gamepad.axes[pairStart + 1]) || 0;
  const magnitude = Math.min(1, Math.hypot(x, y));
  if (magnitude <= deadzone) return 0;
  const scaledMagnitude = (magnitude - deadzone) / (1 - deadzone);
  const component = axisIndex === pairStart ? x : y;
  return (component / (magnitude || 1)) * scaledMagnitude;
}

function gamepadButtonValue(gamepad, index) {
  const button = gamepad?.buttons?.[index];
  if (!button) return 0;
  return clamp(Number.isFinite(button.value) ? button.value : Number(button.pressed), 0, 1);
}

function keyboardAxis(binding, keys) {
  if (!binding || Array.isArray(binding)) return 0;
  const negative = (binding.negative || []).some((code) => keys.has(code)) ? 1 : 0;
  const positive = (binding.positive || []).some((code) => keys.has(code)) ? 1 : 0;
  return positive - negative;
}

function keyboardButton(binding, keys) {
  const codes = Array.isArray(binding) ? binding : binding?.buttons || [];
  return codes.some((code) => keys.has(code)) ? 1 : 0;
}

function bindingContainsKey(binding, code) {
  if (Array.isArray(binding)) return binding.includes(code);
  return [...(binding?.negative || []), ...(binding?.positive || []), ...(binding?.buttons || [])].includes(code);
}

function bindingContainsMouseButton(binding, button) {
  return binding?.buttons?.includes(button) || false;
}

/**
 * Creates one input owner for gameplay and menus.
 *
 * Call update(deltaSeconds) once at the beginning of every frame. getAction()
 * returns the current value. consumeAction() returns an edge value once, making
 * it suitable for pause, confirm and ammo switching.
 */
export function createInputSystem(options = {}) {
  const target = options.target || (typeof window !== 'undefined' ? window : null);
  const keyboardTarget = options.keyboardTarget || target;
  const pointerTarget = options.pointerTarget || target;
  const eventTarget = options.eventTarget || target;
  const getGamepads = options.getGamepads || (() => {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return [];
    return navigator.getGamepads() || [];
  });
  const mouseScale = Number.isFinite(options.mouseScale) ? options.mouseScale : 0.0025;
  const bus = createEventBus();
  const listeners = [];

  let actionMap = mergeActionMap(options.actionMap);
  let settings = normalizeInputSettings(options.settings);
  let currentDevice = options.initialDevice === INPUT_DEVICES.GAMEPAD
    ? INPUT_DEVICES.GAMEPAD
    : INPUT_DEVICES.KEYBOARD_MOUSE;
  let activeGamepadIndex = null;
  let activeGamepad = null;
  let destroyed = false;
  let wheelDirection = null;
  let elapsedSinceUpdate = 1 / 60;

  const keys = new Set();
  const mouseButtons = new Set();
  const mouseDelta = { x: 0, y: 0 };
  const actionValues = new Map();
  const previousValues = new Map();
  const pressedValues = new Map();
  const releasedActions = new Set();
  const consumedActions = new Set();
  const pendingPresses = new Set();

  function listen(node, type, handler, listenerOptions) {
    if (!node?.addEventListener) return;
    node.addEventListener(type, handler, listenerOptions);
    listeners.push(() => node.removeEventListener(type, handler, listenerOptions));
  }

  function emit(type, detail) {
    bus.dispatchEvent(createEvent(type, detail));
    if (eventTarget?.dispatchEvent) {
      eventTarget.dispatchEvent(createEvent(`slopzoo:${type}`, detail));
    }
  }

  function changeDevice(device, reason, gamepad = activeGamepad) {
    if (device === currentDevice) return;
    const previousDevice = currentDevice;
    currentDevice = device;
    const detail = { device, previousDevice, reason, gamepad: summarizeGamepad(gamepad) };
    emit('devicechange', detail);
    options.onDeviceChange?.(detail);
  }

  function queueKeyboardPress(code) {
    for (const [action, definition] of Object.entries(actionMap)) {
      if (definition.type === 'button' && bindingContainsKey(definition.keyboard, code)) {
        pendingPresses.add(action);
      }
    }
  }

  function queueMousePress(button) {
    for (const [action, definition] of Object.entries(actionMap)) {
      if (definition.type === 'button' && bindingContainsMouseButton(definition.mouse, button)) {
        pendingPresses.add(action);
      }
    }
  }

  function onKeyDown(event) {
    if (destroyed) return;
    if (!event.repeat) queueKeyboardPress(event.code);
    keys.add(event.code);
    changeDevice(INPUT_DEVICES.KEYBOARD_MOUSE, 'keyboard');
  }

  function onKeyUp(event) {
    keys.delete(event.code);
  }

  function onPointerDown(event) {
    if (destroyed) return;
    queueMousePress(event.button);
    mouseButtons.add(event.button);
    changeDevice(INPUT_DEVICES.KEYBOARD_MOUSE, 'pointer');
  }

  function onPointerUp(event) {
    mouseButtons.delete(event.button);
  }

  function onPointerMove(event) {
    if (destroyed) return;
    const dx = Number(event.movementX) || 0;
    const dy = Number(event.movementY) || 0;
    mouseDelta.x += dx;
    mouseDelta.y += dy;
    if (Math.abs(dx) + Math.abs(dy) >= 1) changeDevice(INPUT_DEVICES.KEYBOARD_MOUSE, 'pointer');
  }

  function onWheel(event) {
    if (destroyed || event.deltaY === 0) return;
    wheelDirection = event.deltaY < 0 ? 'up' : 'down';
    for (const [action, definition] of Object.entries(actionMap)) {
      if (definition.mouse?.wheel === wheelDirection) pendingPresses.add(action);
    }
    changeDevice(INPUT_DEVICES.KEYBOARD_MOUSE, 'wheel');
  }

  function clearDigitalState() {
    keys.clear();
    mouseButtons.clear();
    mouseDelta.x = 0;
    mouseDelta.y = 0;
  }

  function onGamepadConnected(event) {
    if (activeGamepadIndex === null) activeGamepadIndex = event.gamepad?.index ?? null;
    emit('gamepadconnected', { gamepad: summarizeGamepad(event.gamepad) });
  }

  function onGamepadDisconnected(event) {
    const disconnectedIndex = event.gamepad?.index;
    if (activeGamepadIndex === disconnectedIndex) {
      activeGamepadIndex = null;
      activeGamepad = null;
      if (currentDevice === INPUT_DEVICES.GAMEPAD) {
        changeDevice(INPUT_DEVICES.KEYBOARD_MOUSE, 'gamepad-disconnected', event.gamepad);
      }
    }
    emit('gamepaddisconnected', { gamepad: summarizeGamepad(event.gamepad) });
  }

  listen(keyboardTarget, 'keydown', onKeyDown);
  listen(keyboardTarget, 'keyup', onKeyUp);
  listen(pointerTarget, 'pointerdown', onPointerDown);
  listen(target, 'pointerup', onPointerUp);
  listen(target, 'pointercancel', onPointerUp);
  listen(pointerTarget, 'pointermove', onPointerMove, { passive: true });
  listen(pointerTarget, 'wheel', onWheel, { passive: true });
  listen(target, 'blur', clearDigitalState);
  listen(target, 'gamepadconnected', onGamepadConnected);
  listen(target, 'gamepaddisconnected', onGamepadDisconnected);

  function pollGamepad() {
    const previousGamepad = activeGamepad;
    let gamepads;
    try {
      gamepads = Array.from(getGamepads() || []).filter(Boolean);
    } catch {
      gamepads = [];
    }

    let selected = gamepads.find((gamepad) => gamepad.index === activeGamepadIndex) || gamepads[0] || null;
    const activityThreshold = Math.max(0.25, settings.gamepadDeadzone + 0.08);
    const active = gamepads.find((gamepad) => {
      const axisActive = (gamepad.axes || []).some((value) => Math.abs(value) > activityThreshold);
      const buttonActive = (gamepad.buttons || []).some((button) => button.pressed || button.value > 0.18);
      return axisActive || buttonActive;
    });

    if (active) {
      selected = active;
      activeGamepadIndex = active.index;
      changeDevice(INPUT_DEVICES.GAMEPAD, 'gamepad-input', active);
    }

    activeGamepad = selected;
    if (selected && activeGamepadIndex === null) activeGamepadIndex = selected.index;
    if (!selected && previousGamepad && currentDevice === INPUT_DEVICES.GAMEPAD) {
      activeGamepadIndex = null;
      changeDevice(INPUT_DEVICES.KEYBOARD_MOUSE, 'gamepad-unavailable', previousGamepad);
    }
    return selected;
  }

  function evaluateGamepad(definition, gamepad) {
    const binding = definition.gamepad;
    if (!binding || !gamepad) return 0;
    let value = 0;

    if (Number.isInteger(binding.axis)) {
      value = radialAxis(gamepad, binding.axis, settings.gamepadDeadzone);
      const isAimAxis = definition === actionMap.aimX || definition === actionMap.aimY;
      if (isAimAxis) {
        value = Math.sign(value) * (Math.abs(value) ** settings.gamepadAcceleration);
        value *= settings.gamepadSensitivity;
      }
      value *= Number.isFinite(binding.scale) ? binding.scale : 1;
      if (binding.invertWithSetting && settings.invertY) value *= -1;
    }

    for (const index of binding.negativeButtons || []) value -= gamepadButtonValue(gamepad, index);
    for (const index of binding.positiveButtons || []) value += gamepadButtonValue(gamepad, index);
    for (const index of binding.buttons || []) value = Math.max(value, gamepadButtonValue(gamepad, index));
    return definition.type === 'button' ? clamp(value, 0, 1) : clamp(value, -1, 1);
  }

  function evaluateMouse(definition) {
    const binding = definition.mouse;
    if (!binding) return 0;
    let value = 0;
    if (binding.axis === 'x' || binding.axis === 'y') {
      const delta = mouseDelta[binding.axis];
      value = delta * mouseScale * settings.mouseSensitivity / elapsedSinceUpdate;
      value *= Number.isFinite(binding.scale) ? binding.scale : 1;
      if (binding.invertWithSetting && settings.invertY) value *= -1;
    }
    for (const button of binding.buttons || []) value = Math.max(value, mouseButtons.has(button) ? 1 : 0);
    if (binding.wheel && binding.wheel === wheelDirection) value = Math.max(value, 1);
    return definition.type === 'button' ? clamp(value, 0, 1) : clamp(value, -1, 1);
  }

  function evaluateAction(definition, gamepad) {
    const keyboard = definition.type === 'axis'
      ? keyboardAxis(definition.keyboard, keys)
      : keyboardButton(definition.keyboard, keys);
    const mouse = evaluateMouse(definition);
    const pad = evaluateGamepad(definition, gamepad);
    if (definition.type === 'button') return Math.max(keyboard, mouse, pad);
    return clamp(keyboard + mouse + pad, -1, 1);
  }

  function update(deltaSeconds = 1 / 60) {
    if (destroyed) return;
    elapsedSinceUpdate = clamp(Number(deltaSeconds) || 1 / 60, 1 / 240, 0.25);
    const gamepad = pollGamepad();

    pressedValues.clear();
    releasedActions.clear();
    consumedActions.clear();

    for (const [action, definition] of Object.entries(actionMap)) {
      const previous = actionValues.get(action) || 0;
      const value = evaluateAction(definition, gamepad);
      const threshold = Number.isFinite(definition.pressThreshold) ? definition.pressThreshold : 0.5;
      const wasDown = Math.abs(previous) >= threshold;
      const isDown = Math.abs(value) >= threshold;
      const changedDirection = wasDown && isDown && Math.sign(previous) !== Math.sign(value);

      previousValues.set(action, previous);
      actionValues.set(action, value);
      if ((!wasDown && isDown) || changedDirection || pendingPresses.has(action)) {
        pressedValues.set(action, value || 1);
      }
      if (wasDown && !isDown) releasedActions.add(action);
    }

    pendingPresses.clear();
    wheelDirection = null;
    mouseDelta.x = 0;
    mouseDelta.y = 0;
  }

  function getAction(action) {
    return actionValues.get(action) || 0;
  }

  function consumeAction(action) {
    if (consumedActions.has(action)) return 0;
    const value = pressedValues.get(action) || 0;
    if (value) consumedActions.add(action);
    return value;
  }

  function wasActionReleased(action) {
    return releasedActions.has(action);
  }

  function setSettings(nextSettings) {
    settings = normalizeInputSettings({ ...settings, ...(nextSettings?.controls || nextSettings || {}) });
    return { ...settings };
  }

  function setActionMap(overrides) {
    actionMap = mergeActionMap(overrides);
    actionValues.clear();
    previousValues.clear();
    pressedValues.clear();
    return clone(actionMap);
  }

  async function vibrate(intensity = 1, duration = 100) {
    if (destroyed || settings.vibration <= 0) return false;
    const gamepad = activeGamepad || pollGamepad();
    const actuator = gamepad?.vibrationActuator || gamepad?.hapticActuators?.[0];
    if (!actuator) return false;

    const strength = clamp(Number(intensity) || 0, 0, 1) * settings.vibration;
    const milliseconds = clamp(Number(duration) || 0, 0, 1000);
    try {
      if (typeof actuator.playEffect === 'function') {
        await actuator.playEffect('dual-rumble', {
          startDelay: 0,
          duration: milliseconds,
          weakMagnitude: strength * 0.65,
          strongMagnitude: strength,
        });
        return true;
      }
      if (typeof actuator.pulse === 'function') {
        await actuator.pulse(strength, milliseconds);
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    listeners.splice(0).forEach((remove) => remove());
    clearDigitalState();
    actionValues.clear();
    previousValues.clear();
    pressedValues.clear();
    releasedActions.clear();
    pendingPresses.clear();
  }

  return {
    update,
    getAction,
    consumeAction,
    wasActionReleased,
    vibrate,
    setSettings,
    getSettings: () => ({ ...settings }),
    setActionMap,
    getActionMap: () => clone(actionMap),
    getActiveGamepad: () => summarizeGamepad(activeGamepad),
    addEventListener: (...args) => bus.addEventListener(...args),
    removeEventListener: (...args) => bus.removeEventListener(...args),
    destroy,
    get currentDevice() {
      return currentDevice;
    },
  };
}
