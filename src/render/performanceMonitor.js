/**
 * A renderer-agnostic rolling performance monitor.
 *
 * Frame deltas are expressed in seconds. The 1% low value is the reciprocal
 * of the mean frame time of the slowest 1% of frames in the rolling window.
 * This matches the useful game-performance interpretation of "1% low FPS"
 * without relying on wall-clock time or browser APIs.
 */

const METRIC_DIRECTIONS = Object.freeze({
  avgFps: 'min',
  onePercentLowFps: 'min',
  frameP95Ms: 'max',
  frameMaxMs: 'max',
  drawCalls: 'max',
  triangles: 'max',
  points: 'max',
  lines: 'max',
  geometries: 'max',
  textures: 'max',
  activeEntities: 'max',
});

export const PERFORMANCE_METRICS = Object.freeze(Object.keys(METRIC_DIRECTIONS));

export const DEFAULT_PERFORMANCE_BUDGETS = deepFreeze({
  avgFps: { min: 55 },
  onePercentLowFps: { min: 40 },
  frameP95Ms: { max: 24 },
  frameMaxMs: { max: 100 },
  drawCalls: { max: 160 },
  triangles: { max: 750_000 },
  geometries: { max: 300 },
  textures: { max: 192 },
  activeEntities: { max: 600 },
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function requireFiniteOption(value, fallback, name, { allowZero = false } = {}) {
  if (value === undefined) return fallback;
  const number = Number(value);
  const valid = Number.isFinite(number) && (allowZero ? number >= 0 : number > 0);
  if (!valid) {
    throw new RangeError(`${name} must be ${allowZero ? 'a non-negative' : 'a positive'} finite number`);
  }
  return number;
}

function normalizeDebounceSamples(value) {
  if (value === undefined) return 2;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new RangeError('alertDebounceSamples must be an integer of at least 1');
  }
  return number;
}

function normalizeBudgets(budgets) {
  if (budgets === false || budgets === null) return {};
  if (!budgets || typeof budgets !== 'object' || Array.isArray(budgets)) {
    throw new TypeError('budgets must be an object, false, or null');
  }

  const normalized = {};
  for (const [metric, input] of Object.entries(budgets)) {
    if (!(metric in METRIC_DIRECTIONS)) {
      throw new RangeError(`Unknown performance budget metric: ${metric}`);
    }

    if (input === false || input === null) continue;
    const rule = typeof input === 'number'
      ? { [METRIC_DIRECTIONS[metric]]: input }
      : input;

    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new TypeError(`Budget for ${metric} must be a number or a { min, max } object`);
    }

    const output = {};
    for (const direction of ['min', 'max']) {
      if (rule[direction] === undefined) continue;
      const limit = Number(rule[direction]);
      if (!Number.isFinite(limit) || limit < 0) {
        throw new RangeError(`${metric}.${direction} must be a non-negative finite number`);
      }
      output[direction] = limit;
    }

    if (output.min === undefined && output.max === undefined) {
      throw new TypeError(`Budget for ${metric} must define min and/or max`);
    }
    normalized[metric] = Object.freeze(output);
  }

  return Object.freeze(normalized);
}

function normalizeRendererInfo(input) {
  const rendererInfo = input?.info ?? input ?? {};
  const render = rendererInfo.render ?? {};
  const memory = rendererInfo.memory ?? {};

  return {
    render: {
      calls: finiteNonNegative(render.calls),
      triangles: finiteNonNegative(render.triangles),
      points: finiteNonNegative(render.points),
      lines: finiteNonNegative(render.lines),
    },
    memory: {
      geometries: finiteNonNegative(memory.geometries),
      textures: finiteNonNegative(memory.textures),
    },
  };
}

function normalizeEntityCounts(input) {
  if (typeof input === 'number') {
    return { counts: {}, total: finiteNonNegative(input) };
  }

  const counts = {};
  if (input && typeof input === 'object') {
    for (const [name, value] of Object.entries(input)) {
      if (name === 'total') continue;
      counts[name] = finiteNonNegative(value);
    }
  }

  const suppliedTotal = input && typeof input === 'object' && input.total !== undefined
    ? finiteNonNegative(input.total)
    : null;
  const total = suppliedTotal ?? Object.values(counts).reduce((sum, count) => sum + count, 0);
  return { counts, total };
}

