import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  session,
  shell,
} from 'electron';

import {
  DesktopSaveStore,
  assertAllowedStorageKey,
  assertStorageValue,
} from './storage.js';
import {
  createSecureWebPreferences,
  isAllowedExternalUrl,
  isTrustedRendererUrl,
  resolveDevelopmentUrl,
} from './windowPolicy.js';

const currentDirectory = fileURLToPath(new URL('.', import.meta.url));
const developmentUrl = app.isPackaged
  ? null
  : resolveDevelopmentUrl(process.env.VITE_DEV_SERVER_URL);
const development = Boolean(developmentUrl);
const productionFile = join(currentDirectory, '..', 'dist', 'index.html');
const productionUrl = pathToFileURL(productionFile).href;

const IPC = Object.freeze({
  capabilities: 'slop-zoo:platform:capabilities',
  appInfo: 'slop-zoo:platform:app-info',
  storageRead: 'slop-zoo:storage:read',
  storageWrite: 'slop-zoo:storage:write',
  storageRemove: 'slop-zoo:storage:remove',
  storageFlush: 'slop-zoo:storage:flush',
});

let mainWindow = null;
let saveStore = null;
let shutdownStarted = false;
let shutdownComplete = false;
const RENDERER_FLUSH_TIMEOUT_MS = 3_000;

app.enableSandbox();

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.on('before-quit', (event) => {
    if (shutdownComplete || !saveStore) return;
    event.preventDefault();
    if (shutdownStarted) return;
    shutdownStarted = true;
    flushRendererStorage(mainWindow)
      .catch((error) => console.error('Unable to confirm the renderer storage flush.', error))
      .then(() => saveStore.flush({ markLastGoodExit: true }))
      .catch((error) => console.error('Unable to write the last-good-exit profile.', error))
      .finally(() => {
        shutdownComplete = true;
        app.quit();
      });
  });

  app.on('window-all-closed', () => app.quit());

  app.whenReady()
    .then(startDesktopApp)
    .catch((error) => {
      console.error('Desktop startup failed.', error);
      app.exit(1);
    });
}

async function startDesktopApp() {
  Menu.setApplicationMenu(null);
  denyRuntimePermissions();

  saveStore = new DesktopSaveStore(join(app.getPath('userData'), 'profile'));
  const recovery = await saveStore.initialize();
  if (recovery) console.warn(`Recovered desktop profile from ${recovery.source}.`);

  registerIpcHandlers();
  mainWindow = createMainWindow();
  await loadGame(mainWindow);
}

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#061b1c',
    show: false,
    autoHideMenuBar: true,
    title: '黏液动物园：补给炮台',
    webPreferences: createSecureWebPreferences(join(currentDirectory, 'preload.cjs'), development),
  });

  let closePrepared = false;
  let closePreparation = null;

  window.once('ready-to-show', () => window.show());
  window.on('close', (event) => {
    if (closePrepared || shutdownComplete || window.webContents.isDestroyed()) return;
    event.preventDefault();
    if (closePreparation) return;
    window.hide();
    closePreparation = flushRendererStorage(window)
      .catch((error) => console.error('Unable to confirm the renderer storage flush.', error))
      .then(() => saveStore?.flush())
      .catch((error) => console.error('Unable to flush the desktop profile before closing.', error))
      .finally(() => {
        closePrepared = true;
        if (!window.isDestroyed()) window.close();
      });
  });
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  hardenWebContents(window);
  return window;
}

async function loadGame(window) {
  if (developmentUrl) {
    await window.loadURL(developmentUrl);
    return;
  }
  await window.loadFile(productionFile);
}

function hardenWebContents(window) {
  const { webContents } = window;

  webContents.setWindowOpenHandler(({ url }) => {
    openAllowedExternalUrl(url);
    return { action: 'deny' };
  });

  webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    openAllowedExternalUrl(url);
  });

  webContents.session.on('will-download', (event) => event.preventDefault());

  if (!development) {
    webContents.on('before-input-event', (event, input) => {
      const key = String(input.key || '').toLowerCase();
      const developerShortcut = key === 'f12'
        || ((input.control || input.meta) && input.shift && ['i', 'j', 'c'].includes(key));
      if (developerShortcut) event.preventDefault();
    });
  }
}

function openAllowedExternalUrl(url) {
  if (!isAllowedExternalUrl(url)) return;
  shell.openExternal(url).catch((error) => console.error('Unable to open external URL.', error));
}

function denyRuntimePermissions() {
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setDevicePermissionHandler?.(() => false);
}

async function flushRendererStorage(window) {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
  const rendererFlush = window.webContents.executeJavaScript(
    'globalThis.slopZooPlatform?.storage?.flush?.() ?? true',
    true,
  );
  await withTimeout(rendererFlush, RENDERER_FLUSH_TIMEOUT_MS);
}

function withTimeout(promise, timeoutMilliseconds) {
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error('Renderer storage flush timed out.')),
      timeoutMilliseconds,
    );
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timeout));
}

function registerIpcHandlers() {
  const trusted = (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      throw new Error('IPC request rejected.');
    }
    const senderUrl = event.senderFrame?.url || event.sender.getURL();
    if (!isTrustedRendererUrl(senderUrl, { development, developmentUrl, productionUrl })) {
      throw new Error('IPC origin rejected.');
    }
  };

  ipcMain.handle(IPC.capabilities, (event) => {
    trusted(event);
    return {
      desktop: true,
      persistentStorage: true,
      atomicSave: true,
      backupCount: 3,
      steam: {
        available: false,
        mode: 'local-mock',
        reason: 'steamworks-not-configured',
      },
      cloud: { available: false, mode: 'local-only' },
      overlay: { available: false },
    };
  });

  ipcMain.handle(IPC.appInfo, (event) => {
    trusted(event);
    return {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
      locale: app.getLocale(),
    };
  });

  ipcMain.handle(IPC.storageRead, async (event, key) => {
    trusted(event);
    return saveStore.getItem(assertAllowedStorageKey(key));
  });

  ipcMain.on(IPC.storageWrite, (event, key, value) => {
    try {
      trusted(event);
      saveStore.setItem(assertAllowedStorageKey(key), assertStorageValue(value))
        .catch((error) => console.error('Desktop profile write failed.', error));
    } catch (error) {
      console.error('Desktop profile write rejected.', error);
    }
  });

  ipcMain.on(IPC.storageRemove, (event, key) => {
    try {
      trusted(event);
      saveStore.removeItem(assertAllowedStorageKey(key))
        .catch((error) => console.error('Desktop profile removal failed.', error));
    } catch (error) {
      console.error('Desktop profile removal rejected.', error);
    }
  });

  ipcMain.handle(IPC.storageFlush, async (event) => {
    trusted(event);
    await saveStore.flush();
    return true;
  });
}
