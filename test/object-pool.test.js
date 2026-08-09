import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OBJECT_POOL_EXHAUSTION,
  ObjectPool,
  createObjectPool,
} from '../src/render/objectPool.js';

test('pool lazily creates up to capacity and reuses released instances', () => {
  const resetItems = [];
  const pool = createObjectPool({
    capacity: 2,
    create: (index) => ({ id: index, dirty: true }),
    reset(item) {
      item.dirty = false;
      resetItems.push(item);
    },
  });

  const first = pool.acquire();
  const second = pool.acquire();
  assert.equal(first.id, 0);
  assert.equal(second.id, 1);
  assert.equal(pool.acquire(), null);
  assert.equal(pool.release(first), true);
  assert.equal(first.dirty, false);
  assert.equal(pool.release(first), false, 'duplicate releases are ignored safely');
  assert.equal(pool.acquire(), first);
  assert.deepEqual(resetItems, [first]);
  assert.deepEqual(pool.stats, {
    capacity: 2,
    exhaustion: 'drop',
    disposed: false,
    created: 2,
    acquired: 3,
    reused: 1,
    released: 1,
    active: 2,
    free: 0,
    highWaterMark: 2,
    dropped: 1,
  });
});

test('throw exhaustion policy reports dropped acquisitions without exceeding capacity', () => {
  const pool = new ObjectPool({
    capacity: 1,
    exhaustion: OBJECT_POOL_EXHAUSTION.THROW,
    create: () => ({}),
  });

  pool.acquire();
  assert.throws(() => pool.acquire(), /exhausted its capacity of 1/);
  assert.equal(pool.stats.created, 1);
  assert.equal(pool.stats.acquired, 1);
  assert.equal(pool.stats.dropped, 1);
});

test('pool validates ownership, factory output, and duplicate factory instances', () => {
  const firstPool = createObjectPool({ capacity: 1, create: () => ({}) });
  const secondPool = createObjectPool({ capacity: 1, create: () => ({}) });
  const firstItem = firstPool.acquire();
  const secondItem = secondPool.acquire();

  assert.equal(firstPool.owns(firstItem), true);
  assert.equal(firstPool.owns(secondItem), false);
  assert.throws(() => firstPool.release(secondItem), /not owned/);
  assert.throws(() => firstPool.release({}), /not owned/);

  const invalidPool = createObjectPool({ create: () => null });
  assert.throws(() => invalidPool.acquire(), /non-null object or function/);
  assert.equal(invalidPool.stats.created, 0);

  const shared = {};
  const duplicatePool = createObjectPool({ capacity: 2, create: () => shared });
  duplicatePool.acquire();
  assert.throws(() => duplicatePool.acquire(), /already owned/);
  assert.equal(duplicatePool.stats.created, 1);
});

test('releaseAll resets every active item and read-only snapshots cannot be mutated', () => {
  let resets = 0;
  const pool = createObjectPool({
    capacity: 4,
    create: () => ({}),
    reset: () => { resets += 1; },
  });
  pool.acquire();
  pool.acquire();
  pool.acquire();

  assert.equal(pool.releaseAll(), 3);
  assert.equal(resets, 3);
  assert.equal(pool.stats.active, 0);
  assert.equal(pool.stats.free, 3);
  assert.equal(pool.stats.released, 3);

  const snapshot = pool.snapshot();
  assert.equal(Object.isFrozen(snapshot), true);
  assert.throws(() => { snapshot.active = 99; }, TypeError);
  assert.notEqual(pool.stats, snapshot, 'each read returns a new point-in-time snapshot');
});

test('a reset failure keeps a singly released item active and out of the free list', () => {
  let resetShouldFail = true;
  const pool = createObjectPool({
    capacity: 1,
    create: () => ({}),
    reset() {
      if (resetShouldFail) throw new Error('reset failed');
    },
  });
  const item = pool.acquire();

  assert.throws(() => pool.release(item), /reset failed/);
  assert.equal(pool.stats.active, 1);
  assert.equal(pool.stats.free, 0);
  assert.equal(pool.stats.released, 0);

  resetShouldFail = false;
  assert.equal(pool.release(item), true);
  assert.equal(pool.stats.active, 0);
  assert.equal(pool.stats.free, 1);
  assert.equal(pool.stats.released, 1);
});