function percentile(sortedValues, fraction) {
  if (sortedValues.length === 0) return 0;
  const index = Math.max(0, Math.ceil(sortedValues.length * fraction) - 1);
  return sortedValues[index];
}

function cloneLimits(limits) {
  return limits ? { ...limits } : {};
}

/**
 * @typedef {Object} PerformanceMonitorOptions
 * @property {number} [windowSeconds=10] Rolling statistics window.
 * @property {number} [warmupSeconds=2] Frames beginning during warmup are ignored.
 * @property {number} [sampleIntervalSeconds=1] Budget evaluation cadence; 0 is every frame.
 * @property {number} [alertDebounceSamples=2] Consecutive sampled states needed to cross a budget.
 * @property {Object|false|null} [budgets={}] Metric limits; numeric FPS limits are minimums,
 * and all other numeric limits are maximums.
 * @property {(event: Object) => void} [onAlert] Called on debounced exceeded/recovered crossings.
 */
export class PerformanceMonitor {
  constructor({
    windowSeconds,
    warmupSeconds,
    sampleIntervalSeconds,
    alertDebounceSamples,
    budgets = {},
    onAlert = null,
  } = {}) {
    this.windowSeconds = requireFiniteOption(windowSeconds, 10, 'windowSeconds');
    this.warmupSeconds = requireFiniteOption(warmupSeconds, 2, 'warmupSeconds', { allowZero: true });
    this.sampleIntervalSeconds = requireFiniteOption(
      sampleIntervalSeconds,
      1,
      'sampleIntervalSeconds',
      { allowZero: true },
    );
    this.alertDebounceSamples = normalizeDebounceSamples(alertDebounceSamples);
    this.budgets = normalizeBudgets(budgets);
    if (onAlert !== null && typeof onAlert !== 'function') {
      throw new TypeError('onAlert must be a function or null');
    }
    this.onAlert = onAlert;
    this.reset();
  }

  /**
   * Records one rendered frame. May also be called with a single object:
   * recordFrame({ deltaSeconds, rendererInfo, entityCounts }).
   * Returns a snapshot when the sampling interval elapses, otherwise null.
   */
  recordFrame(deltaSeconds, rendererInfo = {}, entityCounts = {}) {
    if (deltaSeconds && typeof deltaSeconds === 'object') {
      const frame = deltaSeconds;
      deltaSeconds = frame.deltaSeconds ?? frame.delta;
      rendererInfo = frame.rendererInfo ?? frame.renderer ?? frame.info ?? {};
      entityCounts = frame.entityCounts ?? frame.entities ?? frame.activeEntities ?? {};
    }

    const delta = Number(deltaSeconds);
    if (!Number.isFinite(delta) || delta <= 0) {
      throw new RangeError('deltaSeconds must be a positive finite number');
    }

    const frameStartedAt = this._elapsedSeconds;
    this._elapsedSeconds += delta;

    // Ignore a whole frame if any part of it began inside warmup. This avoids
    // counting a fractional frame as a full frame in FPS calculations.
    if (frameStartedAt < this.warmupSeconds) return null;

    this._measurementElapsedSeconds += delta;
    this._totalFrameCount += 1;
    this._sampleAccumulatorSeconds += delta;

    const normalizedInfo = normalizeRendererInfo(rendererInfo);
    const normalizedEntities = normalizeEntityCounts(entityCounts);
    const frame = {
      endSeconds: this._measurementElapsedSeconds,
      deltaSeconds: delta,
      render: normalizedInfo.render,
      memory: normalizedInfo.memory,
      entities: normalizedEntities,
    };
    this._frames.push(frame);
    this._latestFrame = frame;
    this._trimWindow();

    const samplingTolerance = Math.max(Number.EPSILON, this.sampleIntervalSeconds * 1e-12);
    const samplingDue = this.sampleIntervalSeconds === 0
      || this._sampleAccumulatorSeconds >= this.sampleIntervalSeconds - samplingTolerance;
    if (!samplingDue) return null;

    if (this.sampleIntervalSeconds > 0) {
      const elapsedIntervals = Math.max(
        1,
        Math.floor((this._sampleAccumulatorSeconds + samplingTolerance) / this.sampleIntervalSeconds),
      );
      this._sampleAccumulatorSeconds = Math.max(
        0,
        this._sampleAccumulatorSeconds - elapsedIntervals * this.sampleIntervalSeconds,
      );
    }
    this._samplesTaken += 1;

    const sampledSnapshot = this._createSnapshot();
    this._evaluateBudgets(sampledSnapshot);
    sampledSnapshot.budgetStatus = this._createBudgetStatus(sampledSnapshot.metrics);
    return sampledSnapshot;
  }

