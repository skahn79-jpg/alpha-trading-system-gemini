"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { makeBacktestError } = require("../lib/backtest/make-error");

const SRC_PATH = path.join(__dirname, "..", "lib", "backtest", "make-error.js");

test("GATE6H-U01 default severity is ERROR and unknown extras are dropped", () => {
  const err = makeBacktestError("ANY_CODE", {
    field: "meanOosTotalReturn",
    foldId: "WF-0001",
    tradingDate: "2101-03-01",
    reason: "DUPLICATE",
    index: 2,
    cause: "TRAIN_ROOT_A",
    candidateId: "P001",
    tradeId: "T1",
    leaked: "nope",
    details: { nested: true },
  });
  assert.equal(err.code, "ANY_CODE");
  assert.equal(err.severity, "ERROR");
  assert.equal(err.field, "meanOosTotalReturn");
  assert.equal(err.foldId, "WF-0001");
  assert.equal(err.tradingDate, "2101-03-01");
  assert.equal(err.reason, "DUPLICATE");
  assert.equal(err.index, 2);
  assert.equal(err.cause, "TRAIN_ROOT_A");
  assert.equal(err.candidateId, "P001");
  assert.equal(err.tradeId, "T1");
  assert.equal(Object.prototype.hasOwnProperty.call(err, "leaked"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(err, "details"), false);
});

test("GATE6H-U02 missing extra still yields code + ERROR", () => {
  const err = makeBacktestError("INVALID_INPUT");
  assert.deepEqual(err, { code: "INVALID_INPUT", severity: "ERROR" });
});

test("GATE6H-U03 null candidateId is copied; undefined keys are omitted", () => {
  const err = makeBacktestError("TRAIN_CANDIDATE_EVALUATION_FAILED", {
    candidateId: null,
    field: undefined,
  });
  assert.equal(err.candidateId, null);
  assert.equal(Object.prototype.hasOwnProperty.call(err, "field"), false);
});

test("GATE6H-U04 helper has no official error codes", () => {
  const src = fs.readFileSync(SRC_PATH, "utf8");
  assert.equal(src.includes("OOS_FOLD_FAILED"), false);
  assert.equal(src.includes("TRAIN_SELECTION_NONFINITE"), false);
  assert.equal(src.includes("OOS_EVALUATION_NONFINITE"), false);
  assert.equal(src.includes("WALK_FORWARD_AGGREGATE_NONFINITE"), false);
  assert.equal(src.includes("LEAKAGE_ERROR"), false);
});

test("GATE6I-U01 freeze known extras stay exact and unknown extras stay dropped", () => {
  const err = makeBacktestError("ANY_CODE", {
    field: "meanOosTotalReturn",
    foldId: "WF-0001",
    tradingDate: "2101-03-01",
    reason: "DUPLICATE",
    index: 2,
    cause: "TRAIN_ROOT_A",
    candidateId: "P001",
    tradeId: "T1",
    recordIndex: 9,
    symbol: "AAA",
    datasetId: "ds",
    tradeIndex: 0,
    stage: "TRAIN",
    sequence: 1,
  });
  assert.deepEqual(Object.keys(err).sort(), [
    "candidateId",
    "cause",
    "code",
    "field",
    "foldId",
    "index",
    "reason",
    "severity",
    "tradeId",
    "tradingDate",
  ]);
  assert.equal(err.severity, "ERROR");
});

test("GATE6I-U02 freeze helper still has no official codes", () => {
  const src = fs.readFileSync(SRC_PATH, "utf8");
  assert.equal(src.includes("OOS_FOLD_FAILED"), false);
  assert.equal(src.includes("TRAIN_SELECTION_NONFINITE"), false);
  assert.equal(src.includes("OOS_EVALUATION_NONFINITE"), false);
  assert.equal(src.includes("WALK_FORWARD_AGGREGATE_NONFINITE"), false);
  assert.equal(src.includes("LEAKAGE_ERROR"), false);
  assert.equal(src.includes("module.exports"), true);
  assert.equal(src.includes("makeBacktestError"), true);
});

test("GATE6I-U03 freeze does not expand makeError into other modules", () => {
  const root = path.join(__dirname, "..", "lib", "backtest");
  for (const name of [
    "data-validation.js",
    "leakage-guard.js",
    "multi-trade-lifecycle.js",
    "portfolio-ledger.js",
  ]) {
    const src = fs.readFileSync(path.join(root, name), "utf8");
    assert.equal(src.includes("function makeError"), true, name);
    assert.equal(src.includes('require("./make-error")'), false, name);
  }
});
