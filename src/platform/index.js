export const PLATFORM_API_VERSION = 1;

export const PLATFORM_STORAGE_KEYS = Object.freeze([
  'slop-zoo-cannon.save',
  'slop-zoo-cannon.save.backup.0',
  'slop-zoo-cannon.save.backup.1',
  'slop-zoo-cannon.save.backup.2',
  'slop-zoo-cannon-best',
  'slop-zoo-cannon-settings',
]);

const STORAGE_KEY_SET = new Set(PLATFORM_STORAGE_KEYS);
const MAX_VALUE_LENGTH = 8 * 1024 * 1024;

export function createPlatformFacade(host = globalThis) {
  const desktopBridge = readDesktopBridge(host);
  if (desktopBridge) return createDesktopFacade(desktopBridge);
  return createBrowserFacade(host);
}

export async function initializePlatform(host = globalThis) {
  const platform = createPlatformFacade(host);
  exposePlatformFacade(host, platform);

  if (platform.environment === 'desktop') {
    await installDesktopStorageMirror(platform, host);
  }
  return platform;
}

function createDesktopFacade(bridge) {
  return deepFreeze({
    apiVersion: PLATFORM_API_VERSION,
    environment: 'desktop',
    capabilities: {
      get: () => bridge.capabilities.get(),
    },
    app: {
      getInfo: () => bridge.app.getInfo(),
    },
    storage: {
      read: (key) => bridge.storage.read(validateKey(key)),
      write: (key, value) => bridge.storage.write(validateKey(key), validateValue(value)),
      remove: (key) => bridge.storage.remove(validateKey(key)),
      flush: () => bridge.storage.flush(),
    },
  });
}

function createBrowserFacade(host) {
  const memory = new Map();
  const storage = getLocalStorage(host);
  const capabilities = deepFreeze({
    desktop: false,
    persistentStorage: Boolean(storage),
    atomicSave: false,
    backupCount: 0,
    steam: { available: false, mode: 'local-mock', reason: 'browser-build' },
    cloud: { available: false, mode: 'local-only' },
    overlay: { available: false },
  });

  return deepFreeze({
    apiVersion: PLATFORM_API_VERSION,
    environment: 'browser',
    capabilities: { get: async () => capabilities },
    app: {
      getInfo: async () => deepFreeze({
        name: '黏液动物园：补给炮台',
        version: null,
        platform: 'web',
        arch: null,
        packaged: false,
        locale: host.navigator?.language ?? 'zh-CN',
      }),
    },
    storage: {
      async read(key) {
        const safeKey = validateKey(key);
        try {
          return storage?.getItem(safeKey) ?? memory.get(safeKey) ?? null;
        } catch {
          return memory.get(safeKey) ?? null;
        }
      },
      async write(key, value) {
        const safeKey = validateKey(key);
        const safeValue = validateValue(value);
        memory.set(safeKey, safeValue);
        try {
          storage?.setItem(safeKey, safeValue);
        } catch { /* The in-memory fallback remains usable for this session. */ }
        return true;
      },
      async remove(key) {
        const safeKey = validateKey(key);
        memory.delete(safeKey);
        try {
          storage?.removeItem(safeKey);
        } catch { /* Nothing else to remove. */ }
        return true;
      },
      async flush() { return true; },
    },
  });
}

async function installDesktopStorageMirror(platform, host) {
  const storage = getLocalStorage(host);
  if (!storage) return;

  const prototype = Object.getPrototypeOf(storage);
  const nativeSetItem = prototype?.setItem;
  const nativeRemoveItem = prototype?.removeItem;
  const nativeClear = prototype?.clear;
  if (
    typeof nativeSetItem !== 'function'
    || typeof nativeRemoveItem !== 'function'
    || prototype.__slopZooDesktopMirror
  ) return;

  for (const key of PLATFORM_STORAGE_KEYS) {
    const desktopValue = await platform.storage.read(key);
    if (typeof desktopValue === 'string') {
      nativeSetItem.call(storage, key, desktopValue);
      continue;
    }
    const browserValue = storage.getItem(key);
    if (browserValue !== null) await platform.storage.write(key, browserValue);
  }
  await platform.storage.flush();

  const dispatch = (operation) => {
    try {
      return Promise.resolve(operation())
        .catch((error) => console.error('Desktop profile mirror failed.', error));
    } catch (error) {
      console.error('Desktop profile mirror failed.', error);
      return Promise.resolve();
    }
  };

  Object.defineProperties(prototype, {
    __slopZooDesktopMirror: {
      configurable: false,
      enumerable: false,
      value: true,
      writable: false,
    },
    setItem: {
      configurable: true,
      enumerable: false,
      writable: true,
      value(key, value) {
        const result = nativeSetItem.call(this, key, value);
        if (this === storage && STORAGE_KEY_SET.has(String(key))) {
          const safeKey = String(key);
          const safeValue = String(value);
          dispatch(() => platform.storage.write(safeKey, safeValue));
        }
        return result;
      },
    },
    removeItem: {
      configurable: true,
      enumerable: false,
      writable: true,
      value(key) {
        const result = nativeRemoveItem.call(this, key);
        if (this === storage && STORAGE_KEY_SET.has(String(key))) {
          const safeKey = String(key);
          dispatch(() => platform.storage.remove(safeKey));
        }
        return result;
      },
    },
  });

  if (typeof nativeClear === 'function') {
    Object.defineProperty(prototype, 'clear', {
      configurable: true,
      enumerable: false,
      writable: true,
      value() {
        const result = nativeClear.call(this);
        if (this === storage) {
          for (const key of PLATFORM_STORAGE_KEYS) dispatch(() => platform.storage.remove(key));
        }
        return result;
      },
    });
  }

  const flush = () => platform.storage.flush()
    .catch((error) => console.error('Desktop profile flush failed.', error));
  host.addEventListener?.('pagehide', flush);
  host.addEventListener?.('beforeunload', flush);
  host.document?.addEventListener?.('visibilitychange', () => {
    if (host.document.visibilityState === 'hidden') flush();
  });
}

function exposePlatformFacade(host, platform) {
  if (Object.hasOwn(host, 'slopZooPlatform')) return;
  Object.defineProperty(host, 'slopZooPlatform', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: platform,
  });
}

function readDesktopBridge(host) {
  const bridge = host?.slopZooDesktop;
  if (
    bridge?.apiVersion !== PLATFORM_API_VERSION
    || typeof bridge.capabilities?.get !== 'function'
    || typeof bridge.app?.getInfo !== 'function'
    || typeof bridge.storage?.read !== 'function'
    || typeof bridge.storage?.write !== 'function'
    || typeof bridge.storage?.remove !== 'function'
    || typeof bridge.storage?.flush !== 'function'
  ) return null;
  return bridge;
}

function getLocalStorage(host) {
  try {
    return host?.localStorage ?? null;
  } catch {
    return null;
  }
}

function validateKey(key) {
  if (typeof key !== 'string' || !STORAGE_KEY_SET.has(key)) {
    throw new TypeError('The requested platform storage key is not allowed.');
  }
  return key;
}

function validateValue(value) {
  if (typeof value !== 'string') throw new TypeError('Platform storage values must be strings.');
  if (new Blob([value]).size > MAX_VALUE_LENGTH) {
    throw new TypeError('The requested platform storage value is too large.');
  }
  return value;
}

function deepFreeze(value) {
  const freezeable = value && (typeof value === 'object' || typeof value === 'function');
  if (!freezeable || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}
