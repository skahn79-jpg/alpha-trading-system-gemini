"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { makeBacktestError } = require("../lib/backtest/make-error");
const { assertFiniteEqualWeightedMean } = require("../lib/backtest/finite-tile-mean");

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
    datasetVersion: "1",
    contentChecksum: "abc",
    metadataHash: "def",
    tradeIndex: 0,
    stage: "DATA",
    market: "SYNTHETIC_KOSPI",
    calendarId: "cal",
    calendarVersion: "1.0.0",
    dayStatus: "OPEN",
    sessionStatus: "REGULAR",
    policyId: "pol",
    policyVersion: "1",
    brokerChannel: "SYNTHETIC_ONLINE",
    currency: "KRW",
    taxType: "SEC",
    modelVersion: "daily-bar-execution-v0.1",
    orderType: "MARKET_OPEN",
    sequence: 1,
  });
  assert.deepEqual(Object.keys(err).sort(), [
    "brokerChannel",
    "calendarId",
    "calendarVersion",
    "candidateId",
    "cause",
    "code",
    "contentChecksum",
    "currency",
    "datasetId",
    "datasetVersion",
    "dayStatus",
    "field",
    "foldId",
    "index",
    "market",
    "metadataHash",
    "modelVersion",
    "orderType",
    "policyId",
    "policyVersion",
    "reason",
    "recordIndex",
    "sessionStatus",
    "severity",
    "stage",
    "symbol",
    "taxType",
    "tradeId",
    "tradeIndex",
    "tradingDate",
  ]);
  assert.equal(err.recordIndex, 9);
  assert.equal(err.symbol, "AAA");
  assert.equal(err.tradeIndex, 0);
  assert.equal(err.stage, "DATA");
  assert.equal(err.market, "SYNTHETIC_KOSPI");
  assert.equal(err.datasetId, "ds");
  assert.equal(err.datasetVersion, "1");
  assert.equal(err.contentChecksum, "abc");
  assert.equal(err.metadataHash, "def");
  assert.equal(err.calendarId, "cal");
  assert.equal(err.calendarVersion, "1.0.0");
  assert.equal(err.dayStatus, "OPEN");
  assert.equal(err.sessionStatus, "REGULAR");
  assert.equal(err.policyId, "pol");
  assert.equal(err.policyVersion, "1");
  assert.equal(err.brokerChannel, "SYNTHETIC_ONLINE");
  assert.equal(err.currency, "KRW");
  assert.equal(err.taxType, "SEC");
  assert.equal(err.modelVersion, "daily-bar-execution-v0.1");
  assert.equal(err.orderType, "MARKET_OPEN");
  assert.equal(Object.prototype.hasOwnProperty.call(err, "sequence"), false);
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
  const remaining = [];
  assert.deepEqual(remaining, []);
  const src = fs.readFileSync(path.join(root, "data-validation.js"), "utf8");
  assert.equal(src.includes("function makeError"), false);
  assert.equal(src.includes('require("./make-error")'), true);
  assert.equal(src.includes("makeBacktestError"), true);
});

