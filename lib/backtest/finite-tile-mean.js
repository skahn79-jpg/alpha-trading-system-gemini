/**
 * GATE 6D shared three-stage finite equal-weighted mean.
 * Pure CommonJS. No I/O. No official error codes.
 * Stages: each value finite, sum finite, sum/n finite with n >= 1 integer.
 */

"use strict";

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function assertFiniteEqualWeightedMean(values) {
  if (!Array.isArray(values) || !Number.isInteger(values.length) || values.length < 1) {
    return { ok: false, mean: null, sum: null, n: 0 };
  }
  const n = values.length;
  for (let i = 0; i < n; i += 1) {
    if (!isFiniteNumber(values[i])) {
      return { ok: false, mean: null, sum: null, n };
    }
  }
  const sum = values.reduce((a, b) => a + b, 0);
  if (!isFiniteNumber(sum)) {
    return { ok: false, mean: null, sum: null, n };
  }
  const mean = sum / n;
  if (!isFiniteNumber(mean)) {
    return { ok: false, mean: null, sum, n };
  }
  return { ok: true, mean, sum, n };
}

module.exports = {
  assertFiniteEqualWeightedMean,
};
