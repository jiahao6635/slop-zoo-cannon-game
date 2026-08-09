import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_DYNAMIC_RESOLUTION_QUALITY_PRESETS,
  DynamicResolutionController,
  createDynamicResolutionController,
} from '../src/render/dynamicResolution.js';

const SLOW = Object.freeze({
  avgFps: 48,
  onePercentLowFps: 34,
  frameP95Ms: 27,
});

const HEALTHY = Object.freeze({
  avgFps: 60,
  onePercentLowFps: 56,
  frameP95Ms: 17,
});

const NEUTRAL = Object.freeze({
  avgFps: 56,
  onePercentLowFps: 47,
  frameP95Ms: 20,
});

test('requires consecutive slow samples before reducing render scale by one step', () => {
  const controller = createDynamicResolutionController({
    qualityPreset: 'quality',
    cooldownSamples: 0,
  });

  let decision = controller.recordSample({ ...SLOW, renderScale: 1.2 });
  assert.equal(decision.changed, false);
  assert.equal(decision.reason, 'down-pending');
  assert.deepEqual(decision.streaks, { down: 1, up: 0 });

  decision = controller.recordSample({ ...SLOW, renderScale: 1.2 });
  assert.equal(decision.changed, true);
  assert.equal(decision.direction, 'down');
  assert.equal(decision.reason, 'performance-low');
  assert.equal(decision.renderScale, 1.1);
  assert.deepEqual(decision.streaks, { down: 0, up: 0 });
});

test('uses asymmetric recovery streaks and cooldown to prevent rapid oscillation', () => {
  const controller = createDynamicResolutionController({
    qualityPreset: 'quality',
    downSamples: 1,
    upSamples: 3,
    cooldownSamples: 2,
  });

  let decision = controller.sample({ ...SLOW, renderScale: 1 });
  assert.equal(decision.renderScale, 0.9);
  assert.equal(decision.cooldownRemaining, 2);

  decision = controller.sample({ ...HEALTHY, renderScale: 0.9 });
  assert.equal(decision.reason, 'cooldown');
  assert.equal(decision.cooldownRemaining, 1);
  decision = controller.sample({ ...HEALTHY, renderScale: 0.9 });
  assert.equal(decision.reason, 'cooldown');
  assert.equal(decision.cooldownRemaining, 0);

  decision = controller.sample({ ...HEALTHY, renderScale: 0.9 });
  assert.equal(decision.reason, 'up-pending');
  decision = controller.sample({ ...HEALTHY, renderScale: 0.9 });
  assert.equal(decision.reason, 'up-pending');
  decision = controller.sample({ ...HEALTHY, renderScale: 0.9 });
  assert.equal(decision.reason, 'performance-headroom');
  assert.equal(decision.renderScale, 0.95);

  const jitterController = createDynamicResolutionController({
    qualityPreset: 'quality',
    downSamples: 2,
    upSamples: 3,
    cooldownSamples: 0,
  });
  for (let index = 0; index < 20; index += 1) {
    const metrics = index % 2 === 0 ? SLOW : HEALTHY;
    decision = jitterController.sample({ ...metrics, renderScale: 0.95 });
    assert.equal(decision.changed, false);
  }
});

test('hysteresis neutral zone resets pending streaks', () => {
  const controller = new DynamicResolutionController({
    qualityPreset: 'quality',
    downSamples: 2,
    upSamples: 2,
    cooldownSamples: 0,
  });

  assert.equal(controller.sample({ ...SLOW, renderScale: 1 }).reason, 'down-pending');
  let decision = controller.sample({ ...NEUTRAL, renderScale: 1 });
  assert.equal(decision.reason, 'hysteresis');
  assert.deepEqual(decision.streaks, { down: 0, up: 0 });
  assert.equal(controller.sample({ ...SLOW, renderScale: 1 }).reason, 'down-pending');

  assert.equal(controller.sample({ ...HEALTHY, renderScale: 1 }).reason, 'up-pending');
  decision = controller.sample({ ...NEUTRAL, renderScale: 1 });
  assert.equal(decision.reason, 'hysteresis');
  assert.equal(controller.sample({ ...HEALTHY, renderScale: 1 }).reason, 'up-pending');
});

