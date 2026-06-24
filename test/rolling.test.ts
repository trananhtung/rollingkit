import { describe, test, expect } from "@jest/globals";
import {
  Rolling, RollingMean, RollingStd, RollingVar, RollingSum,
  RollingMin, RollingMax, RollingMedian, EMA,
} from "../src/index.js";

// Helper
const push = <T extends { push(v: number): T }>(obj: T, vals: number[]): T => {
  vals.forEach(v => obj.push(v));
  return obj;
};

// ── RollingMean ────────────────────────────────────────────────────────────

describe("RollingMean", () => {
  test("NaN before window fills", () => {
    const rm = new RollingMean({ window: 3 });
    rm.push(1); expect(isNaN(rm.value)).toBe(true);
    rm.push(2); expect(isNaN(rm.value)).toBe(true);
    rm.push(3); expect(rm.value).toBeCloseTo(2);
  });

  test("rolls correctly", () => {
    const rm = new RollingMean({ window: 3 });
    push(rm, [1, 2, 3]); expect(rm.value).toBeCloseTo(2);
    rm.push(4); expect(rm.value).toBeCloseTo(3); // [2,3,4]
    rm.push(5); expect(rm.value).toBeCloseTo(4); // [3,4,5]
  });

  test("window=1 always returns last value", () => {
    const rm = new RollingMean({ window: 1 });
    [1, 5, 3, 7].forEach(v => { rm.push(v); expect(rm.value).toBe(v); });
  });

  test("minPeriods=1 emits from first observation", () => {
    const rm = new RollingMean({ window: 5, minPeriods: 1 });
    rm.push(4); expect(rm.value).toBe(4);
    rm.push(2); expect(rm.value).toBeCloseTo(3);
  });

  test("rejects window < 1", () => {
    expect(() => new RollingMean({ window: 0 })).toThrow(RangeError);
  });

  test("reset clears state", () => {
    const rm = new RollingMean({ window: 3 });
    push(rm, [1, 2, 3]);
    rm.reset();
    expect(rm.count).toBe(0);
    expect(isNaN(rm.value)).toBe(true);
  });

  test("numerically stable with large values", () => {
    const rm = new RollingMean({ window: 3 });
    push(rm, [1e10, 1e10 + 1, 1e10 + 2]);
    expect(rm.value).toBeCloseTo(1e10 + 1, 0);
  });
});

// ── RollingStd / RollingVar ────────────────────────────────────────────────

describe("RollingStd", () => {
  test("NaN before window fills", () => {
    const rs = new RollingStd({ window: 3 });
    push(rs, [1, 2]); expect(isNaN(rs.value)).toBe(true);
    rs.push(3); expect(isNaN(rs.value)).toBe(false);
  });

  test("known std: [2,4,4,4,5,5,7,9] std=2", () => {
    const rs = new RollingStd({ window: 8 });
    push(rs, [2, 4, 4, 4, 5, 5, 7, 9]);
    // Sample std: sqrt(sum(xi-mean)^2 / (n-1))
    // mean=5, sum_sq_dev = 9+1+1+1+0+0+4+16 = 32, var=32/7 ≈ 4.571, std ≈ 2.138
    expect(rs.value).toBeCloseTo(2.138, 2);
  });

  test("rolling window updates correctly", () => {
    const rs = new RollingStd({ window: 3 });
    push(rs, [1, 2, 3]);
    const std123 = rs.value; // std of [1,2,3] = 1
    expect(std123).toBeCloseTo(1, 5);
    rs.push(4); // [2,3,4], std=1
    expect(rs.value).toBeCloseTo(1, 5);
  });

  test("ddof=0 (population std)", () => {
    const rs = new RollingStd({ window: 3, ddof: 0 });
    push(rs, [1, 2, 3]);
    // pop std of [1,2,3]: mean=2, var=(1+0+1)/3=2/3, std=sqrt(2/3)≈0.8165
    expect(rs.value).toBeCloseTo(Math.sqrt(2 / 3), 5);
  });
});

describe("RollingVar", () => {
  test("variance of [1,2,3] = 1", () => {
    const rv = new RollingVar({ window: 3 });
    push(rv, [1, 2, 3]);
    expect(rv.value).toBeCloseTo(1, 10);
  });
});

// ── RollingSum ─────────────────────────────────────────────────────────────

describe("RollingSum", () => {
  test("basic rolling sum", () => {
    const rs = new RollingSum({ window: 3 });
    push(rs, [1, 2, 3]);
    expect(rs.value).toBe(6);
    rs.push(4); expect(rs.value).toBe(9);
    rs.push(5); expect(rs.value).toBe(12);
  });

  test("NaN before window fills", () => {
    const rs = new RollingSum({ window: 3 });
    rs.push(1); expect(isNaN(rs.value)).toBe(true);
    rs.push(2); expect(isNaN(rs.value)).toBe(true);
  });

  test("minPeriods=1", () => {
    const rs = new RollingSum({ window: 3, minPeriods: 1 });
    rs.push(5); expect(rs.value).toBe(5);
    rs.push(3); expect(rs.value).toBe(8);
  });
});

