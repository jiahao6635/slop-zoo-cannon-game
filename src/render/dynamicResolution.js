/**
 * Renderer-agnostic dynamic resolution controller.
 *
 * Feed it sampled rolling performance metrics rather than individual frames.
 * The controller only recommends a render scale; applying that scale to the
 * renderer remains the caller's responsibility.
 */

const SCALE_PRECISION = 6;

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

export const DEFAULT_DYNAMIC_RESOLUTION_QUALITY_PRESETS = deepFreeze({
  performance: { minScale: 0.5, maxScale: 0.85 },
  balanced: { minScale: 0.65, maxScale: 1 },
  quality: { minScale: 0.75, maxScale: 1.25 },
  ultra: { minScale: 1, maxScale: 1.5 },
});

function requirePositiveFinite(value, fallback, name) {
  const number = Number(value === undefined ? fallback : value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
  return number;
}

function requirePositiveInteger(value, fallback, name, { allowZero = false } = {}) {
  const number = Number(value === undefined ? fallback : value);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(number) || number < minimum) {
    throw new RangeError(`${name} must be ${allowZero ? 'a non-negative' : 'a positive'} safe integer`);
  }
  return number;
}

function requireBoolean(value, fallback, name) {
  const resolved = value === undefined ? fallback : value;
  if (typeof resolved !== 'boolean') throw new TypeError(`${name} must be a boolean`);
  return resolved;
}

function normalizePresetBounds(bounds, name) {
  if (!bounds || typeof bounds !== 'object' || Array.isArray(bounds)) {
    throw new TypeError(`Quality preset ${name} must be a { minScale, maxScale } object`);
  }
  const minScale = requirePositiveFinite(bounds.minScale, undefined, `${name}.minScale`);
  const maxScale = requirePositiveFinite(bounds.maxScale, undefined, `${name}.maxScale`);
  if (minScale > maxScale) {
    throw new RangeError(`${name}.minScale cannot exceed ${name}.maxScale`);
  }
  return Object.freeze({ minScale, maxScale });
}

function normalizeQualityPresets(input) {
  if (input === undefined) return DEFAULT_DYNAMIC_RESOLUTION_QUALITY_PRESETS;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('qualityPresets must be an object');
  }

  const presets = {};
  for (const [name, bounds] of Object.entries(input)) {
    if (!name) throw new RangeError('Quality preset names cannot be empty');
    presets[name] = normalizePresetBounds(bounds, name);
  }
  if (Object.keys(presets).length === 0) {
    throw new RangeError('qualityPresets must define at least one preset');
  }
  return Object.freeze(presets);
}

function normalizeThresholds(input, defaults, name) {
  if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input))) {
    throw new TypeError(`${name} must be an object`);
  }
  const source = input ?? {};
  return Object.freeze({
    avgFps: requirePositiveFinite(source.avgFps, defaults.avgFps, `${name}.avgFps`),
    onePercentLowFps: requirePositiveFinite(
      source.onePercentLowFps,
      defaults.onePercentLowFps,
      `${name}.onePercentLowFps`,
    ),
    frameP95Ms: requirePositiveFinite(source.frameP95Ms, defaults.frameP95Ms, `${name}.frameP95Ms`),
  });
}

