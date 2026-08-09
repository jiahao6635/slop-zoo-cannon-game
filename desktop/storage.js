import { createHash, randomBytes } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

export const DESKTOP_SAVE_FORMAT = 'slop-zoo-cannon-desktop-profile';
export const DESKTOP_SAVE_VERSION = 1;
export const DESKTOP_BACKUP_COUNT = 3;
export const MAX_STORAGE_VALUE_BYTES = 8 * 1024 * 1024;
export const MAX_PROFILE_BYTES = 16 * 1024 * 1024;

export const ALLOWED_STORAGE_KEYS = Object.freeze([
  'slop-zoo-cannon.save',
  'slop-zoo-cannon.save.backup.0',
  'slop-zoo-cannon.save.backup.1',
  'slop-zoo-cannon.save.backup.2',
  'slop-zoo-cannon-best',
  'slop-zoo-cannon-settings',
]);

const ALLOWED_STORAGE_KEY_SET = new Set(ALLOWED_STORAGE_KEYS);

export class DesktopStorageError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'DesktopStorageError';
  }
}

export class UnsupportedDesktopStorageVersionError extends DesktopStorageError {
  constructor(version) {
    super(`Desktop profile version ${version} is newer than supported version ${DESKTOP_SAVE_VERSION}.`);
    this.name = 'UnsupportedDesktopStorageVersionError';
    this.version = version;
  }
}

export function getDesktopSavePaths(rootDirectory) {
  return Object.freeze({
    primary: join(rootDirectory, 'profile.json'),
    backups: Object.freeze(Array.from(
      { length: DESKTOP_BACKUP_COUNT },
      (_, index) => join(rootDirectory, `profile.backup-${index + 1}.json`),
    )),
    lastGoodExit: join(rootDirectory, 'profile.last-good-exit.json'),
  });
}

export function assertAllowedStorageKey(key) {
  if (typeof key !== 'string' || !ALLOWED_STORAGE_KEY_SET.has(key)) {
    throw new DesktopStorageError('The requested storage key is not allowed.');
  }
  return key;
}

export function assertStorageValue(value) {
  if (typeof value !== 'string') {
    throw new DesktopStorageError('Desktop storage values must be strings.');
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_STORAGE_VALUE_BYTES) {
    throw new DesktopStorageError('The requested storage value is too large.');
  }
  return value;
}

/**
 * Durable, serialized key/value storage for the desktop wrapper.
 *
 * Every mutation is committed with a same-directory temporary file and rename.
 * The previous three complete profiles are retained independently from the
 * save-system's logical backups, so a partially written or corrupt profile can
 * be recovered before the renderer starts.
 */
export class DesktopSaveStore {
  #directory;
  #paths;
  #values = new Map();
  #revision = 0;
  #initialized = false;
  #dirty = false;
  #tail = Promise.resolve();
  #now;
  #recovery = null;

  constructor(directory, options = {}) {
    if (typeof directory !== 'string' || directory.length === 0) {
      throw new DesktopStorageError('A desktop storage directory is required.');
    }
    this.#directory = directory;
    this.#paths = getDesktopSavePaths(directory);
    this.#now = typeof options.now === 'function' ? options.now : () => new Date();
  }

  get recovery() {
    return this.#recovery;
  }

  async initialize() {
    if (this.#initialized) return this.recovery;
    await mkdir(this.#directory, { recursive: true });

    const candidates = [
      ['primary', this.#paths.primary],
      ...this.#paths.backups.map((path, index) => [`backup-${index + 1}`, path]),
      ['last-good-exit', this.#paths.lastGoodExit],
    ];

    let loaded = null;
    for (const [source, path] of candidates) {
      try {
        const decoded = await readSnapshot(path);
        if (!decoded) continue;
        loaded = { source, decoded };
        break;
      } catch (error) {
        if (error instanceof UnsupportedDesktopStorageVersionError) throw error;
        if (!(error instanceof DesktopStorageError)) throw error;
        // Corrupt snapshots are skipped. A later valid backup may recover them.
      }
    }

    if (loaded) {
      this.#values = new Map(Object.entries(loaded.decoded.values));
      this.#revision = loaded.decoded.revision;
      this.#recovery = loaded.source === 'primary'
        ? null
        : Object.freeze({ source: loaded.source, revision: loaded.decoded.revision });
    }

    this.#initialized = true;

    if (this.#recovery) {
      this.#dirty = true;
      await this.#persist({ rotate: false });
    }

    return this.recovery;
  }

  async getItem(key) {
    assertAllowedStorageKey(key);
    return this.#enqueue(async () => {
      this.#assertInitialized();
      return this.#values.get(key) ?? null;
    });
  }

  async setItem(key, value) {
    assertAllowedStorageKey(key);
    assertStorageValue(value);
    return this.#enqueue(async () => {
      this.#assertInitialized();
      if (this.#values.get(key) === value) return;
      const hadPrevious = this.#values.has(key);
      const previous = this.#values.get(key);
      this.#values.set(key, value);
      this.#dirty = true;
      try {
        await this.#persist();
      } catch (error) {
        if (hadPrevious) this.#values.set(key, previous);
        else this.#values.delete(key);
        this.#dirty = false;
        throw error;
      }
    });
  }

  async removeItem(key) {
    assertAllowedStorageKey(key);
    return this.#enqueue(async () => {
      this.#assertInitialized();
      if (!this.#values.has(key)) return;
      const previous = this.#values.get(key);
      this.#values.delete(key);
      this.#dirty = true;
      try {
        await this.#persist();
      } catch (error) {
        this.#values.set(key, previous);
        this.#dirty = false;
        throw error;
      }
    });
  }