test("GATE6O-U01 freeze known extras stay the 6N set and null candidateId still copies", () => {
  const err = makeBacktestError("ANY_CODE", {
    field: "meanOosTotalReturn",
    foldId: "WF-0001",
    tradingDate: "2101-03-01",
    reason: "DUPLICATE",
    index: 2,
    cause: "TRAIN_ROOT_A",
    candidateId: null,
    tradeId: "T1",
    recordIndex: 9,
    symbol: "AAA",
    tradeIndex: 0,
    stage: "DATA",
    market: "SYNTHETIC_KOSPI",
    datasetId: "ds",
    datasetVersion: "1",
    contentChecksum: "abc",
    metadataHash: "def",
    calendarId: "cal",
    calendarVersion: "1.0.0",
    dayStatus: "OPEN",
    sessionStatus: "REGULAR",
    policyId: "pol",
    policyVersion: "1",
    brokerChannel: "SYNTHETIC_ONLINE",
    currency: "KRW",
    taxType: "SEC",
    modelVersion: "daily-bar-execution-v0.1",
    orderType: "MARKET_OPEN",
    sequence: 1,
    leaked: "nope",
  });
  assert.deepEqual(Object.keys(err).sort(), [
    "brokerChannel",
    "calendarId",
    "calendarVersion",
    "candidateId",
    "cause",
    "code",
    "contentChecksum",
    "currency",
    "datasetId",
    "datasetVersion",
    "dayStatus",
    "field",
    "foldId",
    "index",
    "market",
    "metadataHash",
    "modelVersion",
    "orderType",
    "policyId",
    "policyVersion",
    "reason",
    "recordIndex",
    "sessionStatus",
    "severity",
    "stage",
    "symbol",
    "taxType",
    "tradeId",
    "tradeIndex",
    "tradingDate",
  ]);
  assert.equal(err.candidateId, null);
  assert.equal(err.severity, "ERROR");
  assert.equal(Object.prototype.hasOwnProperty.call(err, "sequence"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(err, "leaked"), false);
});

test("GATE6O-U02 freeze helper still has no official codes", () => {
  const src = fs.readFileSync(SRC_PATH, "utf8");
  assert.equal(src.includes("OOS_FOLD_FAILED"), false);
  assert.equal(src.includes("TRAIN_SELECTION_NONFINITE"), false);
  assert.equal(src.includes("OOS_EVALUATION_NONFINITE"), false);
  assert.equal(src.includes("WALK_FORWARD_AGGREGATE_NONFINITE"), false);
  assert.equal(src.includes("LEAKAGE_ERROR"), false);
  assert.equal(src.includes("INVALID_INPUT"), false);
  assert.equal(src.includes("ERROR_CODE"), false);
  assert.equal(src.includes("module.exports"), true);
  assert.equal(src.includes("makeBacktestError"), true);
  assert.equal(src.includes("GATE 6O freeze"), true);
});

test("GATE6O-U03 no private makeError remains in lib/backtest", () => {
  const root = path.join(__dirname, "..", "lib", "backtest");
  const files = fs.readdirSync(root).filter((name) => name.endsWith(".js")).sort();
  for (const name of files) {
    const src = fs.readFileSync(path.join(root, name), "utf8");
    assert.equal(src.includes("function makeError"), false, name);
  }
  const folded = [
    "walk-forward-validation.js",
    "train-parameter-selection.js",
    "performance-metrics.js",
    "benchmark-performance.js",
    "portfolio-ledger.js",
    "leakage-guard.js",
    "multi-trade-lifecycle.js",
    "data-validation.js",
  ];
  for (const name of folded) {
    const src = fs.readFileSync(path.join(root, name), "utf8");
    assert.equal(src.includes('require("./make-error")'), true, name);
    assert.equal(src.includes("makeBacktestError"), true, name);
  }
});

test("GATE6O-U04 finite-tile-mean still has no reason or stage", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "backtest", "finite-tile-mean.js"), "utf8");
  assert.equal(src.includes("No reason/stage"), true);
  const ok = assertFiniteEqualWeightedMean([1, 2, 3]);
  assert.deepEqual(Object.keys(ok).sort(), ["mean", "n", "ok", "sum"]);
  assert.equal(Object.prototype.hasOwnProperty.call(ok, "reason"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(ok, "stage"), false);
  const bad = assertFiniteEqualWeightedMean([1, Number.NaN]);
  assert.equal(bad.ok, false);
  assert.equal(Object.prototype.hasOwnProperty.call(bad, "reason"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(bad, "stage"), false);
});