function validateHysteresis(downThresholds, upThresholds) {
  if (downThresholds.avgFps >= upThresholds.avgFps) {
    throw new RangeError('downThresholds.avgFps must be lower than upThresholds.avgFps');
  }
  if (downThresholds.onePercentLowFps >= upThresholds.onePercentLowFps) {
    throw new RangeError(
      'downThresholds.onePercentLowFps must be lower than upThresholds.onePercentLowFps',
    );
  }
  if (downThresholds.frameP95Ms <= upThresholds.frameP95Ms) {
    throw new RangeError('downThresholds.frameP95Ms must be higher than upThresholds.frameP95Ms');
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundScale(value) {
  return Number(value.toFixed(SCALE_PRECISION));
}

function cloneMetrics(metrics) {
  return metrics ? { ...metrics } : null;
}

function readMetric(value, name) {
  if (value === undefined || value === null) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new RangeError(`${name} must be a non-negative finite number when supplied`);
  }
  return number;
}

function normalizeSample(sample, renderScaleOverride) {
  if (!sample || typeof sample !== 'object' || Array.isArray(sample)) {
    throw new TypeError('performance sample must be an object');
  }
  const source = sample.metrics && typeof sample.metrics === 'object' ? sample.metrics : sample;
  const renderScale = requirePositiveFinite(
    renderScaleOverride ?? sample.renderScale,
    undefined,
    'renderScale',
  );
  const metrics = {
    avgFps: readMetric(source.avgFps, 'avgFps'),
    onePercentLowFps: readMetric(source.onePercentLowFps, 'onePercentLowFps'),
    frameP95Ms: readMetric(source.frameP95Ms, 'frameP95Ms'),
  };
  const complete = Object.values(metrics).every((value) => value !== null && value > 0);
  return { renderScale, metrics, complete };
}

/**
 * @typedef {Object} DynamicResolutionOptions
 * @property {boolean} [enabled=true]
 * @property {number} [targetFps=60]
 * @property {number} [minScale=0.5] Absolute lower render-scale limit.
 * @property {number} [maxScale=1.5] Absolute upper render-scale limit.
 * @property {number} [downStep=0.1]
 * @property {number} [upStep=0.05]
 * @property {number} [downSamples=2] Consecutive slow samples needed to reduce scale.
 * @property {number} [upSamples=5] Consecutive healthy samples needed to increase scale.
 * @property {number} [cooldownSamples=4] Samples ignored after changing scale.
 * @property {string} [qualityPreset='balanced']
 * @property {Object} [qualityPresets]
 * @property {Object} [downThresholds] Any failing metric is considered slow.
 * @property {Object} [upThresholds] Every metric must pass to count as healthy.
 */
export class DynamicResolutionController {
  constructor({
    enabled,
    targetFps,
    minScale,
    maxScale,
    downStep,
    upStep,
    downSamples,
    upSamples,
    cooldownSamples,
    qualityPreset = 'balanced',
    qualityPresets,
    downThresholds,
    upThresholds,
  } = {}) {
    this.targetFps = requirePositiveFinite(targetFps, 60, 'targetFps');
    this.minScale = requirePositiveFinite(minScale, 0.5, 'minScale');
    this.maxScale = requirePositiveFinite(maxScale, 1.5, 'maxScale');
    if (this.minScale > this.maxScale) {
      throw new RangeError('minScale cannot exceed maxScale');
    }

    this.downStep = requirePositiveFinite(downStep, 0.1, 'downStep');
    this.upStep = requirePositiveFinite(upStep, 0.05, 'upStep');
    this.downSamples = requirePositiveInteger(downSamples, 2, 'downSamples');
    this.upSamples = requirePositiveInteger(upSamples, 5, 'upSamples');
    this.cooldownSamples = requirePositiveInteger(
      cooldownSamples,
      4,
      'cooldownSamples',
      { allowZero: true },
    );
    this.qualityPresets = normalizeQualityPresets(qualityPresets);

    const targetFrameMs = 1_000 / this.targetFps;
    this.downThresholds = normalizeThresholds(downThresholds, {
      avgFps: this.targetFps * 0.9,
      onePercentLowFps: this.targetFps * 0.7,
      frameP95Ms: targetFrameMs * 1.35,
    }, 'downThresholds');
    this.upThresholds = normalizeThresholds(upThresholds, {
      avgFps: this.targetFps * 0.97,
      onePercentLowFps: this.targetFps * 0.85,
      frameP95Ms: targetFrameMs * 1.1,
    }, 'upThresholds');
    validateHysteresis(this.downThresholds, this.upThresholds);

    this._enabled = requireBoolean(enabled, true, 'enabled');
    this._qualityPreset = null;
    this._bounds = null;
    this.setQualityPreset(qualityPreset);
    this.reset();
  }

  get enabled() {
    return this._enabled;
  }

  set enabled(value) {
    this.setEnabled(value);
  }

  get qualityPreset() {
    return this._qualityPreset;
  }

  set qualityPreset(value) {
    this.setQualityPreset(value);
  }

  get bounds() {
    return Object.freeze({ ...this._bounds });
  }

  /** Enables/disables adaptation. Re-enabling starts with fresh streaks. */
  setEnabled(enabled) {
    requireBoolean(enabled, undefined, 'enabled');
    if (enabled !== this._enabled) {
      this._enabled = enabled;
      this._resetAdaptationState();
    }
    return this._enabled;
  }

  /** Selects a preset and intersects it with the controller's absolute limits. */
  setQualityPreset(qualityPreset) {
    if (typeof qualityPreset !== 'string' || !qualityPreset) {
      throw new TypeError('qualityPreset must be a non-empty string');
    }
    const preset = this.qualityPresets[qualityPreset];
    if (!preset) throw new RangeError(`Unknown dynamic resolution quality preset: ${qualityPreset}`);

    const bounds = {
      minScale: Math.max(this.minScale, preset.minScale),
      maxScale: Math.min(this.maxScale, preset.maxScale),
    };
    if (bounds.minScale > bounds.maxScale) {
      throw new RangeError(`Quality preset ${qualityPreset} does not intersect the configured scale limits`);
    }

    const changed = this._qualityPreset !== qualityPreset;
    this._qualityPreset = qualityPreset;
    this._bounds = Object.freeze(bounds);
    if (changed) this._resetAdaptationState();
    return this.bounds;
  }

  /**
   * Records one sampled performance snapshot and returns a recommendation.
   * A PerformanceMonitor snapshot can be passed directly with renderScale as
   * the second argument because its values live under `metrics`.
   */
  recordSample(sample, renderScaleOverride) {
    const normalized = normalizeSample(sample, renderScaleOverride);
    const { renderScale, metrics, complete } = normalized;
    this._sampleCount += 1;
    this._lastMetrics = metrics;
    this._lastScale = renderScale;

    if (!this._enabled) {
      this._resetStreaks();
      return this._decision(renderScale, renderScale, 'none', 'disabled', metrics);
    }

    const boundedScale = roundScale(clamp(renderScale, this._bounds.minScale, this._bounds.maxScale));
    if (boundedScale !== renderScale) {
      const direction = boundedScale < renderScale ? 'down' : 'up';
      this._afterScaleChange(boundedScale);
      return this._decision(renderScale, boundedScale, direction, 'bounds-clamp', metrics);
    }

    if (!complete) {
      this._resetStreaks();
      return this._decision(renderScale, renderScale, 'none', 'insufficient-data', metrics);
    }

    if (this._cooldownRemaining > 0) {
      this._cooldownRemaining -= 1;
      this._resetStreaks();
      return this._decision(renderScale, renderScale, 'none', 'cooldown', metrics);
    }

    const slow = metrics.avgFps < this.downThresholds.avgFps
      || metrics.onePercentLowFps < this.downThresholds.onePercentLowFps
      || metrics.frameP95Ms > this.downThresholds.frameP95Ms;
    const healthy = metrics.avgFps >= this.upThresholds.avgFps
      && metrics.onePercentLowFps >= this.upThresholds.onePercentLowFps
      && metrics.frameP95Ms <= this.upThresholds.frameP95Ms;

    if (slow) {
      this._downStreak += 1;
      this._upStreak = 0;
      if (this._downStreak < this.downSamples) {
        return this._decision(renderScale, renderScale, 'none', 'down-pending', metrics);
      }
      if (renderScale <= this._bounds.minScale) {
        this._resetStreaks();
        return this._decision(renderScale, renderScale, 'none', 'at-min', metrics);
      }

      const nextScale = roundScale(Math.max(this._bounds.minScale, renderScale - this.downStep));
      this._afterScaleChange(nextScale);
      return this._decision(renderScale, nextScale, 'down', 'performance-low', metrics);
    }

    if (healthy) {
      this._upStreak += 1;
      this._downStreak = 0;
      if (this._upStreak < this.upSamples) {
        return this._decision(renderScale, renderScale, 'none', 'up-pending', metrics);
      }
      if (renderScale >= this._bounds.maxScale) {
        this._resetStreaks();
        return this._decision(renderScale, renderScale, 'none', 'at-max', metrics);
      }

      const nextScale = roundScale(Math.min(this._bounds.maxScale, renderScale + this.upStep));
      this._afterScaleChange(nextScale);
      return this._decision(renderScale, nextScale, 'up', 'performance-headroom', metrics);
    }

    this._resetStreaks();
    return this._decision(renderScale, renderScale, 'none', 'hysteresis', metrics);
  }

  /** Alias suited to callers that already use `sample` terminology. */
  sample(performanceSample, renderScaleOverride) {
    return this.recordSample(performanceSample, renderScaleOverride);
  }

  /** Clears counters and adaptation history while retaining configuration. */
  reset() {
    this._sampleCount = 0;
    this._lastMetrics = null;
    this._lastScale = null;
    this._lastDecision = null;
    this._resetAdaptationState();
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({
      enabled: this._enabled,
      targetFps: this.targetFps,
      qualityPreset: this._qualityPreset,
      bounds: Object.freeze({ ...this._bounds }),
      sampleCount: this._sampleCount,
      cooldownRemaining: this._cooldownRemaining,
      streaks: Object.freeze({ down: this._downStreak, up: this._upStreak }),
      lastScale: this._lastScale,
      lastMetrics: this._lastMetrics ? Object.freeze(cloneMetrics(this._lastMetrics)) : null,
      lastDecision: this._lastDecision,
    });
  }

  _decision(previousScale, renderScale, direction, reason, metrics) {
    const decision = Object.freeze({
      changed: renderScale !== previousScale,
      direction,
      reason,
      previousScale,
      renderScale,
      enabled: this._enabled,
      targetFps: this.targetFps,
      qualityPreset: this._qualityPreset,
      bounds: Object.freeze({ ...this._bounds }),
      sampleCount: this._sampleCount,
      cooldownRemaining: this._cooldownRemaining,
      streaks: Object.freeze({ down: this._downStreak, up: this._upStreak }),
      metrics: Object.freeze(cloneMetrics(metrics)),
    });
    this._lastDecision = decision;
    this._lastScale = renderScale;
    return decision;
  }

  _afterScaleChange(renderScale) {
    this._lastScale = renderScale;
    this._cooldownRemaining = this.cooldownSamples;
    this._resetStreaks();
  }

  _resetStreaks() {
    this._downStreak = 0;
    this._upStreak = 0;
  }

  _resetAdaptationState() {
    this._cooldownRemaining = 0;
    this._resetStreaks();
  }
}

export function createDynamicResolutionController(options) {
  return new DynamicResolutionController(options);
}
