"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PAPER_MODE,
  ERROR,
} = require("../lib/paper/paper-result");
const {
  isPlainObject,
  isSafeInteger,
  isNonNegSafeInt,
  isPosSafeInt,
  hasOwnRecordKey,
  setOwnRecordKey,
  deleteOwnRecordKey,
  copyRecord,
  validatePaperAccountState,
  createPaperAccountState,
  clonePaperAccountState,
} = require("../lib/paper/paper-account-state");

function hasCode(result, code) {
  return (result.errorCodes && result.errorCodes.includes(code))
    || (result.errors && result.errors.some((err) => err.code === code));
}

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("C01 create/validate valid paper account state", () => {
  const state = createPaperAccountState({
    accountId: "paper-acc-1",
    initialCash: 1_000_000,
  });
  const result = validatePaperAccountState(state);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.state.accountId, "paper-acc-1");
  assert.equal(result.state.mode, PAPER_MODE.PAPER);
  assert.equal(result.state.initialCash, 1_000_000);
  assert.equal(result.state.cash, 1_000_000);
  assert.deepEqual(result.state.positions, {});
  assert.equal(result.state.realizedPnl, 0);
  assert.deepEqual(result.state.closedTrades, []);
  assert.equal(result.state.lastProcessedSequence, null);
  assert.equal(result.state.lastProcessedEventId, null);
  assert.deepEqual(result.state.executedIntentIds, {});
  assert.equal(Object.isFrozen(result.state), true);
});

test("C01 helpers: isPlainObject proto Object.prototype or null, not Array", () => {
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject(Object.create(null)), true);
  assert.equal(isPlainObject([]), false);
  assert.equal(isPlainObject(null), false);
  assert.equal(isPlainObject(Object.create({ a: 1 })), false);
  assert.equal(isSafeInteger(0), true);
  assert.equal(isSafeInteger("0"), false);
  assert.equal(isSafeInteger(Object(10)), false);
  assert.equal(isNonNegSafeInt(0), true);
  assert.equal(isNonNegSafeInt(-1), false);
  assert.equal(isPosSafeInt(1), true);
  assert.equal(isPosSafeInt(0), false);
});

test("C02 malformed missing mode", () => {
  const state = createPaperAccountState({ accountId: "paper-acc-1", initialCash: 1_000_000 });
  delete state.mode;
  const result = validatePaperAccountState(state);
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.PAPER_MODE_INVALID), true);
  assert.equal(result.state, null);
});

test("C02 malformed mode LIVE", () => {
  const state = createPaperAccountState({ accountId: "paper-acc-1", initialCash: 1_000_000 });
  state.mode = "LIVE";
  const result = validatePaperAccountState(state);
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.PAPER_MODE_INVALID), true);
});

test("C02 malformed string cash", () => {
  const state = createPaperAccountState({ accountId: "paper-acc-1", initialCash: 1_000_000 });
  state.cash = "1000000";
  const result = validatePaperAccountState(state);
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.PAPER_INVALID_INPUT), true);
});

test("C02 malformed boxed Number cash", () => {
  const state = createPaperAccountState({ accountId: "paper-acc-1", initialCash: 1_000_000 });
  state.cash = Object(1_000_000);
  const result = validatePaperAccountState(state);
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.PAPER_INVALID_INPUT), true);
});

test("C02 malformed NaN cash", () => {
  const state = createPaperAccountState({ accountId: "paper-acc-1", initialCash: 1_000_000 });
  state.cash = Number.NaN;
  const result = validatePaperAccountState(state);
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.PAPER_INVALID_INPUT), true);
});

test("C02 position quantity 0 is rejected", () => {
  const state = createPaperAccountState({ accountId: "paper-acc-1", initialCash: 1_000_000 });
  state.positions = { AAA: { symbol: "AAA", quantity: 0, costBasis: 0 } };
  const result = validatePaperAccountState(state);
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.PAPER_INVALID_INPUT), true);
});

test("clonePaperAccountState is JSON deep copy after validate", () => {
  const state = createPaperAccountState({ accountId: "paper-acc-1", initialCash: 1_000_000 });
  const cloned = clonePaperAccountState(state);
  assert.deepEqual(cloned, jsonClone(state));
  assert.notEqual(cloned, state);
  cloned.cash = 1;
  assert.equal(state.cash, 1_000_000);
});

test("valid snapshot is JSON serializable without bigint", () => {
  const state = createPaperAccountState({ accountId: "paper-acc-1", initialCash: 1_000_000 });
  const round = JSON.parse(JSON.stringify(validatePaperAccountState(state).state));
  assert.deepEqual(round.executedIntentIds, {});
  assert.equal(typeof round.cash, "number");
});

test("11D-R1 hasOwn/setOwn/copyRecord survive __proto__ and JSON round-trip", () => {
  const rec = {};
  const protoBefore = Object.getPrototypeOf(rec);
  setOwnRecordKey(rec, "__proto__", "PAPER-exec-1");
  setOwnRecordKey(rec, "constructor", "PAPER-exec-2");
  setOwnRecordKey(rec, "toString", "PAPER-exec-3");
  assert.equal(hasOwnRecordKey(rec, "__proto__"), true);
  assert.equal(Object.prototype.hasOwnProperty.call(rec, "__proto__"), true);
  assert.equal(Object.getPrototypeOf(rec), protoBefore);
  assert.equal(Object.getPrototypeOf({}) === Object.prototype, true);
  const copied = copyRecord(rec);
  assert.equal(hasOwnRecordKey(copied, "__proto__"), true);
  assert.equal(copied["__proto__"], "PAPER-exec-1");
  assert.equal(Object.getPrototypeOf(copied), Object.prototype);
  const restored = JSON.parse(JSON.stringify({ executedIntentIds: rec })).executedIntentIds;
  assert.equal(hasOwnRecordKey(restored, "__proto__"), true);
  assert.equal(restored["__proto__"], "PAPER-exec-1");
  deleteOwnRecordKey(copied, "__proto__");
  assert.equal(hasOwnRecordKey(copied, "__proto__"), false);
  assert.equal(Object.getPrototypeOf(copied), Object.prototype);
});

test("11D-R1 empty {} maps remain valid; inherited constructor is not a position", () => {
  const state = createPaperAccountState({ accountId: "paper-acc-1", initialCash: 1_000_000 });
  assert.equal(hasOwnRecordKey(state.positions, "constructor"), false);
  assert.equal(hasOwnRecordKey(state.executedIntentIds, "toString"), false);
  const result = validatePaperAccountState(state);
  assert.equal(result.ok, true);
});