test("GATE6T-U01 freeze known extras stay the 6R set and null candidateId still copies", () => {
  const err = makeBacktestError("ANY_CODE", {
    field: "meanOosTotalReturn",
    foldId: "WF-0001",
    tradingDate: "2101-03-01",
    reason: "DUPLICATE",
    index: 2,
    cause: "TRAIN_ROOT_A",
    candidateId: null,
    tradeId: "T1",
    recordIndex: 9,
    symbol: "AAA",
    tradeIndex: 0,
    stage: "DATA",
    market: "SYNTHETIC_KOSPI",
    datasetId: "ds",
    datasetVersion: "1",
    contentChecksum: "abc",
    metadataHash: "def",
    calendarId: "cal",
    calendarVersion: "1.0.0",
    dayStatus: "OPEN",
    sessionStatus: "REGULAR",
    policyId: "pol",
    policyVersion: "1",
    brokerChannel: "SYNTHETIC_ONLINE",
    currency: "KRW",
    taxType: "SEC",
    modelVersion: "daily-bar-execution-v0.1",
    orderType: "MARKET_OPEN",
    sequence: 1,
    leaked: "nope",
  });
  assert.deepEqual(Object.keys(err).sort(), [
    "brokerChannel",
    "calendarId",
    "calendarVersion",
    "candidateId",
    "cause",
    "code",
    "contentChecksum",
    "currency",
    "datasetId",
    "datasetVersion",
    "dayStatus",
    "field",
    "foldId",
    "index",
    "market",
    "metadataHash",
    "modelVersion",
    "orderType",
    "policyId",
    "policyVersion",
    "reason",
    "recordIndex",
    "sessionStatus",
    "severity",
    "stage",
    "symbol",
    "taxType",
    "tradeId",
    "tradeIndex",
    "tradingDate",
  ]);
  assert.equal(err.candidateId, null);
  assert.equal(err.severity, "ERROR");
  assert.equal(Object.prototype.hasOwnProperty.call(err, "sequence"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(err, "leaked"), false);
});

test("GATE6T-U02 freeze helper still has no official codes", () => {
  const src = fs.readFileSync(SRC_PATH, "utf8");
  assert.equal(src.includes("OOS_FOLD_FAILED"), false);
  assert.equal(src.includes("TRAIN_SELECTION_NONFINITE"), false);
  assert.equal(src.includes("OOS_EVALUATION_NONFINITE"), false);
  assert.equal(src.includes("WALK_FORWARD_AGGREGATE_NONFINITE"), false);
  assert.equal(src.includes("LEAKAGE_ERROR"), false);
  assert.equal(src.includes("INVALID_INPUT"), false);
  assert.equal(src.includes("ERROR_CODE"), false);
  assert.equal(src.includes("module.exports"), true);
  assert.equal(src.includes("makeBacktestError"), true);
  assert.equal(src.includes("GATE 6O freeze"), true);
  assert.equal(src.includes("GATE 6T freeze"), true);
});

test("GATE6T-U03 four makeSafe adapters require the helper and no private makeError remains", () => {
  const root = path.join(__dirname, "..", "lib", "backtest");
  const files = fs.readdirSync(root).filter((name) => name.endsWith(".js")).sort();
  const found = [];
  for (const name of files) {
    const src = fs.readFileSync(path.join(root, name), "utf8");
    assert.equal(src.includes("function makeError"), false, name);
    const matches = src.match(/function makeSafe[A-Za-z]+/g) || [];
    for (const match of matches) {
      found.push(`${name}:${match}`);
    }
  }
  assert.deepEqual(found, [
    "calendar-validation.js:function makeSafeCalendarError",
    "cost-policy.js:function makeSafeCostError",
    "execution-model.js:function makeSafeExecutionError",
    "synthetic-pipeline.js:function makeSafePipelineError",
  ]);
  const adapters = [
    "calendar-validation.js",
    "cost-policy.js",
    "execution-model.js",
    "synthetic-pipeline.js",
  ];
  for (const name of adapters) {
    const src = fs.readFileSync(path.join(root, name), "utf8");
    assert.equal(src.includes('require("./make-error")'), true, name);
    assert.equal(src.includes("const err = makeBacktestError(raw.code, extra)"), true, name);
  }
});

test("GATE6T-U04 finite-tile-mean still has no reason or stage", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "backtest", "finite-tile-mean.js"), "utf8");
  assert.equal(src.includes("No reason/stage"), true);
  const ok = assertFiniteEqualWeightedMean([1, 2, 3]);
  assert.deepEqual(Object.keys(ok).sort(), ["mean", "n", "ok", "sum"]);
  assert.equal(Object.prototype.hasOwnProperty.call(ok, "reason"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(ok, "stage"), false);
  const bad = assertFiniteEqualWeightedMean([1, Number.NaN]);
  assert.equal(bad.ok, false);
  assert.equal(Object.prototype.hasOwnProperty.call(bad, "reason"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(bad, "stage"), false);
});


test("GATE6U-R4-H01 object extra.cause is not copied and does not alias", () => {
  const nested = { nested: 1 };
  const err = makeBacktestError("ANY_CODE", { cause: nested });
  assert.equal(Object.prototype.hasOwnProperty.call(err, "cause"), false);
  nested.nested = 99;
  assert.equal(Object.prototype.hasOwnProperty.call(err, "cause"), false);
  assert.equal(err.code, "ANY_CODE");
});

test("GATE6U-R4-H02 scalar extras still copy", () => {
  const err = makeBacktestError("ANY_CODE", {
    field: "trainTotalReturn",
    foldId: "WF-0001",
    cause: "R2A_TRAIN_ROOT",
  });
  assert.equal(err.field, "trainTotalReturn");
  assert.equal(err.foldId, "WF-0001");
  assert.equal(err.cause, "R2A_TRAIN_ROOT");
});

