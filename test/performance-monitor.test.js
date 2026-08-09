import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PERFORMANCE_BUDGETS,
  PerformanceMonitor,
  createPerformanceMonitor,
} from '../src/render/performanceMonitor.js';

function rendererInfo({
  calls = 0,
  triangles = 0,
  points = 0,
  lines = 0,
  geometries = 0,
  textures = 0,
} = {}) {
  return {
    render: { calls, triangles, points, lines },
    memory: { geometries, textures },
  };
}

function closeTo(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be close to ${expected}`);
}

test('computes deterministic rolling FPS, frame-time percentiles, and renderer peaks', () => {
  const monitor = createPerformanceMonitor({
    warmupSeconds: 0,
    windowSeconds: 10,
    sampleIntervalSeconds: 10,
    budgets: false,
  });

  for (let index = 0; index < 99; index += 1) {
    monitor.recordFrame(0.01, rendererInfo({
      calls: 10 + index,
      triangles: 10_000 + index,
      points: index,
      lines: index * 2,
      geometries: 20,
      textures: 8,
    }), { animals: 3, projectiles: 2 });
  }
  monitor.recordFrame(0.1, rendererInfo({
    calls: 25,
    triangles: 20_000,
    geometries: 40,
    textures: 15,
  }), { animals: 4, projectiles: 9 });

  const snapshot = monitor.snapshot();
  closeTo(snapshot.fps.average, 100 / 1.09);
  closeTo(snapshot.fps.onePercentLow, 10);
  closeTo(snapshot.frameTimeMs.average, 10.9);
  closeTo(snapshot.frameTimeMs.p95, 10);
  closeTo(snapshot.frameTimeMs.max, 100);
  assert.deepEqual(snapshot.render.peak, {
    calls: 108,
    triangles: 20_000,
    points: 98,
    lines: 196,
  });
  assert.deepEqual(snapshot.memory.peak, { geometries: 40, textures: 15 });
  assert.deepEqual(snapshot.entities.current, {
    counts: { animals: 4, projectiles: 9 },
    total: 13,
  });
  assert.deepEqual(snapshot.entities.peak, {
    counts: { animals: 4, projectiles: 9 },
    total: 13,
  });
  assert.equal(snapshot.window.frameCount, 100);
  assert.equal(snapshot.totalFrameCount, 100);
});

test('warmup ignores whole frames and sampling uses accumulated game time', () => {
  const monitor = new PerformanceMonitor({
    warmupSeconds: 1,
    windowSeconds: 5,
    sampleIntervalSeconds: 0.5,
    budgets: false,
  });

  assert.equal(monitor.recordFrame(0.6, rendererInfo({ calls: 999 })), null);
  assert.equal(monitor.recordFrame(0.5, rendererInfo({ calls: 999 })), null);
  assert.equal(monitor.snapshot().window.frameCount, 0);

  assert.equal(monitor.recordFrame(0.25, rendererInfo({ calls: 4 })), null);
  const sampled = monitor.recordFrame({
    deltaSeconds: 0.25,
    rendererInfo: rendererInfo({ calls: 5, geometries: 2 }),
    activeEntities: { targets: 7, total: 10 },
  });

  assert.ok(sampled);
  assert.equal(sampled.status, 'collecting');
  assert.equal(sampled.samplesTaken, 1);
  assert.equal(sampled.window.frameCount, 2);
  assert.equal(sampled.render.current.calls, 5);
  assert.deepEqual(sampled.entities.current, { counts: { targets: 7 }, total: 10 });
});

test('rolling window evicts old spikes and retains only current-window peaks', () => {
  const monitor = createPerformanceMonitor({
    warmupSeconds: 0,
    windowSeconds: 2,
    sampleIntervalSeconds: 10,
    budgets: false,
  });

  monitor.recordFrame(1, rendererInfo({ calls: 500, triangles: 900_000, textures: 99 }), 100);
  monitor.recordFrame(1, rendererInfo({ calls: 20, triangles: 20_000, textures: 8 }), 5);
  monitor.recordFrame(1, rendererInfo({ calls: 30, triangles: 30_000, textures: 9 }), 7);

  const snapshot = monitor.snapshot();
  assert.equal(snapshot.window.frameCount, 2);
  assert.equal(snapshot.fps.average, 1);
  assert.equal(snapshot.render.peak.calls, 30);
  assert.equal(snapshot.render.peak.triangles, 30_000);
  assert.equal(snapshot.memory.peak.textures, 9);
  assert.equal(snapshot.entities.peak.total, 7);
});

test('budget alerts debounce and emit only on exceeded/recovered crossings', () => {
  const callbackEvents = [];
  const monitor = createPerformanceMonitor({
    warmupSeconds: 0,
    windowSeconds: 1,
    sampleIntervalSeconds: 1,
    alertDebounceSamples: 2,
    budgets: { drawCalls: 10 },
    onAlert: (event) => callbackEvents.push(event),
  });

  monitor.recordFrame(1, rendererInfo({ calls: 8 }));
  let sampled = monitor.recordFrame(1, rendererInfo({ calls: 11 }));
  assert.equal(sampled.budgetStatus.drawCalls.state, 'pending');
  assert.deepEqual(callbackEvents, []);

  sampled = monitor.recordFrame(1, rendererInfo({ calls: 12 }));
  assert.equal(sampled.budgetStatus.drawCalls.state, 'exceeded');
  monitor.recordFrame(1, rendererInfo({ calls: 13 }));
  monitor.recordFrame(1, rendererInfo({ calls: 9 }));
  assert.equal(callbackEvents.length, 1);

  sampled = monitor.recordFrame(1, rendererInfo({ calls: 8 }));
  assert.equal(sampled.budgetStatus.drawCalls.state, 'ok');
  monitor.recordFrame(1, rendererInfo({ calls: 7 }));

  assert.deepEqual(callbackEvents.map(({ type, metric, state }) => ({ type, metric, state })), [
    { type: 'budget-exceeded', metric: 'drawCalls', state: 'exceeded' },
    { type: 'budget-recovered', metric: 'drawCalls', state: 'recovered' },
  ]);
  assert.equal(callbackEvents[0].sample, 3);
  assert.equal(callbackEvents[1].sample, 6);
  assert.deepEqual(monitor.drainAlerts().map((event) => event.type), [
    'budget-exceeded',
    'budget-recovered',
  ]);
  assert.deepEqual(monitor.drainAlerts(), []);
});

test('reset clears statistics and alert crossings but preserves configuration', () => {
  const monitor = createPerformanceMonitor({
    warmupSeconds: 0,
    sampleIntervalSeconds: 0,
    alertDebounceSamples: 1,
    budgets: { avgFps: { min: 50 } },
  });

  monitor.recordFrame(0.1, rendererInfo());
  assert.equal(monitor.drainAlerts().length, 1);
  const resetSnapshot = monitor.reset();

  assert.equal(resetSnapshot.totalFrameCount, 0);
  assert.equal(resetSnapshot.samplesTaken, 0);
  assert.equal(resetSnapshot.window.frameCount, 0);
  assert.equal(resetSnapshot.budgetStatus.avgFps.state, 'insufficient-data');
  assert.equal(monitor.warmupSeconds, 0);
  assert.deepEqual(monitor.drainAlerts(), []);

  monitor.recordFrame(0.1, rendererInfo());
  assert.equal(monitor.drainAlerts()[0].type, 'budget-exceeded');
});

test('two-hour equivalent simulation stays deterministic and window-bounded', () => {
  const monitor = createPerformanceMonitor({
    warmupSeconds: 0,
    windowSeconds: 10,
    sampleIntervalSeconds: 60,
    budgets: false,
  });
  const framesPerSecond = 60;
  const simulatedSeconds = 2 * 60 * 60;
  const totalFrames = framesPerSecond * simulatedSeconds;

  for (let frame = 0; frame < totalFrames; frame += 1) {
    monitor.recordFrame(1 / framesPerSecond, rendererInfo({
      calls: 40 + (frame % 5),
      triangles: 100_000 + (frame % 1_000),
      geometries: 80,
      textures: 32,
    }), { animals: 12, projectiles: frame % 20, particles: frame % 100 });
  }

  const snapshot = monitor.snapshot();
  closeTo(snapshot.elapsedSeconds, simulatedSeconds, 1e-7);
  closeTo(snapshot.fps.average, 60, 1e-9);
  closeTo(snapshot.fps.onePercentLow, 60, 1e-9);
  assert.ok(snapshot.window.frameCount >= 599 && snapshot.window.frameCount <= 601);
  assert.equal(snapshot.totalFrameCount, totalFrames);
  assert.equal(snapshot.samplesTaken, 120);
  assert.equal(snapshot.render.peak.calls, 44);
  assert.equal(snapshot.memory.peak.textures, 32);
  assert.equal(snapshot.entities.peak.total, 130);
});

test('validates configuration and exports immutable recommended budgets', () => {
  assert.equal(Object.isFrozen(DEFAULT_PERFORMANCE_BUDGETS), true);
  assert.equal(Object.isFrozen(DEFAULT_PERFORMANCE_BUDGETS.avgFps), true);
  assert.throws(() => createPerformanceMonitor({ windowSeconds: 0 }), /windowSeconds/);
  assert.throws(() => createPerformanceMonitor({ alertDebounceSamples: 0 }), /alertDebounceSamples/);
  assert.throws(() => createPerformanceMonitor({ budgets: { typo: 1 } }), /Unknown/);
  assert.throws(() => createPerformanceMonitor({ budgets: { drawCalls: { max: -1 } } }), /drawCalls/);

  const monitor = createPerformanceMonitor({ warmupSeconds: 0, budgets: false });
  assert.throws(() => monitor.recordFrame(0), /deltaSeconds/);
  assert.throws(() => monitor.recordFrame(Number.NaN), /deltaSeconds/);
});
