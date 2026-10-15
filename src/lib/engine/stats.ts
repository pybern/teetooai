export function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

export function mean(xs: number[]): number {
  return xs.length ? sum(xs) / xs.length : NaN;
}

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
}

export function pctChange(from: number, to: number): number {
  if (from === 0) return NaN;
  return ((to - from) / Math.abs(from)) * 100;
}

export function cagr(from: number, to: number, periods: number): number {
  if (from <= 0 || to <= 0 || periods <= 0) return NaN;
  return ((to / from) ** (1 / periods) - 1) * 100;
}

export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return NaN;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : NaN;
}

export type Fit = {
  slope: number;
  intercept: number;
  r2: number;
  residualSd: number;
  predict: (x: number) => number;
  model: "linear" | "exponential" | "logistic";
};

export function linearFit(xs: number[], ys: number[]): Fit {
  const n = xs.length;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const slope = sxx ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  const predict = (x: number) => intercept + slope * x;
  const ssTot = sum(ys.map((y) => (y - my) ** 2));
  const residuals = ys.map((y, i) => y - predict(xs[i]));
  const ssRes = sum(residuals.map((r) => r * r));
  return {
    slope,
    intercept,
    r2: ssTot ? 1 - ssRes / ssTot : 1,
    residualSd: n > 2 ? Math.sqrt(ssRes / (n - 2)) : 0,
    predict,
    model: "linear",
  };
}

/** Log-linear fit, with r² and residual spread measured in original units so it is comparable to linearFit. */
export function exponentialFit(xs: number[], ys: number[]): Fit | null {
  if (ys.some((y) => y <= 0)) return null;
  const lin = linearFit(xs, ys.map(Math.log));
  const predict = (x: number) => Math.exp(lin.predict(x));
  const my = mean(ys);
  const ssTot = sum(ys.map((y) => (y - my) ** 2));
  const residuals = ys.map((y, i) => y - predict(xs[i]));
  const ssRes = sum(residuals.map((r) => r * r));
  return {
    slope: lin.slope,
    intercept: lin.intercept,
    r2: ssTot ? 1 - ssRes / ssTot : 1,
    residualSd: xs.length > 2 ? Math.sqrt(ssRes / (xs.length - 2)) : 0,
    predict,
    model: "exponential",
  };
}

/** Logistic (S-curve) fit with a known ceiling, linearized as ln(y / (K - y)). */
export function logisticFit(xs: number[], ys: number[], ceiling: number): Fit | null {
  if (ys.some((y) => y <= 0 || y >= ceiling)) return null;
  const lin = linearFit(xs, ys.map((y) => Math.log(y / (ceiling - y))));
  const predict = (x: number) => ceiling / (1 + Math.exp(-lin.predict(x)));
  const my = mean(ys);
  const ssTot = sum(ys.map((y) => (y - my) ** 2));
  const ssRes = sum(ys.map((y, i) => (y - predict(xs[i])) ** 2));
  return {
    slope: lin.slope,
    intercept: lin.intercept,
    r2: ssTot ? 1 - ssRes / ssTot : 1,
    residualSd: xs.length > 2 ? Math.sqrt(ssRes / (xs.length - 2)) : 0,
    predict,
    model: "logistic",
  };
}

export function zScores(xs: number[]): number[] {
  const m = mean(xs);
  const s = stdev(xs);
  return xs.map((x) => (s ? (x - m) / s : 0));
}

export function correlationLabel(r: number): string {
  const a = Math.abs(r);
  const dir = r >= 0 ? "positive" : "negative";
  if (a >= 0.8) return `very strong ${dir}`;
  if (a >= 0.6) return `strong ${dir}`;
  if (a >= 0.4) return `moderate ${dir}`;
  if (a >= 0.2) return `weak ${dir}`;
  return "negligible";
}

export function round(x: number, d = 2): number {
  const p = 10 ** d;
  return Math.round(x * p) / p;
}
