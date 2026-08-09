import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

import {
  ALLOWED_STORAGE_KEYS,
  DesktopSaveStore,
  DESKTOP_SAVE_FORMAT,
  UnsupportedDesktopStorageVersionError,
  getDesktopSavePaths,
} from '../desktop/storage.js';
import {
  createSecureWebPreferences,
  isAllowedExternalUrl,
  isTrustedRendererUrl,
  resolveDevelopmentUrl,
} from '../desktop/windowPolicy.js';
import {
  PLATFORM_STORAGE_KEYS,
  createPlatformFacade,
  initializePlatform,
} from '../src/platform/index.js';

test('desktop window policy locks renderer privileges and external navigation', () => {
  const preferences = createSecureWebPreferences('/safe/preload.cjs', false);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.nodeIntegrationInWorker, false);
  assert.equal(preferences.nodeIntegrationInSubFrames, false);
  assert.equal(preferences.webviewTag, false);
  assert.equal(preferences.webSecurity, true);
  assert.equal(preferences.allowRunningInsecureContent, false);
  assert.equal(preferences.devTools, false);
  assert.equal(Object.isFrozen(preferences), true);

  assert.equal(isAllowedExternalUrl('https://github.com/jiahao6635/slop-zoo-cannon-game'), true);
  assert.equal(isAllowedExternalUrl('https://store.steampowered.com/app/123'), true);
  assert.equal(isAllowedExternalUrl('https://github.com.evil.example/phish'), false);
  assert.equal(isAllowedExternalUrl('http://github.com/jiahao6635'), false);
  assert.equal(isAllowedExternalUrl('file:///etc/passwd'), false);
  assert.equal(resolveDevelopmentUrl('http://127.0.0.1:5173/'), 'http://127.0.0.1:5173/');
  assert.throws(() => resolveDevelopmentUrl('https://example.com/'));

  const productionUrl = 'file:///opt/slop-zoo/dist/index.html';
  assert.equal(isTrustedRendererUrl(productionUrl, { productionUrl }), true);
  assert.equal(isTrustedRendererUrl('file:///tmp/index.html', { productionUrl }), false);
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:5173/src/main.js', {
    development: true,
    developmentUrl: 'http://127.0.0.1:5173/',
  }), true);
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:5174/', {
    development: true,
    developmentUrl: 'http://127.0.0.1:5173/',
  }), false);
});

test('content security policy permits Meshopt WebAssembly without general eval', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const policy = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1];
  assert.ok(policy, 'index.html should define a Content Security Policy');
  const scriptDirective = policy
    .split(';')
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith('script-src'));
  assert.deepEqual(scriptDirective?.split(/\s+/), [
    'script-src',
    "'self'",
    "'wasm-unsafe-eval'",
  ]);
});

test('preload exposes only a deeply frozen, asynchronous minimum API', async () => {
  const preloadSource = await readFile(new URL('../desktop/preload.cjs', import.meta.url), 'utf8');
  const calls = [];
  let exposedName = null;
  let exposedApi = null;

  runInNewContext(preloadSource, {
    require(identifier) {
      assert.equal(identifier, 'electron');
      return {
        contextBridge: {
          exposeInMainWorld(name, value) {
            exposedName = name;
            exposedApi = value;
          },
        },
        ipcRenderer: {
          send(channel, ...arguments_) {
            calls.push([channel, ...arguments_]);
          },
          async invoke(channel, ...arguments_) {
            calls.push([channel, ...arguments_]);
            if (channel.endsWith('capabilities')) return { steam: { available: false } };
            if (channel.endsWith('app-info')) return { name: 'test' };
            if (channel.endsWith('read')) return 'value';
            return true;
          },
        },
      };
    },
  }, { filename: 'desktop/preload.cjs' });

  assert.equal(exposedName, 'slopZooDesktop');
  assert.deepEqual(Object.keys(exposedApi), ['apiVersion', 'capabilities', 'app', 'storage']);
  assert.equal(Object.isFrozen(exposedApi), true);
  assert.equal(Object.isFrozen(exposedApi.capabilities), true);
  assert.equal(Object.isFrozen(exposedApi.app), true);
  assert.equal(Object.isFrozen(exposedApi.storage), true);
  assert.equal(Object.isFrozen(exposedApi.capabilities.get), true);
  assert.equal(Object.isFrozen(exposedApi.storage.write), true);
  assert.equal('ipcRenderer' in exposedApi, false);
  assert.equal('fs' in exposedApi, false);
  assert.equal('path' in exposedApi, false);

  const capabilities = await exposedApi.capabilities.get();
  assert.equal(Object.isFrozen(capabilities), true);
  assert.equal(Object.isFrozen(capabilities.steam), true);
  assert.deepEqual(await exposedApi.app.getInfo(), { name: 'test' });
  assert.equal(await exposedApi.storage.read(ALLOWED_STORAGE_KEYS[0]), 'value');
  assert.equal(await exposedApi.storage.write(ALLOWED_STORAGE_KEYS[0], 'next'), true);
  assert.equal(await exposedApi.storage.remove(ALLOWED_STORAGE_KEYS[0]), true);
  assert.equal(await exposedApi.storage.flush(), true);
  assert.deepEqual(calls.map(([channel]) => channel), [
    'slop-zoo:platform:capabilities',
    'slop-zoo:platform:app-info',
    'slop-zoo:storage:read',
    'slop-zoo:storage:write',
    'slop-zoo:storage:remove',
    'slop-zoo:storage:flush',
  ]);
});

