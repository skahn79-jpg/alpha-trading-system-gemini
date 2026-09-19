/**
 * GATE 11C Paper ledger stepper. Pure applyPaperFill. No I/O.
 * GATE 11D-R1: positions use own-property record helpers.
 */

"use strict";

const {
  SIDE,
  ERROR,
  makePaperError,
} = require("./paper-result");
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
} = require("./paper-account-state");

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function safeMultiply(a, b) {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) {
    return { ok: false, product: null };
  }
  if (a !== 0 && b !== 0) {
    if (Math.abs(a) > Math.floor(Number.MAX_SAFE_INTEGER / Math.abs(b))) {
      return { ok: false, product: null };
    }
  }
  return { ok: true, product: a * b };
}

function addSafe(a, b) {
  if (!isSafeInteger(a) || !isSafeInteger(b)) return null;
  const sum = a + b;
  if (!isSafeInteger(sum)) return null;
  return sum;
}

function subSafe(a, b) {
  if (!isSafeInteger(a) || !isSafeInteger(b)) return null;
  const diff = a - b;
  if (!isSafeInteger(diff)) return null;
  return diff;
}

function fail(state, errors) {
  return {
    ok: false,
    state,
    tradeEffect: null,
    errors,
  };
}

function invalid(state, field) {
  const extra = field === undefined
    ? { code: ERROR.PAPER_INVALID_INPUT }
    : { code: ERROR.PAPER_INVALID_INPUT, field };
  return fail(state, [makePaperError(extra)]);
}