// ── RollingMin ─────────────────────────────────────────────────────────────

describe("RollingMin", () => {
  test("rolling min with window=3", () => {
    const rm = new RollingMin({ window: 3 });
    push(rm, [3, 1, 2, 4, 5, 1, 6]);
    // After 3: min([3,1,2])=1
    // After 4: min([1,2,4])=1
    // After 5: min([2,4,5])=2
    // After 1: min([4,5,1])=1
    // After 6: min([5,1,6])=1
  });

  test("min across known sequence", () => {
    const rm = new RollingMin({ window: 3 });
    const results: number[] = [];
    [1, 3, 2, 5, 4].forEach(v => { rm.push(v); results.push(rm.value); });
    expect(results).toEqual([NaN, NaN, 1, 2, 2]);
  });

  test("min resets correctly", () => {
    const rm = new RollingMin({ window: 3 });
    push(rm, [5, 4, 3]);
    rm.reset();
    rm.push(10); expect(isNaN(rm.value)).toBe(true);
  });
});

// ── RollingMax ─────────────────────────────────────────────────────────────

describe("RollingMax", () => {
  test("max across known sequence", () => {
    const rm = new RollingMax({ window: 3 });
    const results: number[] = [];
    [1, 3, 2, 5, 4].forEach(v => { rm.push(v); results.push(rm.value); });
    expect(results).toEqual([NaN, NaN, 3, 5, 5]);
  });

  test("descending sequence", () => {
    const rm = new RollingMax({ window: 3 });
    push(rm, [5, 4, 3]); expect(rm.value).toBe(5);
    rm.push(2); expect(rm.value).toBe(4);
    rm.push(1); expect(rm.value).toBe(3);
  });
});

// ── RollingMedian ──────────────────────────────────────────────────────────

describe("RollingMedian", () => {
  test("odd window", () => {
    const rm = new RollingMedian({ window: 3 });
    push(rm, [3, 1, 2]); expect(rm.value).toBe(2); // sorted: [1,2,3]
  });

  test("even window", () => {
    const rm = new RollingMedian({ window: 4 });
    push(rm, [1, 3, 2, 4]); expect(rm.value).toBe(2.5); // sorted: [1,2,3,4]
  });

  test("rolling median", () => {
    const rm = new RollingMedian({ window: 3 });
    push(rm, [5, 1, 2]); expect(rm.value).toBe(2); // sorted [1,2,5] median=2
    rm.push(10); expect(rm.value).toBe(2); // window [1,2,10] sorted=[1,2,10] median=2
    rm.push(6);  expect(rm.value).toBe(6); // window [2,10,6] sorted=[2,6,10] median=6
  });

  test("quantile", () => {
    const rm = new RollingMedian({ window: 4 });
    push(rm, [1, 2, 3, 4]);
    expect(rm.quantile(0)).toBe(1);
    expect(rm.quantile(1)).toBe(4);
    expect(rm.quantile(0.5)).toBe(2.5);
    expect(rm.quantile(0.25)).toBeCloseTo(1.75, 5);
  });
});

// ── EMA ───────────────────────────────────────────────────────────────────

describe("EMA", () => {
  test("span=3, alpha=0.5", () => {
    const ema = new EMA({ span: 3 }); // alpha = 0.5
    ema.push(1); expect(ema.value).toBe(1);
    ema.push(3); expect(ema.value).toBeCloseTo(2, 5);  // 0.5*3 + 0.5*1
    ema.push(5); expect(ema.value).toBeCloseTo(3.5, 5); // 0.5*5 + 0.5*2
  });

  test("alpha=1 is same as latest value", () => {
    const ema = new EMA({ alpha: 1 });
    ema.push(10); expect(ema.value).toBe(10);
    ema.push(20); expect(ema.value).toBe(20);
    ema.push(15); expect(ema.value).toBe(15);
  });

  test("span=1 is same as latest value", () => {
    const ema = new EMA({ span: 1 }); // alpha = 1
    ema.push(5); expect(ema.value).toBe(5);
    ema.push(7); expect(ema.value).toBe(7);
  });

  test("rejects both span and alpha", () => {
    expect(() => new EMA({ span: 3, alpha: 0.5 })).toThrow();
  });

  test("rejects alpha out of range", () => {
    expect(() => new EMA({ alpha: 0 })).toThrow(RangeError);
    expect(() => new EMA({ alpha: 1.5 })).toThrow(RangeError);
  });

  test("rejects span < 1", () => {
    expect(() => new EMA({ span: 0 })).toThrow(RangeError);
  });

  test("NaN before any push", () => {
    const ema = new EMA({ span: 5 });
    expect(isNaN(ema.value)).toBe(true);
  });

  test("reset clears state", () => {
    const ema = new EMA({ span: 3 });
    push(ema, [1, 2, 3]);
    ema.reset();
    expect(isNaN(ema.value)).toBe(true);
  });
});