test('releaseAll aggregates reset failures while releasing every healthy item', () => {
  const failingIds = new Set([1]);
  const pool = createObjectPool({
    capacity: 3,
    create: (id) => ({ id }),
    reset(item) {
      if (failingIds.has(item.id)) throw new Error(`reset failed for ${item.id}`);
    },
  });
  const items = [pool.acquire(), pool.acquire(), pool.acquire()];

  let error;
  try {
    pool.releaseAll();
    assert.fail('releaseAll should throw when an item cannot be reset');
  } catch (caughtError) {
    error = caughtError;
  }
  assert.ok(error instanceof AggregateError);
  assert.equal(error.errors.length, 1);
  assert.match(error.errors[0].message, /reset failed for 1/);
  assert.equal(pool.stats.active, 1);
  assert.equal(pool.stats.free, 2);
  assert.equal(pool.stats.released, 2);
  assert.equal(pool.owns(items[1]), true);
  assert.equal(pool.release(items[0]), false);
  assert.equal(pool.release(items[2]), false);

  failingIds.clear();
  assert.equal(pool.releaseAll(), 1);
  assert.equal(pool.stats.active, 0);
  assert.equal(pool.stats.free, 3);
  assert.equal(pool.stats.released, 3);
});

test('dispose visits all owned items once, clears ownership, and is terminal', () => {
  const disposed = [];
  const pool = createObjectPool({
    capacity: 3,
    create: (id) => ({ id }),
    dispose: (item) => disposed.push(item.id),
  });
  const first = pool.acquire();
  const second = pool.acquire();
  pool.release(first);

  assert.equal(pool.dispose(), true);
  assert.deepEqual(disposed.sort(), [0, 1]);
  assert.equal(pool.owns(first), false);
  assert.equal(pool.owns(second), false);
  assert.equal(pool.stats.disposed, true);
  assert.equal(pool.stats.active, 0);
  assert.equal(pool.stats.free, 0);
  assert.equal(pool.dispose(), false);
  assert.throws(() => pool.acquire(), /has been disposed/);
  assert.throws(() => pool.release(second), /has been disposed/);
});

test('100,000 acquire/release cycles keep creation bounded and statistics exact', () => {
  const iterations = 100_000;
  const capacity = 32;
  let createCalls = 0;
  let resetCalls = 0;
  const pool = createObjectPool({
    capacity,
    create: () => ({ generation: createCalls++ }),
    reset: () => { resetCalls += 1; },
  });

  for (let index = 0; index < iterations; index += 1) {
    const item = pool.acquire();
    assert.notEqual(item, null);
    assert.equal(pool.release(item), true);
  }

  const stats = pool.stats;
  assert.equal(createCalls, 1);
  assert.ok(stats.created <= capacity);
  assert.equal(stats.created, 1);
  assert.equal(stats.acquired, iterations);
  assert.equal(stats.reused, iterations - 1);
  assert.equal(stats.released, iterations);
  assert.equal(stats.active, 0);
  assert.equal(stats.free, 1);
  assert.equal(stats.highWaterMark, 1);
  assert.equal(stats.dropped, 0);
  assert.equal(resetCalls, iterations);
});

test('constructor rejects invalid pool configuration', () => {
  assert.throws(() => createObjectPool({ capacity: 0, create: () => ({}) }), /positive safe integer/);
  assert.throws(() => createObjectPool({ capacity: 1 }), /create must be a function/);
  assert.throws(() => createObjectPool({ create: () => ({}), reset: null }), /reset must be a function/);
  assert.throws(() => createObjectPool({ create: () => ({}), dispose: null }), /dispose must be a function/);
  assert.throws(() => createObjectPool({ create: () => ({}), exhaustion: 'grow' }), /exhaustion must be/);
});