test('desktop mirror dispatches every mutation before the first write resolves', async () => {
  class TestStorage {
    #values = new Map();

    getItem(key) { return this.#values.get(String(key)) ?? null; }

    setItem(key, value) { this.#values.set(String(key), String(value)); }

    removeItem(key) { this.#values.delete(String(key)); }

    clear() { this.#values.clear(); }
  }

  const writes = [];
  const pendingResolvers = [];
  const host = {
    navigator: { language: 'zh-CN' },
    localStorage: new TestStorage(),
    addEventListener() {},
    document: { addEventListener() {}, visibilityState: 'visible' },
    slopZooDesktop: {
      apiVersion: 1,
      capabilities: { get: async () => ({ desktop: true }) },
      app: { getInfo: async () => ({ name: 'test' }) },
      storage: {
        read: async () => null,
        write(key, value) {
          writes.push([key, value]);
          return new Promise((resolve) => pendingResolvers.push(resolve));
        },
        remove: async () => true,
        flush: async () => true,
      },
    },
  };
  await initializePlatform(host);

  const keys = PLATFORM_STORAGE_KEYS.slice(0, 4);
  keys.forEach((key, index) => host.localStorage.setItem(key, `value-${index}`));

  assert.deepEqual(writes, keys.map((key, index) => [key, `value-${index}`]));
  pendingResolvers.forEach((resolve) => resolve(true));
});

test('platform facade safely falls back in browsers and restricts storage keys', async () => {
  assert.deepEqual(PLATFORM_STORAGE_KEYS, ALLOWED_STORAGE_KEYS);
  const values = new Map();
  const host = {
    navigator: { language: 'zh-CN' },
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    },
  };
  const platform = createPlatformFacade(host);
  const key = PLATFORM_STORAGE_KEYS[0];

  assert.equal(platform.environment, 'browser');
  assert.equal(Object.isFrozen(platform), true);
  assert.equal((await platform.capabilities.get()).steam.mode, 'local-mock');
  await platform.storage.write(key, 'browser-save');
  assert.equal(await platform.storage.read(key), 'browser-save');
  await platform.storage.remove(key);
  assert.equal(await platform.storage.read(key), null);
  await assert.rejects(() => platform.storage.read('arbitrary-key'), /not allowed/);
});

test('desktop profile survives 1000 atomic writes and restores a corrupt primary', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'slop-zoo-desktop-stress-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  let timestamp = Date.parse('2026-08-09T00:00:00.000Z');
  const now = () => new Date(timestamp++);
  const key = ALLOWED_STORAGE_KEYS[0];
  const store = new DesktopSaveStore(directory, { now });
  await store.initialize();

  for (let index = 0; index < 1000; index += 1) {
    await store.setItem(key, JSON.stringify({ index, payload: `save-${index}` }));
  }
  await store.flush();
  assert.equal(JSON.parse(await store.getItem(key)).index, 999);

  const paths = getDesktopSavePaths(directory);
  await writeFile(paths.primary, '{"corrupt":true}\n', 'utf8');

  const recovered = new DesktopSaveStore(directory, { now });
  assert.deepEqual(await recovered.initialize(), { source: 'backup-1', revision: 999 });
  assert.equal(JSON.parse(await recovered.getItem(key)).index, 998);

  const leftovers = (await readdir(directory)).filter((name) => name.includes('.tmp-'));
  assert.deepEqual(leftovers, []);
});

test('last-good-exit profile recovers when primary and rotating backups are corrupt', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'slop-zoo-desktop-exit-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const key = ALLOWED_STORAGE_KEYS[0];
  const store = new DesktopSaveStore(directory);
  await store.initialize();
  await store.setItem(key, 'confirmed-good');
  await store.flush({ markLastGoodExit: true });
  await store.setItem(key, 'newer-unconfirmed');

  const paths = getDesktopSavePaths(directory);
  await Promise.all([
    writeFile(paths.primary, 'broken', 'utf8'),
    ...paths.backups.map((path) => writeFile(path, 'broken', 'utf8')),
  ]);

  const recovered = new DesktopSaveStore(directory);
  assert.deepEqual(await recovered.initialize(), { source: 'last-good-exit', revision: 1 });
  assert.equal(await recovered.getItem(key), 'confirmed-good');
});

test('a newer desktop profile version is never silently overwritten', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'slop-zoo-desktop-future-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const paths = getDesktopSavePaths(directory);
  await writeFile(paths.primary, JSON.stringify({
    format: DESKTOP_SAVE_FORMAT,
    version: 999,
    checksum: 'future',
    payload: {},
  }), 'utf8');

  const store = new DesktopSaveStore(directory);
  await assert.rejects(
    () => store.initialize(),
    (error) => error instanceof UnsupportedDesktopStorageVersionError && error.version === 999,
  );
});
