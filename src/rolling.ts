import { RingBuffer } from "./ring-buffer.js";

export interface RollingOptions {
  /** Window size (number of observations). Must be ≥ 1. */
  window: number;
  /**
   * Minimum number of observations required to compute a result.
   * Default: same as window (require a full window).
   * Set to 1 to emit values immediately.
   */
  minPeriods?: number;
}

/**
 * Welford's online algorithm for computing mean and variance in one pass
 * with numerical stability. O(1) per sample update.
 */
class WelfordAccumulator {
  private _n = 0;
  private _mean = 0;
  private _M2 = 0; // sum of squared deviations

  add(x: number): void {
    this._n++;
    const delta = x - this._mean;
    this._mean += delta / this._n;
    this._M2 += delta * (x - this._mean);
  }

  remove(x: number): void {
    if (this._n === 0) return;
    this._n--;
    if (this._n === 0) { this._mean = 0; this._M2 = 0; return; }
    const delta = x - this._mean;
    this._mean -= delta / this._n;
    this._M2 -= delta * (x - this._mean);
    if (this._M2 < 0) this._M2 = 0; // float rounding guard
  }

  get count(): number { return this._n; }
  get mean(): number { return this._n > 0 ? this._mean : NaN; }
  /** Population variance (ddof=0). */
  get variance(): number { return this._n > 1 ? this._M2 / this._n : this._n === 1 ? 0 : NaN; }
  /** Sample variance (ddof=1, like pandas default). */
  get sampleVariance(): number { return this._n > 1 ? this._M2 / (this._n - 1) : NaN; }
  get std(): number { return Math.sqrt(this.sampleVariance); }
  get popStd(): number { return Math.sqrt(this.variance); }

  reset(): void { this._n = 0; this._mean = 0; this._M2 = 0; }
}

// ── RollingMean ───────────────────────────────────────────────────────────

/**
 * O(1) per sample rolling mean using Welford's algorithm.
 *
 * @example
 * const rm = new RollingMean({ window: 3 });
 * rm.push(1); rm.push(2); rm.push(3);
 * rm.value; // → 2
 * rm.push(4);
 * rm.value; // → 3  (window: [2, 3, 4])
 */
export class RollingMean {
  private readonly _buf: RingBuffer;
  private readonly _acc = new WelfordAccumulator();
  private readonly _minPeriods: number;

  constructor(opts: RollingOptions) {
    if (opts.window < 1) throw new RangeError("window must be ≥ 1");
    this._buf = new RingBuffer(opts.window);
    this._minPeriods = opts.minPeriods ?? opts.window;
  }

  push(value: number): this {
    const evicted = this._buf.push(value);
    if (evicted !== undefined) this._acc.remove(evicted);
    this._acc.add(value);
    return this;
  }

  get value(): number {
    return this._acc.count >= this._minPeriods ? this._acc.mean : NaN;
  }

  get count(): number { return this._buf.count; }
  reset(): void { this._buf.clear(); this._acc.reset(); }
}

// ── RollingStd / RollingVar ───────────────────────────────────────────────

export class RollingStd {
  private readonly _buf: RingBuffer;
  private readonly _acc = new WelfordAccumulator();
  private readonly _minPeriods: number;
  private readonly _ddof: number;

  constructor(opts: RollingOptions & { ddof?: number }) {
    if (opts.window < 1) throw new RangeError("window must be ≥ 1");
    this._buf = new RingBuffer(opts.window);
    this._minPeriods = opts.minPeriods ?? opts.window;
    this._ddof = opts.ddof ?? 1;
  }

  push(value: number): this {
    const evicted = this._buf.push(value);
    if (evicted !== undefined) this._acc.remove(evicted);
    this._acc.add(value);
    return this;
  }

  get value(): number {
    if (this._acc.count < this._minPeriods) return NaN;
    return this._ddof === 0 ? this._acc.popStd : this._acc.std;
  }

  get variance(): number {
    if (this._acc.count < this._minPeriods) return NaN;
    return this._ddof === 0 ? this._acc.variance : this._acc.sampleVariance;
  }

  get count(): number { return this._buf.count; }
  reset(): void { this._buf.clear(); this._acc.reset(); }
}

// alias
export class RollingVar extends RollingStd {
  override get value(): number { return this.variance; }
}

// ── RollingSum ────────────────────────────────────────────────────────────

export class RollingSum {
  private readonly _buf: RingBuffer;
  private _sum = 0;
  private readonly _minPeriods: number;

  constructor(opts: RollingOptions) {
    if (opts.window < 1) throw new RangeError("window must be ≥ 1");
    this._buf = new RingBuffer(opts.window);
    this._minPeriods = opts.minPeriods ?? opts.window;
  }

  push(value: number): this {
    const evicted = this._buf.push(value);
    if (evicted !== undefined) this._sum -= evicted;
    this._sum += value;
    return this;
  }

  get value(): number {
    return this._buf.count >= this._minPeriods ? this._sum : NaN;
  }

  get count(): number { return this._buf.count; }
  reset(): void { this._buf.clear(); this._sum = 0; }
}

