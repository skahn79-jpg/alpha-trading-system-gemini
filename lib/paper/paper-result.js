/**
 * GATE 11C Paper result envelope. Pure CommonJS. No I/O.
 */

"use strict";

const PAPER_MODE = Object.freeze({
  PAPER: "PAPER",
});

const PAPER_STATUS = Object.freeze({
  FILLED: "FILLED",
  BLOCKED: "BLOCKED",
});

const SIDE = Object.freeze({
  BUY: "BUY",
  SELL: "SELL",
});

const ORDER_TYPE = Object.freeze({
  MARKET_OPEN: "MARKET_OPEN",
});

const ERROR = Object.freeze({
  PAPER_INVALID_INPUT: "PAPER_INVALID_INPUT",
  PAPER_KILL_SWITCH: "PAPER_KILL_SWITCH",
  PAPER_RISK_REJECTED: "PAPER_RISK_REJECTED",
  PAPER_RISK_MISMATCH: "PAPER_RISK_MISMATCH",
  PAPER_APPROVAL_REQUIRED: "PAPER_APPROVAL_REQUIRED",
  PAPER_APPROVAL_MISMATCH: "PAPER_APPROVAL_MISMATCH",
  PAPER_DUPLICATE_EVENT: "PAPER_DUPLICATE_EVENT",
  PAPER_OUT_OF_ORDER_EVENT: "PAPER_OUT_OF_ORDER_EVENT",
  PAPER_SAME_EVENT_EXECUTION: "PAPER_SAME_EVENT_EXECUTION",
  PAPER_INSUFFICIENT_CASH: "PAPER_INSUFFICIENT_CASH",
  PAPER_INSUFFICIENT_POSITION: "PAPER_INSUFFICIENT_POSITION",
  PAPER_SYMBOL_MISMATCH: "PAPER_SYMBOL_MISMATCH",
  PAPER_MARKET_MISMATCH: "PAPER_MARKET_MISMATCH",
  PAPER_INTENT_ALREADY_EXECUTED: "PAPER_INTENT_ALREADY_EXECUTED",
  PAPER_COST_FAILED: "PAPER_COST_FAILED",
  PAPER_MODE_INVALID: "PAPER_MODE_INVALID",
  PAPER_ZERO_QUANTITY: "PAPER_ZERO_QUANTITY",
});

function uniqueCodes(errors) {
  const seen = Object.create(null);
  const out = [];
  const list = Array.isArray(errors) ? errors : [];
  for (const err of list) {
    if (!err || err.code == null) continue;
    const code = err.code;
    if (seen[code]) continue;
    seen[code] = true;
    out.push(code);
  }
  return out;
}

function makePaperError(input) {
  const src = input && typeof input === "object" ? input : {};
  const err = { code: src.code };
  if (src.field !== undefined) err.field = src.field;
  return err;
}

function createPaperResult(input) {
  const src = input && typeof input === "object" ? input : {};
  const paperStatus = src.paperStatus;
  if (paperStatus === PAPER_STATUS.FILLED) {
    return {
      ok: true,
      paperStatus: PAPER_STATUS.FILLED,
      errors: [],
      errorCodes: [],
      executionRecord: src.executionRecord,
      accountState: src.accountState,
    };
  }
  const errors = Array.isArray(src.errors) ? src.errors.slice() : [];
  return {
    ok: false,
    paperStatus: PAPER_STATUS.BLOCKED,
    errors,
    errorCodes: uniqueCodes(errors),
    executionRecord: null,
    accountState: src.accountState,
  };
}

module.exports = {
  PAPER_MODE,
  PAPER_STATUS,
  SIDE,
  ORDER_TYPE,
  ERROR,
  makePaperError,
  createPaperResult,
};