test('quality presets clamp immediately and scale steps never cross effective bounds', () => {
  const controller = createDynamicResolutionController({
    qualityPreset: 'performance',
    downSamples: 1,
    upSamples: 1,
    cooldownSamples: 0,
  });

  let decision = controller.sample({ ...HEALTHY, renderScale: 1.2 });
  assert.equal(decision.reason, 'bounds-clamp');
  assert.equal(decision.renderScale, 0.85);
  assert.deepEqual(decision.bounds, { minScale: 0.5, maxScale: 0.85 });

  decision = controller.sample({ ...HEALTHY, renderScale: 0.85 });
  assert.equal(decision.reason, 'at-max');
  assert.equal(decision.changed, false);

  decision = controller.sample({ ...SLOW, renderScale: 0.53 });
  assert.equal(decision.renderScale, 0.5);
  decision = controller.sample({ ...SLOW, renderScale: 0.5 });
  assert.equal(decision.reason, 'at-min');

  controller.setQualityPreset('ultra');
  decision = controller.sample({ ...HEALTHY, renderScale: 0.8 });
  assert.equal(decision.reason, 'bounds-clamp');
  assert.equal(decision.renderScale, 1);
  assert.deepEqual(controller.bounds, { minScale: 1, maxScale: 1.5 });
});

test('disabled mode preserves user scale and enabling starts fresh adaptation state', () => {
  const controller = createDynamicResolutionController({
    enabled: false,
    qualityPreset: 'quality',
    downSamples: 1,
    cooldownSamples: 0,
  });

  let decision = controller.sample({ ...SLOW, renderScale: 1.2 });
  assert.equal(decision.reason, 'disabled');
  assert.equal(decision.renderScale, 1.2);
  assert.equal(decision.changed, false);

  controller.enabled = true;
  decision = controller.sample({ ...SLOW, renderScale: 1.2 });
  assert.equal(decision.reason, 'performance-low');
  assert.equal(decision.renderScale, 1.1);

  controller.enabled = false;
  assert.deepEqual(controller.snapshot().streaks, { down: 0, up: 0 });
  assert.equal(controller.snapshot().cooldownRemaining, 0);
});

test('accepts nested PerformanceMonitor metrics and treats zero or missing metrics as warmup data', () => {
  const controller = createDynamicResolutionController({ qualityPreset: 'quality' });
  const performanceSnapshot = {
    status: 'collecting',
    metrics: SLOW,
  };

  let decision = controller.recordSample(performanceSnapshot, 1);
  assert.equal(decision.reason, 'down-pending');

  decision = controller.sample({
    metrics: { avgFps: 0, onePercentLowFps: 0, frameP95Ms: 0 },
    renderScale: 1,
  });
  assert.equal(decision.reason, 'insufficient-data');
  assert.deepEqual(decision.streaks, { down: 0, up: 0 });
});

test('reset clears runtime state but preserves controller configuration', () => {
  const controller = createDynamicResolutionController({
    qualityPreset: 'quality',
    downSamples: 1,
    cooldownSamples: 3,
  });
  controller.sample({ ...SLOW, renderScale: 1 });
  assert.equal(controller.snapshot().cooldownRemaining, 3);

  const snapshot = controller.reset();
  assert.equal(snapshot.sampleCount, 0);
  assert.equal(snapshot.cooldownRemaining, 0);
  assert.deepEqual(snapshot.streaks, { down: 0, up: 0 });
  assert.equal(snapshot.lastScale, null);
  assert.equal(snapshot.lastMetrics, null);
  assert.equal(snapshot.qualityPreset, 'quality');
  assert.equal(snapshot.targetFps, 60);
});

test('validates options and exposes immutable default preset limits', () => {
  assert.equal(Object.isFrozen(DEFAULT_DYNAMIC_RESOLUTION_QUALITY_PRESETS), true);
  assert.equal(Object.isFrozen(DEFAULT_DYNAMIC_RESOLUTION_QUALITY_PRESETS.balanced), true);
  assert.throws(() => createDynamicResolutionController({ targetFps: 0 }), /targetFps/);
  assert.throws(() => createDynamicResolutionController({ minScale: 2, maxScale: 1 }), /minScale/);
  assert.throws(() => createDynamicResolutionController({ cooldownSamples: -1 }), /cooldownSamples/);
  assert.throws(() => createDynamicResolutionController({ qualityPreset: 'missing' }), /Unknown/);
  assert.throws(() => createDynamicResolutionController({
    qualityPreset: 'custom',
    qualityPresets: { custom: { minScale: 0.5 } },
  }), /custom.maxScale/);
  assert.throws(() => createDynamicResolutionController({ enabled: 'yes' }), /enabled/);
  assert.throws(() => createDynamicResolutionController({
    downThresholds: { avgFps: 59 },
    upThresholds: { avgFps: 58 },
  }), /downThresholds.avgFps/);

  const controller = createDynamicResolutionController();
  assert.throws(() => controller.sample(null), /performance sample/);
  assert.throws(() => controller.sample({ ...SLOW, renderScale: 0 }), /renderScale/);
  assert.throws(() => controller.sample({ ...SLOW, avgFps: Number.NaN, renderScale: 1 }), /avgFps/);
  assert.throws(() => { controller.bounds.minScale = 0; }, TypeError);
});
