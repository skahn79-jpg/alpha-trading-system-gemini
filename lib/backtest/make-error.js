/**
 * GATE 6H shared backtest error shape.
 * Pure CommonJS. No I/O. No official error codes.
 * Shape: { code, severity } with severity default "ERROR".
 * Copies only known extras; unknown extra keys are dropped.
 * GATE 6I freeze: known extras stay field, foldId, tradingDate, reason,
 * index, cause, candidateId, tradeId. Unknown extras dropped. No official codes.
 * GATE 6L: also copy recordIndex, symbol (leakage-guard fold).
 * GATE 6M: also copy tradeIndex, stage, market (multi-trade-lifecycle fold).
 */

"use strict";

const KNOWN_EXTRAS = Object.freeze([
  "field",
  "foldId",
  "tradingDate",
  "reason",
  "index",
  "cause",
  "candidateId",
  "tradeId",
  "recordIndex",
  "symbol",
  "tradeIndex",
  "stage",
  "market",
]);

function makeBacktestError(code, extra) {
  const err = {
    code,
    severity: extra && typeof extra.severity === "string" && extra.severity.length > 0
      ? extra.severity
      : "ERROR",
  };
  if (extra != null && typeof extra === "object" && !Array.isArray(extra)) {
    for (const key of KNOWN_EXTRAS) {
      if (Object.prototype.hasOwnProperty.call(extra, key) && extra[key] !== undefined) {
        err[key] = extra[key];
      }
    }
  }
  return err;
}

module.exports = {
  makeBacktestError,
};
