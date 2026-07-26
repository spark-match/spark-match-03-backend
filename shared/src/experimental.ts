// =============================================================================
// experimental - intentionally uncovered functions (P3 stress test only)
// =============================================================================
// This module exists ONLY to validate QG enforcement on uncovered code. It
// introduces ~120 lines of code without tests to push coverage below the 80%
// threshold. It should be REMOVED after the validation completes.
//
// Functions:
//   - composeGreeting: small helper
//   - buildMatrix: returns a numeric matrix
//   - transpose: matrix math
//   - multiplyMatrices: matrix math
//   - detectAnomalies: simple statistics
//   - summarize: aggregates
// =============================================================================

export interface Matrix {
  rows: number;
  cols: number;
  data: number[][];
}

export interface Stats {
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
}

export function composeGreeting(name: string, time: 'morning' | 'afternoon' | 'evening'): string {
  if (time === 'morning') return `Good morning, ${name}!`;
  if (time === 'afternoon') return `Good afternoon, ${name}!`;
  return `Good evening, ${name}!`;
}

export function buildMatrix(rows: number, cols: number, fill: () => number): Matrix {
  const data: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: number[] = [];
    for (let c = 0; c < cols; c++) row.push(fill());
    data.push(row);
  }
  return { rows, cols, data };
}

export function transpose(m: Matrix): Matrix {
  const out: number[][] = [];
  for (let c = 0; c < m.cols; c++) {
    const row: number[] = [];
    for (let r = 0; r < m.rows; r++) row.push(m.data[r]![c]!);
    out.push(row);
  }
  return { rows: m.cols, cols: m.rows, data: out };
}

export function multiplyMatrices(a: Matrix, b: Matrix): Matrix {
  if (a.cols !== b.rows) throw new Error(`dimension mismatch: ${a.cols} != ${b.rows}`);
  const out: number[][] = [];
  for (let r = 0; r < a.rows; r++) {
    const row: number[] = [];
    for (let c = 0; c < b.cols; c++) {
      let sum = 0;
      for (let k = 0; k < a.cols; k++) sum += a.data[r]![k]! * b.data[k]![c]!;
      row.push(sum);
    }
    out.push(row);
  }
  return { rows: a.rows, cols: b.cols, data: out };
}

export function summarize(values: number[]): Stats {
  if (values.length === 0) return { count: 0, sum: 0, min: 0, max: 0, avg: 0 };
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return {
    count: values.length,
    sum,
    min,
    max,
    avg: sum / values.length,
  };
}

export function detectAnomalies(values: number[], threshold = 2): number[] {
  const s = summarize(values);
  if (s.count === 0) return [];
  const anomalies: number[] = [];
  for (const v of values) {
    const deviation = Math.abs(v - s.avg);
    if (deviation > threshold * Math.max(1, s.max - s.min)) anomalies.push(v);
  }
  return anomalies;
}

export function normalizeScores(scores: Record<string, number>): Record<string, number> {
  const vals = Object.values(scores);
  const s = summarize(vals);
  const range = s.max - s.min || 1;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(scores)) out[k] = (v - s.min) / range;
  return out;
}
