/**
 * GATE 11C Paper account state. JSON-shaped snapshots only. Pure CommonJS. No I/O.
 * GATE 11D-R1: own-property dictionary helpers for positions / executedIntentIds.
 */

"use strict";

const {
  PAPER_MODE,
  ERROR,
  makePaperError,
} = require("./paper-result");

const AUTHORITATIVE_KEYS = Object.freeze([
  "accountId",
  "mode",
  "initialCash",
  "cash",
  "positions",
  "realizedPnl",
  "closedTrades",
  "lastProcessedSequence",
  "lastProcessedEventId",
  "executedIntentIds",
]);

const POSITION_KEYS = Object.freeze(["symbol", "quantity", "costBasis"]);
const FORBIDDEN_TOP_KEYS = Object.freeze([
  "averagePrice",
  "equity",
  "unrealizedPnl",
  "openOrders",
]);

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isSafeInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isNonNegSafeInt(value) {
  return isSafeInteger(value) && value >= 0;
}

function isPosSafeInt(value) {
  return isSafeInteger(value) && value > 0;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function hasOwnRecordKey(record, key) {
  if (!isPlainObject(record) || typeof key !== "string") return false;
  return Object.prototype.hasOwnProperty.call(record, key);
}

function setOwnRecordKey(record, key, value) {
  Object.defineProperty(record, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  return record;
}

function deleteOwnRecordKey(record, key) {
  if (hasOwnRecordKey(record, key)) {
    delete record[key];
  }
  return record;
}

function copyRecord(record) {
  const out = {};
  if (!isPlainObject(record)) return out;
  const keys = Object.keys(record);
  for (let i = 0; i < keys.length; i += 1) {
    const k = keys[i];
    setOwnRecordKey(out, k, record[k]);
  }
  return out;
}

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function pushErr(errors, code, field) {
  const extra = field === undefined ? { code } : { code, field };
  errors.push(makePaperError(extra));
}

function validateClosedTrades(closedTrades, errors) {
  if (!Array.isArray(closedTrades)) {
    pushErr(errors, ERROR.PAPER_INVALID_INPUT, "closedTrades");
    return;
  }
  for (let i = 0; i < closedTrades.length; i += 1) {
    const row = closedTrades[i];
    if (!isPlainObject(row)) {
      pushErr(errors, ERROR.PAPER_INVALID_INPUT, "closedTrades");
      return;
    }
  }
}

function validatePositions(positions, errors) {
  if (!isPlainObject(positions)) {
    pushErr(errors, ERROR.PAPER_INVALID_INPUT, "positions");
    return;
  }
  const keys = Object.keys(positions);
  for (const key of keys) {
    if (!hasOwnRecordKey(positions, key)) continue;
    const pos = positions[key];
    if (!isPlainObject(pos)) {
      pushErr(errors, ERROR.PAPER_INVALID_INPUT, "positions");
      return;
    }
    for (const extra of Object.keys(pos)) {
      if (POSITION_KEYS.indexOf(extra) === -1) {
        pushErr(errors, ERROR.PAPER_INVALID_INPUT, "positions");
        return;
      }
    }
    if (!isNonEmptyString(pos.symbol) || pos.symbol !== key) {
      pushErr(errors, ERROR.PAPER_INVALID_INPUT, "positions");
      return;
    }
    if (!isPosSafeInt(pos.quantity)) {
      pushErr(errors, ERROR.PAPER_INVALID_INPUT, "quantity");
      return;
    }
    if (!isNonNegSafeInt(pos.costBasis)) {
      pushErr(errors, ERROR.PAPER_INVALID_INPUT, "costBasis");
      return;
    }
  }
}

function validateExecutedIntentIds(map, errors) {
  if (!isPlainObject(map)) {
    pushErr(errors, ERROR.PAPER_INVALID_INPUT, "executedIntentIds");
    return;
  }
  const keys = Object.keys(map);
  for (const key of keys) {
    if (!hasOwnRecordKey(map, key)) continue;
    if (!isNonEmptyString(key) || !isNonEmptyString(map[key])) {
      pushErr(errors, ERROR.PAPER_INVALID_INPUT, "executedIntentIds");
      return;
    }
  }
}

function validatePaperAccountState(state) {
  const errors = [];
  if (!isPlainObject(state)) {
    pushErr(errors, ERROR.PAPER_INVALID_INPUT);
    return { ok: false, errors, state: null };
  }

  for (const forbidden of FORBIDDEN_TOP_KEYS) {
    if (Object.prototype.hasOwnProperty.call(state, forbidden)) {
      pushErr(errors, ERROR.PAPER_INVALID_INPUT, forbidden);
    }
  }

  const keys = Object.keys(state);
  for (const key of keys) {
    if (AUTHORITATIVE_KEYS.indexOf(key) === -1) {
      pushErr(errors, ERROR.PAPER_INVALID_INPUT, key);
    }
  }

  if (!isNonEmptyString(state.accountId)) {
    pushErr(errors, ERROR.PAPER_INVALID_INPUT, "accountId");
  }

  if (!Object.prototype.hasOwnProperty.call(state, "mode") || state.mode !== PAPER_MODE.PAPER) {
    pushErr(errors, ERROR.PAPER_MODE_INVALID, "mode");
  }

  if (!isNonNegSafeInt(state.initialCash)) {
    pushErr(errors, ERROR.PAPER_INVALID_INPUT, "initialCash");
  }
  if (!isNonNegSafeInt(state.cash)) {
    pushErr(errors, ERROR.PAPER_INVALID_INPUT, "cash");
  }
  if (!isSafeInteger(state.realizedPnl)) {
    pushErr(errors, ERROR.PAPER_INVALID_INPUT, "realizedPnl");
  }

  if (state.lastProcessedSequence !== null && !isNonNegSafeInt(state.lastProcessedSequence)) {
    pushErr(errors, ERROR.PAPER_INVALID_INPUT, "lastProcessedSequence");
  }
  if (state.lastProcessedEventId !== null && !isNonEmptyString(state.lastProcessedEventId)) {
    pushErr(errors, ERROR.PAPER_INVALID_INPUT, "lastProcessedEventId");
  }

  validatePositions(state.positions, errors);
  validateClosedTrades(state.closedTrades, errors);
  validateExecutedIntentIds(state.executedIntentIds, errors);

  if (errors.length > 0) {
    return { ok: false, errors, state: null };
  }

  let copy;
  try {
    copy = jsonClone(state);
  } catch (_err) {
    pushErr(errors, ERROR.PAPER_INVALID_INPUT);
    return { ok: false, errors, state: null };
  }
  return { ok: true, errors: [], state: Object.freeze(copy) };
}

function createPaperAccountState(input) {
  const src = isPlainObject(input) ? input : {};
  return {
    accountId: src.accountId,
    mode: PAPER_MODE.PAPER,
    initialCash: src.initialCash,
    cash: src.initialCash,
    positions: {},
    realizedPnl: 0,
    closedTrades: [],
    lastProcessedSequence: null,
    lastProcessedEventId: null,
    executedIntentIds: {},
  };
}

function clonePaperAccountState(state) {
  const validated = validatePaperAccountState(state);
  if (!validated.ok) {
    const err = new Error("invalid paper account state");
    err.errors = validated.errors;
    throw err;
  }
  return jsonClone(validated.state);
}

module.exports = {
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
};