// ── RollingMin / RollingMax ───────────────────────────────────────────────

/**
 * O(1) amortized rolling min using a monotonic deque.
 */
export class RollingMin {
  private readonly _buf: RingBuffer;
  private readonly _deque: Array<{ val: number; idx: number }> = [];
  private _idx = 0;
  private readonly _minPeriods: number;

  constructor(opts: RollingOptions) {
    if (opts.window < 1) throw new RangeError("window must be ≥ 1");
    this._buf = new RingBuffer(opts.window);
    this._minPeriods = opts.minPeriods ?? opts.window;
  }

  push(value: number): this {
    // Remove elements outside the window
    const oldest = this._idx - this._buf.capacity + 1;
    while (this._deque.length > 0 && this._deque[0].idx < oldest) {
      this._deque.shift();
    }
    // Maintain monotone increasing deque (min at front)
    while (this._deque.length > 0 && this._deque[this._deque.length - 1].val >= value) {
      this._deque.pop();
    }
    this._deque.push({ val: value, idx: this._idx });
    this._buf.push(value);
    this._idx++;
    return this;
  }

  get value(): number {
    return this._buf.count >= this._minPeriods
      ? (this._deque.length > 0 ? this._deque[0].val : NaN)
      : NaN;
  }

  get count(): number { return this._buf.count; }

  reset(): void {
    this._buf.clear();
    this._deque.length = 0;
    this._idx = 0;
  }
}

/** O(1) amortized rolling max using a monotonic deque. */
export class RollingMax {
  private readonly _buf: RingBuffer;
  private readonly _deque: Array<{ val: number; idx: number }> = [];
  private _idx = 0;
  private readonly _minPeriods: number;

  constructor(opts: RollingOptions) {
    if (opts.window < 1) throw new RangeError("window must be ≥ 1");
    this._buf = new RingBuffer(opts.window);
    this._minPeriods = opts.minPeriods ?? opts.window;
  }

  push(value: number): this {
    const oldest = this._idx - this._buf.capacity + 1;
    while (this._deque.length > 0 && this._deque[0].idx < oldest) {
      this._deque.shift();
    }
    while (this._deque.length > 0 && this._deque[this._deque.length - 1].val <= value) {
      this._deque.pop();
    }
    this._deque.push({ val: value, idx: this._idx });
    this._buf.push(value);
    this._idx++;
    return this;
  }

  get value(): number {
    return this._buf.count >= this._minPeriods
      ? (this._deque.length > 0 ? this._deque[0].val : NaN)
      : NaN;
  }

  get count(): number { return this._buf.count; }

  reset(): void {
    this._buf.clear();
    this._deque.length = 0;
    this._idx = 0;
  }
}

// ── RollingMedian ─────────────────────────────────────────────────────────

/**
 * O(n log n) rolling median using a sorted window buffer.
 * For real-time use with large windows, consider an order-statistic tree.
 */
export class RollingMedian {
  private readonly _buf: RingBuffer;
  private readonly _minPeriods: number;

  constructor(opts: RollingOptions) {
    if (opts.window < 1) throw new RangeError("window must be ≥ 1");
    this._buf = new RingBuffer(opts.window);
    this._minPeriods = opts.minPeriods ?? opts.window;
  }

  push(value: number): this {
    this._buf.push(value);
    return this;
  }

  get value(): number {
    if (this._buf.count < this._minPeriods) return NaN;
    const sorted = this._buf.toArray().sort((a, b) => a - b);
    const n = sorted.length;
    return n % 2 === 0
      ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : sorted[(n - 1) / 2];
  }