// ── Rolling (unified) ──────────────────────────────────────────────────────

describe("Rolling (unified)", () => {
  test("all stats in one pass", () => {
    const r = new Rolling({ window: 3 });
    push(r, [1, 2, 3]);
    expect(r.mean).toBeCloseTo(2);
    expect(r.sum).toBe(6);
    expect(r.min).toBe(1);
    expect(r.max).toBe(3);
    expect(r.std).toBeCloseTo(1);
    expect(r.variance).toBeCloseTo(1);
    expect(r.count).toBe(3);
    expect(r.window).toBe(3);
  });

  test("rolls all stats correctly", () => {
    const r = new Rolling({ window: 3 });
    push(r, [1, 2, 3]);
    r.push(4); // window [2,3,4]
    expect(r.mean).toBeCloseTo(3);
    expect(r.sum).toBe(9);
    expect(r.min).toBe(2);
    expect(r.max).toBe(4);
    expect(r.std).toBeCloseTo(1);
  });

  test("median and quantile", () => {
    const r = new Rolling({ window: 5 });
    push(r, [1, 2, 3, 4, 5]);
    expect(r.median).toBe(3);
    expect(r.quantile(0)).toBe(1);
    expect(r.quantile(1)).toBe(5);
    expect(r.quantile(0.5)).toBe(3);
  });

  test("NaN before minPeriods", () => {
    const r = new Rolling({ window: 3 });
    r.push(1);
    expect(isNaN(r.mean)).toBe(true);
    expect(isNaN(r.sum)).toBe(true);
    expect(isNaN(r.min)).toBe(true);
    expect(isNaN(r.max)).toBe(true);
  });

  test("minPeriods=1", () => {
    const r = new Rolling({ window: 3, minPeriods: 1 });
    r.push(5);
    expect(r.mean).toBe(5);
    expect(r.sum).toBe(5);
    expect(r.min).toBe(5);
    expect(r.max).toBe(5);
  });

  test("reset clears all state", () => {
    const r = new Rolling({ window: 3 });
    push(r, [1, 2, 3]);
    r.reset();
    expect(r.count).toBe(0);
    expect(isNaN(r.mean)).toBe(true);
  });

  test("values returns current window", () => {
    const r = new Rolling({ window: 3 });
    push(r, [1, 2, 3]);
    expect(r.values).toEqual([1, 2, 3]);
    r.push(4);
    expect(r.values).toEqual([2, 3, 4]);
  });
});

// ── Real-world: sensor data smoothing ─────────────────────────────────────

describe("Real-world: sensor data smoothing", () => {
  test("EMA smoother than raw", () => {
    // Noisy sensor readings
    const raw = [10, 12, 9, 11, 13, 8, 10, 11, 12, 10];
    const ema = new EMA({ span: 5 });
    const emaValues = raw.map(v => { ema.push(v); return ema.value; });

    // EMA should be smoother (smaller variation range)
    const rawRange = Math.max(...raw) - Math.min(...raw);
    const emaRange = Math.max(...emaValues) - Math.min(...emaValues);
    expect(emaRange).toBeLessThan(rawRange);
  });

  test("Rolling detects anomalies (3-sigma rule)", () => {
    const r = new Rolling({ window: 10, minPeriods: 10 });
    const normal = [10, 10.1, 9.9, 10.2, 9.8, 10.1, 9.9, 10.0, 10.1, 9.8];
    normal.forEach(v => r.push(v));

    const mean = r.mean;
    const std = r.std;

    // Push an anomaly
    const anomaly = 20;
    const isAnomaly = Math.abs(anomaly - mean) > 3 * std;
    expect(isAnomaly).toBe(true);

    // Push a normal value
    const normal2 = 10.3;
    const isNormal = Math.abs(normal2 - mean) <= 3 * std;
    expect(isNormal).toBe(true);
  });

  test("Rolling min/max for price range", () => {
    const priceWindow = new Rolling({ window: 5 });
    const prices = [100, 102, 98, 103, 101, 105, 99, 104];
    const ranges: number[] = [];

    prices.forEach(p => {
      priceWindow.push(p);
      if (!isNaN(priceWindow.min)) {
        ranges.push(priceWindow.max - priceWindow.min);
      }
    });

    // All ranges should be positive
    expect(ranges.every(r => r >= 0)).toBe(true);
    expect(ranges.length).toBe(prices.length - 4); // 5-1 = 4 warmup periods
  });
});