function applyPaperFill(currentState, fill) {
  let originalClone = null;
  try {
    originalClone = jsonClone(currentState);
  } catch (_err) {
    originalClone = null;
  }

  const validated = validatePaperAccountState(currentState);
  if (!validated.ok) {
    return fail(originalClone, validated.errors);
  }
  originalClone = jsonClone(validated.state);

  if (!isPlainObject(fill)) {
    return invalid(originalClone);
  }

  const side = fill.side;
  const symbol = fill.symbol;
  const quantity = fill.quantity;
  const fillPrice = fill.fillPrice;
  const commission = fill.commission;
  const tax = fill.tax;
  const eventId = fill.eventId;
  const sequence = fill.sequence;
  const intentId = fill.intentId;

  if (side !== SIDE.BUY && side !== SIDE.SELL) {
    return invalid(originalClone, "side");
  }
  if (!isNonEmptyString(symbol)) {
    return invalid(originalClone, "symbol");
  }
  if (!isPosSafeInt(quantity)) {
    return invalid(originalClone, "quantity");
  }
  if (!isPosSafeInt(fillPrice)) {
    return invalid(originalClone, "fillPrice");
  }
  if (!isNonNegSafeInt(commission)) {
    return invalid(originalClone, "commission");
  }
  if (!isNonNegSafeInt(tax)) {
    return invalid(originalClone, "tax");
  }
  if (side === SIDE.BUY && tax !== 0) {
    return invalid(originalClone, "tax");
  }
  if (!isNonEmptyString(eventId)) {
    return invalid(originalClone, "eventId");
  }
  if (!isNonNegSafeInt(sequence)) {
    return invalid(originalClone, "sequence");
  }
  if (!isNonEmptyString(intentId)) {
    return invalid(originalClone, "intentId");
  }

  const notionalRes = safeMultiply(quantity, fillPrice);
  if (!notionalRes.ok) {
    return invalid(originalClone, "quantity");
  }
  const notional = notionalRes.product;
  const next = jsonClone(validated.state);
  next.positions = copyRecord(next.positions);
  next.closedTrades = next.closedTrades.slice();
  next.executedIntentIds = copyRecord(next.executedIntentIds);

  if (side === SIDE.BUY) {
    const debit = addSafe(notional, commission);
    if (debit === null) {
      return invalid(originalClone);
    }
    if (next.cash < debit) {
      return fail(originalClone, [makePaperError({ code: ERROR.PAPER_INSUFFICIENT_CASH, field: "cash" })]);
    }
    const newCash = subSafe(next.cash, debit);
    if (newCash === null) {
      return invalid(originalClone, "cash");
    }
    next.cash = newCash;
    if (!hasOwnRecordKey(next.positions, symbol)) {
      setOwnRecordKey(next.positions, symbol, {
        symbol,
        quantity,
        costBasis: debit,
      });
    } else {
      const existing = next.positions[symbol];
      const newQty = addSafe(existing.quantity, quantity);
      const newBasis = addSafe(existing.costBasis, debit);
      if (newQty === null || newBasis === null) {
        return invalid(originalClone);
      }
      setOwnRecordKey(next.positions, symbol, {
        symbol,
        quantity: newQty,
        costBasis: newBasis,
      });
    }
    const cashDelta = subSafe(0, debit);
    return {
      ok: true,
      state: next,
      tradeEffect: {
        side,
        symbol,
        quantity,
        notional,
        commission,
        tax,
        cashDelta,
      },
      errors: [],
    };
  }

  if (!hasOwnRecordKey(next.positions, symbol)) {
    return fail(originalClone, [makePaperError({
      code: ERROR.PAPER_INSUFFICIENT_POSITION,
      field: "quantity",
    })]);
  }
  const existing = next.positions[symbol];
  if (existing == null || quantity > existing.quantity) {
    return fail(originalClone, [makePaperError({
      code: ERROR.PAPER_INSUFFICIENT_POSITION,
      field: "quantity",
    })]);
  }

  const costSum = addSafe(commission, tax);
  if (costSum === null) {
    return invalid(originalClone);
  }
  const proceeds = subSafe(notional, costSum);
  if (proceeds === null || proceeds < 0) {
    return invalid(originalClone);
  }

  const qtyBefore = existing.quantity;
  const remainingQty = subSafe(qtyBefore, quantity);
  if (remainingQty === null) {
    return invalid(originalClone, "quantity");
  }

  let lotCost;
  if (remainingQty === 0) {
    lotCost = existing.costBasis;
    deleteOwnRecordKey(next.positions, symbol);
  } else {
    const lotProduct = safeMultiply(existing.costBasis, quantity);
    if (!lotProduct.ok) {
      return invalid(originalClone, "costBasis");
    }
    lotCost = Math.floor(lotProduct.product / qtyBefore);
    if (!isSafeInteger(lotCost) || lotCost < 0) {
      return invalid(originalClone, "costBasis");
    }
    const remainingBasis = subSafe(existing.costBasis, lotCost);
    if (remainingBasis === null || remainingBasis < 0) {
      return invalid(originalClone, "costBasis");
    }
    setOwnRecordKey(next.positions, symbol, {
      symbol,
      quantity: remainingQty,
      costBasis: remainingBasis,
    });
  }

  const newCash = addSafe(next.cash, proceeds);
  if (newCash === null) {
    return invalid(originalClone, "cash");
  }
  next.cash = newCash;

  const tradePnl = subSafe(proceeds, lotCost);
  if (tradePnl === null) {
    return invalid(originalClone);
  }
  const newRealized = addSafe(next.realizedPnl, tradePnl);
  if (newRealized === null) {
    return invalid(originalClone, "realizedPnl");
  }
  next.realizedPnl = newRealized;
  next.closedTrades = next.closedTrades.concat([{
    symbol,
    quantity,
    fillPrice,
    proceeds,
    lotCost,
    realizedPnl: tradePnl,
    eventId,
    sequence,
    intentId,
  }]);

  return {
    ok: true,
    state: next,
    tradeEffect: {
      side,
      symbol,
      quantity,
      notional,
      commission,
      tax,
      cashDelta: proceeds,
      lotCost,
      realizedPnl: tradePnl,
    },
    errors: [],
  };
}

module.exports = {
  applyPaperFill,
};