  quantile(q: number): number {
    if (q < 0 || q > 1) throw new RangeError("quantile must be in [0, 1]");
    if (this._buf.count < this._minPeriods) return NaN;
    const sorted = this._buf.toArray().sort((a, b) => a - b);
    const n = sorted.length;
    const idx = q * (n - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  get count(): number { return this._buf.count; }
  reset(): void { this._buf.clear(); }
}

// ── EMA (Exponential Moving Average) ─────────────────────────────────────

export interface EMAOptions {
  /**
   * Span: alpha = 2 / (span + 1). Pandas default.
   * Provide either span or alpha (not both).
   */
  span?: number;
  /** Smoothing factor α ∈ (0, 1]. */
  alpha?: number;
  /**
   * If true, use adjusted EMA (pandas default): handles initial values
   * by weighting older observations less.
   * Default: false (standard recursive EMA).
   */
  adjust?: boolean;
}

/**
 * Exponential Moving Average.
 *
 * @example
 * const ema = new EMA({ span: 3 }); // α = 0.5
 * ema.push(1); ema.value; // → 1
 * ema.push(3); ema.value; // → 2   (0.5 * 3 + 0.5 * 1)
 * ema.push(5); ema.value; // → 3.5 (0.5 * 5 + 0.5 * 2)
 */
export class EMA {
  private readonly _alpha: number;
  private readonly _adjust: boolean;
  private _ema: number | undefined;
  // For adjust=true
  private _numerator = 0;
  private _denominator = 0;
  private _n = 0;

  constructor(opts: EMAOptions) {
    if (opts.span !== undefined && opts.alpha !== undefined) {
      throw new Error("Provide either span or alpha, not both");
    }
    if (opts.alpha !== undefined) {
      if (opts.alpha <= 0 || opts.alpha > 1) throw new RangeError("alpha must be in (0, 1]");
      this._alpha = opts.alpha;
    } else if (opts.span !== undefined) {
      if (opts.span < 1) throw new RangeError("span must be ≥ 1");
      this._alpha = 2 / (opts.span + 1);
    } else {
      throw new Error("Provide either span or alpha");
    }
    this._adjust = opts.adjust ?? false;
  }

  push(value: number): this {
    if (!this._adjust) {
      this._ema = this._ema === undefined ? value : this._alpha * value + (1 - this._alpha) * this._ema;
    } else {
      // Adjusted EMA: sum(alpha^i * x[n-i]) / sum(alpha^i)
      this._n++;
      const w = (1 - this._alpha) ** (this._n - 1);
      this._numerator = this._alpha * value + (1 - this._alpha) * this._numerator;
      this._denominator = this._alpha + (1 - this._alpha) * this._denominator;
    }
    return this;
  }

  get value(): number {
    if (this._adjust) {
      return this._denominator === 0 ? NaN : this._numerator / this._denominator;
    }
    return this._ema ?? NaN;
  }

  get alpha(): number { return this._alpha; }

  reset(): void {
    this._ema = undefined;
    this._numerator = 0;
    this._denominator = 0;
    this._n = 0;
  }
}

// ── Rolling (unified API) ─────────────────────────────────────────────────

/**
 * Unified rolling window that computes multiple statistics in one pass.
 *
 * @example
 * const r = new Rolling({ window: 3 });
 * r.push(1); r.push(2); r.push(3);
 * r.mean;   // 2
 * r.min;    // 1
 * r.max;    // 3
 * r.sum;    // 6
 * r.std;    // 1
 */
export class Rolling {
  private readonly _buf: RingBuffer;
  private readonly _acc = new WelfordAccumulator();
  private readonly _minBuf: Array<{ val: number; idx: number }> = [];
  private readonly _maxBuf: Array<{ val: number; idx: number }> = [];
  private _sum = 0;
  private _idx = 0;
  private readonly _minPeriods: number;

  constructor(opts: RollingOptions) {
    if (opts.window < 1) throw new RangeError("window must be ≥ 1");
    this._buf = new RingBuffer(opts.window);
    this._minPeriods = opts.minPeriods ?? opts.window;
  }

  push(value: number): this {
    const evicted = this._buf.push(value);
    if (evicted !== undefined) {
      this._acc.remove(evicted);
      this._sum -= evicted;
    }
    this._acc.add(value);
    this._sum += value;

    // Min/Max deque update
    const oldest = this._idx - this._buf.capacity + 1;
    while (this._minBuf.length > 0 && this._minBuf[0].idx < oldest) this._minBuf.shift();
    while (this._maxBuf.length > 0 && this._maxBuf[0].idx < oldest) this._maxBuf.shift();
    while (this._minBuf.length > 0 && this._minBuf[this._minBuf.length - 1].val >= value) this._minBuf.pop();
    while (this._maxBuf.length > 0 && this._maxBuf[this._maxBuf.length - 1].val <= value) this._maxBuf.pop();
    this._minBuf.push({ val: value, idx: this._idx });
    this._maxBuf.push({ val: value, idx: this._idx });
    this._idx++;

    return this;
  }

  private get _ready(): boolean { return this._buf.count >= this._minPeriods; }

  get mean(): number { return this._ready ? this._acc.mean : NaN; }
  get sum(): number { return this._ready ? this._sum : NaN; }
  get count(): number { return this._buf.count; }
  get variance(): number { return this._ready ? this._acc.sampleVariance : NaN; }
  get std(): number { return this._ready ? this._acc.std : NaN; }
  get min(): number { return this._ready && this._minBuf.length > 0 ? this._minBuf[0].val : NaN; }
  get max(): number { return this._ready && this._maxBuf.length > 0 ? this._maxBuf[0].val : NaN; }
  get window(): number { return this._buf.capacity; }
  get values(): number[] { return this._buf.toArray(); }

  /** Median — O(n log n) per call. */
  get median(): number {
    if (!this._ready) return NaN;
    const sorted = this._buf.toArray().sort((a, b) => a - b);
    const n = sorted.length;
    return n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[(n - 1) / 2];
  }

  /** Quantile [0..1] — O(n log n) per call. Uses linear interpolation. */
  quantile(q: number): number {
    if (q < 0 || q > 1) throw new RangeError("q must be in [0, 1]");
    if (!this._ready) return NaN;
    const sorted = this._buf.toArray().sort((a, b) => a - b);
    const n = sorted.length;
    const idx = q * (n - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  reset(): void {
    this._buf.clear();
    this._acc.reset();
    this._minBuf.length = 0;
    this._maxBuf.length = 0;
    this._sum = 0;
    this._idx = 0;
  }
}