  /** Returns current rolling statistics without advancing sampling or alerts. */
  snapshot() {
    return this._createSnapshot();
  }

  /** Returns queued crossing events and clears the queue. */
  drainAlerts() {
    return this._alerts.splice(0, this._alerts.length).map((event) => ({
      ...event,
      limits: cloneLimits(event.limits),
    }));
  }

  /** Clears all samples, alert state, and elapsed counters while retaining configuration. */
  reset() {
    this._frames = [];
    this._latestFrame = null;
    this._elapsedSeconds = 0;
    this._measurementElapsedSeconds = 0;
    this._sampleAccumulatorSeconds = 0;
    this._totalFrameCount = 0;
    this._samplesTaken = 0;
    this._alertSequence = 0;
    this._alerts = [];
    this._budgetStates = new Map();
    for (const metric of Object.keys(this.budgets)) {
      this._budgetStates.set(metric, {
        exceeded: false,
        pending: null,
        pendingSamples: 0,
      });
    }
    return this.snapshot();
  }

  _trimWindow() {
    const cutoff = this._measurementElapsedSeconds - this.windowSeconds;
    let removeCount = 0;
    while (removeCount < this._frames.length && this._frames[removeCount].endSeconds <= cutoff) {
      removeCount += 1;
    }
    if (removeCount > 0) this._frames.splice(0, removeCount);
  }

  _createSnapshot() {
    const frameTimes = this._frames.map((frame) => frame.deltaSeconds);
    const sortedFrameTimes = [...frameTimes].sort((left, right) => left - right);
    const windowDurationSeconds = frameTimes.reduce((sum, value) => sum + value, 0);
    const slowFrameCount = Math.max(1, Math.ceil(frameTimes.length * 0.01));
    const slowestFrameTimes = sortedFrameTimes.slice(-slowFrameCount);
    const meanSlowFrameSeconds = slowestFrameTimes.length > 0
      ? slowestFrameTimes.reduce((sum, value) => sum + value, 0) / slowestFrameTimes.length
      : 0;

    const renderPeak = { calls: 0, triangles: 0, points: 0, lines: 0 };
    const memoryPeak = { geometries: 0, textures: 0 };
    const entityPeakCounts = {};
    let entityPeakTotal = 0;

    for (const frame of this._frames) {
      for (const key of Object.keys(renderPeak)) {
        renderPeak[key] = Math.max(renderPeak[key], frame.render[key]);
      }
      for (const key of Object.keys(memoryPeak)) {
        memoryPeak[key] = Math.max(memoryPeak[key], frame.memory[key]);
      }
      for (const [name, count] of Object.entries(frame.entities.counts)) {
        entityPeakCounts[name] = Math.max(entityPeakCounts[name] ?? 0, count);
      }
      entityPeakTotal = Math.max(entityPeakTotal, frame.entities.total);
    }

    const currentRender = this._latestFrame
      ? { ...this._latestFrame.render }
      : { calls: 0, triangles: 0, points: 0, lines: 0 };
    const currentMemory = this._latestFrame
      ? { ...this._latestFrame.memory }
      : { geometries: 0, textures: 0 };
    const currentEntities = this._latestFrame
      ? { counts: { ...this._latestFrame.entities.counts }, total: this._latestFrame.entities.total }
      : { counts: {}, total: 0 };

    const averageFps = windowDurationSeconds > 0 ? frameTimes.length / windowDurationSeconds : 0;
    const metrics = {
      avgFps: averageFps,
      onePercentLowFps: meanSlowFrameSeconds > 0 ? 1 / meanSlowFrameSeconds : 0,
      frameP95Ms: percentile(sortedFrameTimes, 0.95) * 1_000,
      frameMaxMs: (sortedFrameTimes.at(-1) ?? 0) * 1_000,
      drawCalls: renderPeak.calls,
      triangles: renderPeak.triangles,
      points: renderPeak.points,
      lines: renderPeak.lines,
      geometries: memoryPeak.geometries,
      textures: memoryPeak.textures,
      activeEntities: entityPeakTotal,
    };

    return {
      status: this._elapsedSeconds < this.warmupSeconds ? 'warming-up' : 'collecting',
      elapsedSeconds: this._elapsedSeconds,
      measuredSeconds: this._measurementElapsedSeconds,
      warmupRemainingSeconds: Math.max(0, this.warmupSeconds - this._elapsedSeconds),
      totalFrameCount: this._totalFrameCount,
      samplesTaken: this._samplesTaken,
      window: {
        configuredSeconds: this.windowSeconds,
        durationSeconds: windowDurationSeconds,
        frameCount: frameTimes.length,
      },
      fps: {
        average: metrics.avgFps,
        onePercentLow: metrics.onePercentLowFps,
      },
      frameTimeMs: {
        average: frameTimes.length > 0 ? (windowDurationSeconds / frameTimes.length) * 1_000 : 0,
        p95: metrics.frameP95Ms,
        max: metrics.frameMaxMs,
      },
      render: { current: currentRender, peak: renderPeak },
      memory: { current: currentMemory, peak: memoryPeak },
      entities: {
        current: currentEntities,
        peak: { counts: entityPeakCounts, total: entityPeakTotal },
      },
      metrics,
      budgetStatus: this._createBudgetStatus(metrics),
    };
  }

