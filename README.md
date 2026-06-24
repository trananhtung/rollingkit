# rollingkit

[![All Contributors](https://img.shields.io/badge/all_contributors-1-orange.svg?style=flat-square)](#contributors-)

Zero-dependency sliding window / rolling statistics for TypeScript: mean, variance, stddev, min, max, sum, median, percentile, EMA. O(1) per sample for all except median. Port of Python `pandas.Series.rolling()` / R `zoo`.

[![npm](https://img.shields.io/npm/v/rollingkit)](https://www.npmjs.com/package/rollingkit)
[![license](https://img.shields.io/npm/l/rollingkit)](LICENSE)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](package.json)

## Install

```bash
npm install rollingkit
```

## Why?

- `pandas.Series.rolling()` — 160M/week PyPI — the gold standard for rolling stats
- R `zoo::rollapply()` — widely used in time-series analysis
- npm — no zero-dep TypeScript rolling stats package existed before rollingkit

## Quick start

```typescript
import { Rolling } from "rollingkit";

const r = new Rolling({ window: 3 });

r.push(1); r.push(2); r.push(3);

r.mean;    // 2
r.sum;     // 6
r.min;     // 1
r.max;     // 3
r.std;     // 1
r.median;  // 2

r.push(4); // window slides: [2, 3, 4]
r.mean;    // 3
r.min;     // 2
r.max;     // 4
```

## Individual statistics

Each statistic has its own O(1) class for minimal memory:

```typescript
import { RollingMean, RollingStd, RollingMin, RollingMax, RollingSum } from "rollingkit";

const mean = new RollingMean({ window: 5 });
const std  = new RollingStd({ window: 5 });
const min  = new RollingMin({ window: 5 });
const max  = new RollingMax({ window: 5 });
const sum  = new RollingSum({ window: 5 });

const values = [3, 1, 4, 1, 5, 9, 2, 6];
for (const v of values) {
  mean.push(v); std.push(v); min.push(v); max.push(v); sum.push(v);
}

mean.value; // rolling mean of last 5 values
std.value;  // rolling sample std dev
min.value;  // rolling minimum
max.value;  // rolling maximum
sum.value;  // rolling sum
```

## Exponential Moving Average

```typescript
import { EMA } from "rollingkit";

// span: same as pandas ewm(span=N)
// alpha = 2 / (span + 1)
const ema5 = new EMA({ span: 5 });   // α = 1/3
const ema20 = new EMA({ span: 20 }); // α = 2/21

// Or specify alpha directly:
const ema = new EMA({ alpha: 0.1 }); // slow decay

const prices = [100, 102, 98, 103, 101, 105];
prices.forEach(p => { ema5.push(p); ema20.push(p); });

ema5.value;  // fast-responding EMA
ema20.value; // slow-responding EMA
```

## API

### `Rolling` — unified (computes all stats in one pass)

```typescript
const r = new Rolling({ window: 10, minPeriods: 5 });
// minPeriods: emit values after this many observations (default: window)
// Set minPeriods: 1 to emit from the very first sample.

r.push(value);    // add observation, chainable
r.mean            // rolling mean
r.sum             // rolling sum
r.min             // rolling minimum (O(1) amortized via monotonic deque)
r.max             // rolling maximum (O(1) amortized via monotonic deque)
r.std             // rolling sample std dev (Welford's algorithm)
r.variance        // rolling sample variance
r.median          // rolling median (O(n log n))
r.quantile(0.75)  // rolling 75th percentile (O(n log n))
r.count           // number of samples in current window
r.window          // configured window size
r.values          // current window as number[]
r.reset()         // clear all state
```

All stats return `NaN` until `minPeriods` observations have been pushed.

### `RollingMean`

```typescript
const rm = new RollingMean({ window: 10 });
rm.push(42);
rm.value;   // mean of last 10 values
rm.count;   // number in window
rm.reset();
```

### `RollingStd` / `RollingVar`

```typescript
const rs = new RollingStd({ window: 10, ddof: 1 }); // ddof=1 (sample), ddof=0 (population)
rs.push(v);
rs.value;    // rolling std dev
rs.variance; // rolling variance
```

### `RollingSum`

```typescript
const rs = new RollingSum({ window: 10 });
rs.push(v);
rs.value; // rolling sum
```

### `RollingMin` / `RollingMax`

Uses a monotonic deque for O(1) amortized updates (same as Python `collections.deque`):

```typescript
const min = new RollingMin({ window: 10 });
const max = new RollingMax({ window: 10 });
min.push(v); min.value; // O(1) amortized
max.push(v); max.value; // O(1) amortized
```

### `RollingMedian`

```typescript
const rm = new RollingMedian({ window: 10 });
rm.push(v);
rm.value;          // rolling median
rm.quantile(0.25); // rolling 25th percentile
```

### `EMA`

```typescript
const ema = new EMA({ span: 10 });           // α = 2/(10+1)
const ema = new EMA({ alpha: 0.2 });          // explicit α
const ema = new EMA({ span: 5, adjust: true }); // pandas-style adjusted EMA

ema.push(v);
ema.value;   // current EMA
ema.alpha;   // α value
ema.reset();
```

## Use cases

### Real-time sensor data

```typescript
import { Rolling, EMA } from "rollingkit";

// Short-term anomaly detection
const shortWindow = new Rolling({ window: 10 });
const longEma = new EMA({ span: 50 });

function processSensorReading(value: number) {
  shortWindow.push(value);
  longEma.push(value);

  if (shortWindow.count >= 10) {
    const zScore = (value - shortWindow.mean) / shortWindow.std;
    if (Math.abs(zScore) > 3) {
      console.warn(`Anomaly detected: ${value} (z=${zScore.toFixed(2)})`);
    }
  }
}
```

### Moving average crossover (trading signal)

```typescript
import { EMA } from "rollingkit";

const fast = new EMA({ span: 12 }); // 12-period EMA
const slow = new EMA({ span: 26 }); // 26-period EMA

let prevCrossover: "above" | "below" | null = null;

function onPrice(price: number) {
  fast.push(price);
  slow.push(price);

  const crossover = fast.value > slow.value ? "above" : "below";
  if (prevCrossover && crossover !== prevCrossover) {
    console.log(crossover === "above" ? "BUY signal" : "SELL signal");
  }
  prevCrossover = crossover;
}
```

### Bandwidth utilization (5-minute rolling average)

```typescript
import { RollingMean } from "rollingkit";

const window5min = new RollingMean({ window: 5, minPeriods: 1 });

// Called every minute with bytes/s
function onSample(bytesPerSec: number) {
  window5min.push(bytesPerSec);
  const avgMbps = (window5min.value * 8) / 1_000_000;
  console.log(`5-min avg: ${avgMbps.toFixed(2)} Mbps`);
}
```

### Min-max range for candlestick chart

```typescript
import { Rolling } from "rollingkit";

const r = new Rolling({ window: 20 });

prices.forEach(price => {
  r.push(price);
  if (!isNaN(r.min)) {
    const candle = {
      open: r.values[0],
      close: r.values[r.values.length - 1],
      high: r.max,
      low: r.min,
    };
  }
});
```

## Algorithms

| Statistic | Algorithm | Time per push | Space |
|---|---|---|---|
| Mean | Welford's online | O(1) | O(window) |
| Variance / Std | Welford's online | O(1) | O(window) |
| Sum | Running total | O(1) | O(window) |
| Min / Max | Monotonic deque | O(1) amortized | O(window) |
| Median | Sort on read | O(n log n) | O(window) |
| Quantile | Sort on read | O(n log n) | O(window) |
| EMA | Recursive formula | O(1) | O(1) |

**Welford's algorithm** computes mean and variance in a single pass with excellent numerical stability — no catastrophic cancellation even for values near 1e15.

**Monotonic deque** for min/max: maintains a deque of "useful" candidates in O(1) amortized by amortizing O(n) worst-case pops across n pushes.

## Contributors ✨

This project follows the [all-contributors](https://github.com/all-contributors/all-contributors) specification. Contributions of any kind are welcome — code, docs, bug reports, ideas, reviews! See the [emoji key](https://allcontributors.org/docs/en/emoji-key) for how each contribution is recognized, and open a PR or issue to get involved.

Thanks goes to these wonderful people:

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/trananhtung"><img src="https://avatars.githubusercontent.com/u/30992229?v=4?s=100" width="100px;" alt="Tung Tran"/><br /><sub><b>Tung Tran</b></sub></a><br /><a href="https://github.com/trananhtung/rollingkit/commits?author=trananhtung" title="Code">💻</a> <a href="#maintenance-trananhtung" title="Maintenance">🚧</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

## License

MIT