test("GATE6U-R4-H03 null field copies; undefined field is omitted", () => {
  const withNull = makeBacktestError("ANY_CODE", { field: null });
  assert.equal(Object.prototype.hasOwnProperty.call(withNull, "field"), true);
  assert.equal(withNull.field, null);
  const withUndef = makeBacktestError("ANY_CODE", { field: undefined });
  assert.equal(Object.prototype.hasOwnProperty.call(withUndef, "field"), false);
});

test("GATE6U-R4-H04 helper return is not frozen so adapters can mutate", () => {
  const err = makeBacktestError("ANY_CODE", { field: "meanOosTotalReturn" });
  assert.equal(Object.isFrozen(err), false);
  err.severity = "ERROR";
  delete err.code;
  assert.equal(Object.prototype.hasOwnProperty.call(err, "code"), false);
  assert.equal(err.severity, "ERROR");
  assert.equal(err.field, "meanOosTotalReturn");
});

test("GATE6U-R4-A01 makeSafe adapters still drop code on non-object and keep delete err.code", () => {
  const { makeSafeCalendarError } = require("../lib/backtest/calendar-validation");
  const raw = makeSafeCalendarError(null);
  assert.deepEqual(raw, { severity: "ERROR" });
  assert.equal(Object.prototype.hasOwnProperty.call(raw, "code"), false);
  const root = path.join(__dirname, "..", "lib", "backtest");
  for (const name of [
    "calendar-validation.js",
    "cost-policy.js",
    "execution-model.js",
    "synthetic-pipeline.js",
  ]) {
    const src = fs.readFileSync(path.join(root, name), "utf8");
    assert.equal(src.includes("delete err.code"), true, name);
  }
});


test("GATE6V-H01 freeze helper drops object cause, copies scalar/null, is not frozen", () => {
  const nested = { nested: 1 };
  const dropped = makeBacktestError("ANY_CODE", { cause: nested, field: "trainTotalReturn" });
  assert.equal(Object.prototype.hasOwnProperty.call(dropped, "cause"), false);
  assert.equal(dropped.field, "trainTotalReturn");
  nested.nested = 99;
  assert.equal(Object.prototype.hasOwnProperty.call(dropped, "cause"), false);

  const withNull = makeBacktestError("ANY_CODE", { field: null });
  assert.equal(withNull.field, null);
  assert.equal(Object.isFrozen(dropped), false);
  dropped.severity = "ERROR";
  delete dropped.code;
  assert.equal(Object.prototype.hasOwnProperty.call(dropped, "code"), false);

  const src = fs.readFileSync(SRC_PATH, "utf8");
  assert.equal(src.includes("GATE 6V freeze"), true);
  const extras = [
    "field", "foldId", "tradingDate", "reason", "index", "cause", "candidateId",
    "tradeId", "recordIndex", "symbol", "tradeIndex", "stage", "market",
    "datasetId", "datasetVersion", "contentChecksum", "metadataHash",
    "calendarId", "calendarVersion", "dayStatus", "sessionStatus",
    "policyId", "policyVersion", "brokerChannel", "currency", "taxType",
    "modelVersion", "orderType",
  ];
  let pos = 0;
  for (const key of extras) {
    const next = src.indexOf('"' + key + '"', pos);
    assert.equal(next > -1, true, key);
    pos = next + 1;
  }
});

test("GATE6V-A01 freeze adapters still delete err.code; calendar null has no code", () => {
  const { makeSafeCalendarError } = require("../lib/backtest/calendar-validation");
  const raw = makeSafeCalendarError(null);
  assert.deepEqual(raw, { severity: "ERROR" });
  assert.equal(Object.prototype.hasOwnProperty.call(raw, "code"), false);
  const backtestRoot = path.join(__dirname, "..", "lib", "backtest");
  for (const name of [
    "calendar-validation.js",
    "cost-policy.js",
    "execution-model.js",
    "synthetic-pipeline.js",
  ]) {
    const src = fs.readFileSync(path.join(backtestRoot, name), "utf8");
    assert.equal(src.includes("delete err.code"), true, name);
  }
});


test("GATE6W-V01 helper freeze still drops object cause and is not frozen", () => {
  const nested = { nested: 1 };
  const err = makeBacktestError("ANY_CODE", { cause: nested, field: "trainTotalReturn" });
  assert.equal(Object.prototype.hasOwnProperty.call(err, "cause"), false);
  assert.equal(err.field, "trainTotalReturn");
  assert.equal(Object.isFrozen(err), false);
  const src = fs.readFileSync(SRC_PATH, "utf8");
  assert.equal(src.includes("GATE 6V freeze"), true);
});