  _isBudgetExceeded(metric, value) {
    const limits = this.budgets[metric];
    return (limits.min !== undefined && value < limits.min)
      || (limits.max !== undefined && value > limits.max);
  }

  _createBudgetStatus(metrics) {
    const status = {};
    const hasFrames = this._frames.length > 0;

    for (const [metric, limits] of Object.entries(this.budgets)) {
      const state = this._budgetStates.get(metric);
      const currentlyExceeded = hasFrames && this._isBudgetExceeded(metric, metrics[metric]);
      let label = 'ok';
      if (!hasFrames) label = 'insufficient-data';
      else if (state?.pending !== null && state?.pending === currentlyExceeded) label = 'pending';
      else if (state?.exceeded) label = 'exceeded';

      status[metric] = {
        state: label,
        value: metrics[metric],
        limits: cloneLimits(limits),
      };
    }
    return status;
  }

  _evaluateBudgets(snapshot) {
    if (this._frames.length === 0) return;

    for (const [metric, limits] of Object.entries(this.budgets)) {
      const value = snapshot.metrics[metric];
      const exceeded = this._isBudgetExceeded(metric, value);
      const state = this._budgetStates.get(metric);

      if (exceeded === state.exceeded) {
        state.pending = null;
        state.pendingSamples = 0;
        continue;
      }

      if (state.pending === exceeded) state.pendingSamples += 1;
      else {
        state.pending = exceeded;
        state.pendingSamples = 1;
      }

      if (state.pendingSamples < this.alertDebounceSamples) continue;

      state.exceeded = exceeded;
      state.pending = null;
      state.pendingSamples = 0;
      const event = Object.freeze({
        id: ++this._alertSequence,
        type: exceeded ? 'budget-exceeded' : 'budget-recovered',
        metric,
        state: exceeded ? 'exceeded' : 'recovered',
        value,
        limits: Object.freeze(cloneLimits(limits)),
        elapsedSeconds: this._elapsedSeconds,
        sample: this._samplesTaken,
      });
      this._alerts.push(event);
      if (this.onAlert) this.onAlert(event);
    }
  }
}

export function createPerformanceMonitor(options) {
  return new PerformanceMonitor(options);
}
