const EXTERNAL_ORIGINS = new Set([
  'https://github.com',
  'https://jiahao6635.github.io',
  'https://store.steampowered.com',
]);

export function createSecureWebPreferences(preloadPath, development = false) {
  return Object.freeze({
    preload: preloadPath,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webviewTag: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    devTools: Boolean(development),
  });
}

export function isAllowedExternalUrl(candidate) {
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' && EXTERNAL_ORIGINS.has(url.origin);
  } catch {
    return false;
  }
}

export function resolveDevelopmentUrl(candidate) {
  if (!candidate) return null;
  const url = new URL(candidate);
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'http:' || !loopback || url.username || url.password) {
    throw new Error('The desktop development server must use loopback HTTP.');
  }
  return url.href;
}

export function isTrustedRendererUrl(candidate, options = {}) {
  try {
    const url = new URL(candidate);
    if (url.protocol === 'file:') {
      return options.development !== true
        && typeof options.productionUrl === 'string'
        && url.href === new URL(options.productionUrl).href;
    }
    if (!options.development || !options.developmentUrl) return false;
    return url.origin === new URL(options.developmentUrl).origin;
  } catch {
    return false;
  }
}
