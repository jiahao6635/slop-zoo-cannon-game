const DEFAULT_CAPACITY = 64;
const NOOP = () => {};

export const OBJECT_POOL_EXHAUSTION = Object.freeze({
  DROP: 'drop',
  THROW: 'throw',
});

function isObject(value) {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function assertFunction(value, name) {
  if (typeof value !== 'function') {
    throw new TypeError(`ObjectPool ${name} must be a function`);
  }
}

/**
 * A small, renderer-agnostic pool for reusable object instances.
 *
 * Instances are created lazily up to `capacity`. Releasing an active instance
 * runs the reset hook before making it available for reuse. When the pool is
 * exhausted, `acquire()` either returns null (`drop`) or throws (`throw`).
 */
export class ObjectPool {
  #capacity;
  #create;
  #reset;
  #disposeItem;
  #exhaustion;
  #owned = new Set();
  #active = new Set();
  #free = [];
  #disposed = false;
  #created = 0;
  #acquired = 0;
  #reused = 0;
  #released = 0;
  #highWaterMark = 0;
  #dropped = 0;

  constructor({
    capacity = DEFAULT_CAPACITY,
    create,
    reset = NOOP,
    dispose = NOOP,
    exhaustion = OBJECT_POOL_EXHAUSTION.DROP,
  } = {}) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new RangeError('ObjectPool capacity must be a positive safe integer');
    }
    assertFunction(create, 'create');
    assertFunction(reset, 'reset');
    assertFunction(dispose, 'dispose');
    if (!Object.values(OBJECT_POOL_EXHAUSTION).includes(exhaustion)) {
      throw new RangeError(`ObjectPool exhaustion must be "${OBJECT_POOL_EXHAUSTION.DROP}" or "${OBJECT_POOL_EXHAUSTION.THROW}"`);
    }

    this.#capacity = capacity;
    this.#create = create;
    this.#reset = reset;
    this.#disposeItem = dispose;
    this.#exhaustion = exhaustion;
  }

  get capacity() {
    return this.#capacity;
  }

  get stats() {
    return this.snapshot();
  }

  acquire() {
    this.#assertUsable();

    let item;
    if (this.#free.length > 0) {
      item = this.#free.pop();
      this.#reused += 1;
    } else if (this.#created < this.#capacity) {
      item = this.#create(this.#created);
      if (!isObject(item)) {
        throw new TypeError('ObjectPool create must return a non-null object or function');
      }
      if (this.#owned.has(item)) {
        throw new TypeError('ObjectPool create returned an instance already owned by this pool');
      }
      this.#owned.add(item);
      this.#created += 1;
    } else {
      this.#dropped += 1;
      if (this.#exhaustion === OBJECT_POOL_EXHAUSTION.THROW) {
        throw new RangeError(`ObjectPool exhausted its capacity of ${this.#capacity}`);
      }
      return null;
    }

    this.#active.add(item);
    this.#acquired += 1;
    this.#highWaterMark = Math.max(this.#highWaterMark, this.#active.size);
    return item;
  }

  release(item) {
    this.#assertUsable();
    if (!this.#owned.has(item)) {
      throw new TypeError('Cannot release an instance not owned by this ObjectPool');
    }
    if (!this.#active.has(item)) {
      return false;
    }

    // Keep the item active if reset fails so a broken object is never reused.
    this.#reset(item);
    this.#active.delete(item);
    this.#free.push(item);
    this.#released += 1;
    return true;
  }

  releaseAll() {
    this.#assertUsable();
    const errors = [];
    let released = 0;

    for (const item of [...this.#active]) {
      try {
        if (this.release(item)) released += 1;
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, `ObjectPool failed to reset ${errors.length} active instance(s)`);
    }
    return released;
  }

  owns(item) {
    return this.#owned.has(item);
  }

  snapshot() {
    return Object.freeze({
      capacity: this.#capacity,
      exhaustion: this.#exhaustion,
      disposed: this.#disposed,
      created: this.#created,
      acquired: this.#acquired,
      reused: this.#reused,
      released: this.#released,
      active: this.#active.size,
      free: this.#free.length,
      highWaterMark: this.#highWaterMark,
      dropped: this.#dropped,
    });
  }

  dispose() {
    if (this.#disposed) return false;
    this.#disposed = true;

    const items = [...this.#owned];
    this.#active.clear();
    this.#free.length = 0;
    this.#owned.clear();

    const errors = [];
    for (const item of items) {
      try {
        this.#disposeItem(item);
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, `ObjectPool failed to dispose ${errors.length} instance(s)`);
    }
    return true;
  }

  #assertUsable() {
    if (this.#disposed) {
      throw new Error('ObjectPool has been disposed');
    }
  }
}

export function createObjectPool(options) {
  return new ObjectPool(options);
}