  async flush(options = {}) {
    return this.#enqueue(async () => {
      this.#assertInitialized();
      if (this.#dirty || !(await fileExists(this.#paths.primary))) {
        await this.#persist();
      }
      if (options.markLastGoodExit) {
        const primary = await readFile(this.#paths.primary);
        await atomicWrite(this.#paths.lastGoodExit, primary);
      }
    });
  }

  #enqueue(operation) {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.catch(() => {});
    return result;
  }

  #assertInitialized() {
    if (!this.#initialized) {
      throw new DesktopStorageError('Desktop storage has not been initialized.');
    }
  }

  async #persist(options = {}) {
    const rotate = options.rotate !== false;
    const nextRevision = this.#revision + 1;
    const raw = encodeSnapshot(this.#values, nextRevision, this.#now());

    if (rotate) {
      const currentPrimary = await readValidSnapshotRaw(this.#paths.primary);
      if (currentPrimary) await rotateBackups(this.#paths, currentPrimary);
    }

    await atomicWrite(this.#paths.primary, raw);
    this.#revision = nextRevision;
    this.#dirty = false;
  }
}

function encodeSnapshot(values, revision, now) {
  const normalizedValues = Object.fromEntries(
    [...values.entries()]
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([key, value]) => [assertAllowedStorageKey(key), assertStorageValue(value)]),
  );
  const payload = {
    revision,
    savedAt: normalizeTimestamp(now),
    values: normalizedValues,
  };
  const serializedPayload = JSON.stringify(payload);
  const raw = `${JSON.stringify({
    format: DESKTOP_SAVE_FORMAT,
    version: DESKTOP_SAVE_VERSION,
    checksum: digest(serializedPayload),
    payload,
  }, null, 2)}\n`;

  if (Buffer.byteLength(raw, 'utf8') > MAX_PROFILE_BYTES) {
    throw new DesktopStorageError('The desktop profile exceeds its size limit.');
  }
  return raw;
}

async function readSnapshot(path) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }

  if (Buffer.byteLength(raw, 'utf8') > MAX_PROFILE_BYTES) {
    throw new DesktopStorageError('Desktop profile is too large.');
  }

  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch (error) {
    throw new DesktopStorageError('Desktop profile is not valid JSON.', { cause: error });
  }

  if (envelope?.format === DESKTOP_SAVE_FORMAT && envelope?.version > DESKTOP_SAVE_VERSION) {
    throw new UnsupportedDesktopStorageVersionError(envelope.version);
  }
  if (
    envelope?.format !== DESKTOP_SAVE_FORMAT
    || envelope?.version !== DESKTOP_SAVE_VERSION
    || !isPlainObject(envelope.payload)
  ) {
    throw new DesktopStorageError('Desktop profile format is not supported.');
  }

  const serializedPayload = JSON.stringify(envelope.payload);
  if (envelope.checksum !== digest(serializedPayload)) {
    throw new DesktopStorageError('Desktop profile checksum does not match.');
  }

  const revision = Number(envelope.payload.revision);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new DesktopStorageError('Desktop profile revision is invalid.');
  }
  if (!isPlainObject(envelope.payload.values)) {
    throw new DesktopStorageError('Desktop profile values are invalid.');
  }

  const values = {};
  for (const [key, value] of Object.entries(envelope.payload.values)) {
    values[assertAllowedStorageKey(key)] = assertStorageValue(value);
  }
  return { revision, values };
}

async function readValidSnapshotRaw(path) {
  try {
    const decoded = await readSnapshot(path);
    return decoded ? readFile(path) : null;
  } catch {
    return null;
  }
}

async function rotateBackups(paths, currentPrimary) {
  for (let index = paths.backups.length - 1; index > 0; index -= 1) {
    const source = await readValidSnapshotRaw(paths.backups[index - 1]);
    if (source) await atomicWrite(paths.backups[index], source);
  }
  await atomicWrite(paths.backups[0], currentPrimary);
}

async function atomicWrite(targetPath, contents) {
  const temporaryPath = join(
    dirname(targetPath),
    `.${basename(targetPath)}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`,
  );
  let handle;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(contents, typeof contents === 'string' ? 'utf8' : undefined);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporaryPath, targetPath);
  } finally {
    await handle?.close().catch(() => {});
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function fileExists(path) {
  try {
    await open(path, 'r').then((handle) => handle.close());
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function normalizeTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
