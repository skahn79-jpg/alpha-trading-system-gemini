/**
 * GATE 11I Paper risk engine. Pure evaluatePaperRisk + validatePaperRiskConfig.
 * No I/O. No MarketEvent. No persistence.
 */

"use strict";

const {
  PAPER_MODE,
  SIDE,
  ORDER_TYPE,
  ERROR,
  makePaperError,
} = require("./paper-result");
const {
  isPlainObject,
  isSafeInteger,
  isNonNegSafeInt,
  isPosSafeInt,
  hasOwnRecordKey,
  validatePaperAccountState,
} = require("./paper-account-state");
const {
  selectEffectiveCostPolicy,
  calculateCommission,
} = require("../backtest/cost-policy");

const RISK_CONFIG_KEYS = Object.freeze([
  "maxOrderNotional",
  "maxPositionNotional",
  "allowedMarkets",
  "allowedSymbols",
]);

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
  if (!isSafeInteger(a) || !isSafeInteger(b)) return { ok: false, sum: null };
  const sum = a + b;
  if (!isSafeInteger(sum)) return { ok: false, sum: null };
  return { ok: true, sum };
}

function isNonEmptyStringArray(value) {
  if (!Array.isArray(value)) return false;
  for (let i = 0; i < value.length; i += 1) {
    if (!isNonEmptyString(value[i])) return false;
  }
  return true;
}

function pushUnique(codes, seen, code) {
  if (seen[code]) return;
  seen[code] = true;
  codes.push(code);
}

function validatePaperRiskConfig(config) {
  const errors = [];
  if (!isPlainObject(config)) {
    errors.push(makePaperError({ code: ERROR.PAPER_RISK_INVALID_CONFIG, field: "riskConfig" }));
    return { ok: false, errors };
  }

  const keys = Object.keys(config);
  for (let i = 0; i < keys.length; i += 1) {
    if (RISK_CONFIG_KEYS.indexOf(keys[i]) === -1) {
      errors.push(makePaperError({ code: ERROR.PAPER_RISK_INVALID_CONFIG, field: keys[i] }));
    }
  }

  if (!Object.prototype.hasOwnProperty.call(config, "maxOrderNotional")) {
    errors.push(makePaperError({ code: ERROR.PAPER_RISK_INVALID_CONFIG, field: "maxOrderNotional" }));
  } else if (!isNonNegSafeInt(config.maxOrderNotional)) {
    errors.push(makePaperError({ code: ERROR.PAPER_RISK_INVALID_CONFIG, field: "maxOrderNotional" }));
  }

  if (!Object.prototype.hasOwnProperty.call(config, "maxPositionNotional")) {
    errors.push(makePaperError({ code: ERROR.PAPER_RISK_INVALID_CONFIG, field: "maxPositionNotional" }));
  } else if (!isNonNegSafeInt(config.maxPositionNotional)) {
    errors.push(makePaperError({ code: ERROR.PAPER_RISK_INVALID_CONFIG, field: "maxPositionNotional" }));
  }

  if (!Object.prototype.hasOwnProperty.call(config, "allowedMarkets")) {
    errors.push(makePaperError({ code: ERROR.PAPER_RISK_INVALID_CONFIG, field: "allowedMarkets" }));
  } else if (!isNonEmptyStringArray(config.allowedMarkets)) {
    errors.push(makePaperError({ code: ERROR.PAPER_RISK_INVALID_CONFIG, field: "allowedMarkets" }));
  }

  if (!Object.prototype.hasOwnProperty.call(config, "allowedSymbols")) {
    errors.push(makePaperError({ code: ERROR.PAPER_RISK_INVALID_CONFIG, field: "allowedSymbols" }));
  } else if (!isNonEmptyStringArray(config.allowedSymbols)) {
    errors.push(makePaperError({ code: ERROR.PAPER_RISK_INVALID_CONFIG, field: "allowedSymbols" }));
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, errors: [] };
}

function makeDecision(parts) {
  return {
    riskDecisionId: parts.riskDecisionId,
    intentId: parts.intentId,
    approved: parts.approved,
    requestedQuantity: parts.requestedQuantity,
    approvedQuantity: parts.approvedQuantity,
    validAfterEventSequence: parts.validAfterEventSequence,
    reasonCodes: parts.reasonCodes,
    evaluatedNotional: parts.evaluatedNotional,
    riskReferencePrice: parts.riskReferencePrice,
  };
}

function identityFromInput(input) {
  const src = isPlainObject(input) ? input : {};
  const intent = isPlainObject(src.intent) ? src.intent : {};
  return {
    riskDecisionId: isNonEmptyString(src.riskDecisionId) ? src.riskDecisionId : "",
    intentId: isNonEmptyString(intent.intentId) ? intent.intentId : "",
    requestedQuantity: isSafeInteger(intent.quantity) ? intent.quantity : 0,
    validAfterEventSequence: isNonNegSafeInt(src.validAfterEventSequence)
      ? src.validAfterEventSequence
      : 0,
    riskReferencePrice: isPosSafeInt(src.riskReferencePrice) ? src.riskReferencePrice : null,
  };
}

function rejected(input, reasonCodes, evaluatedNotional) {
  const id = identityFromInput(input);
  const codes = [];
  const seen = Object.create(null);
  const list = Array.isArray(reasonCodes) ? reasonCodes : [];
  for (let i = 0; i < list.length; i += 1) {
    pushUnique(codes, seen, list[i]);
  }
  if (codes.length === 0) {
    codes.push(ERROR.PAPER_RISK_INVALID_INPUT);
  }
  return makeDecision({
    riskDecisionId: id.riskDecisionId,
    intentId: id.intentId,
    approved: false,
    requestedQuantity: id.requestedQuantity,
    approvedQuantity: 0,
    validAfterEventSequence: id.validAfterEventSequence,
    reasonCodes: codes,
    evaluatedNotional: evaluatedNotional === undefined ? null : evaluatedNotional,
    riskReferencePrice: id.riskReferencePrice,
  });
}

function approvedDecision(input, evaluatedNotional) {
  const intent = input.intent;
  return makeDecision({
    riskDecisionId: input.riskDecisionId,
    intentId: intent.intentId,
    approved: true,
    requestedQuantity: intent.quantity,
    approvedQuantity: intent.quantity,
    validAfterEventSequence: input.validAfterEventSequence,
    reasonCodes: [],
    evaluatedNotional,
    riskReferencePrice: input.riskReferencePrice,
  });
}

function collectInputCodes(input) {
  const codes = [];
  const seen = Object.create(null);
  function add() {
    pushUnique(codes, seen, ERROR.PAPER_RISK_INVALID_INPUT);
  }

  if (!isPlainObject(input)) {
    add();
    return codes;
  }

  const intent = input.intent;
  if (!isPlainObject(intent)) {
    add();
  } else {
    if (!isNonEmptyString(intent.intentId)) add();
    if (intent.mode !== PAPER_MODE.PAPER) add();
    if (!isNonEmptyString(intent.market)) add();
    if (!isNonEmptyString(intent.symbol)) add();
    if (intent.side !== SIDE.BUY && intent.side !== SIDE.SELL) add();
    if (intent.orderType !== ORDER_TYPE.MARKET_OPEN) add();
    if (!isPosSafeInt(intent.quantity)) add();
  }

  if (!isPosSafeInt(input.riskReferencePrice)) add();
  if (!isNonEmptyString(input.riskDecisionId)) add();
  if (!isNonNegSafeInt(input.validAfterEventSequence)) add();

  const stateVal = validatePaperAccountState(input.accountState);
  if (!stateVal.ok) add();

  return codes;
}

function buyCommissionAmount(intent, orderNotional, costContext) {
  if (!isPlainObject(costContext)) {
    return { ok: false, amount: null };
  }
  const selected = selectEffectiveCostPolicy({
    market: intent.market,
    tradingDate: costContext.tradingDate,
    brokerChannel: costContext.brokerChannel,
    currency: costContext.currency,
    policies: costContext.policies,
  });
  if (!selected.ok) {
    return { ok: false, amount: null };
  }
  const policy = selected.policy;
  if (!isPlainObject(policy) || !isPlainObject(policy.commission)) {
    return { ok: false, amount: null };
  }
  const commissionRes = calculateCommission({
    amount: orderNotional,
    ratePpm: policy.commission.buyRatePpm,
    minimumAmount: policy.commission.minimumBuyAmount,
    roundingMode: policy.commission.roundingMode,
  });
  if (!commissionRes.ok || !isNonNegSafeInt(commissionRes.amount)) {
    return { ok: false, amount: null };
  }
  return { ok: true, amount: commissionRes.amount };
}

function evaluatePaperRiskBody(input) {
  const inputCodes = collectInputCodes(input);
  const configVal = validatePaperRiskConfig(isPlainObject(input) ? input.riskConfig : undefined);
  const early = [];
  const earlySeen = Object.create(null);
  if (inputCodes.length > 0) {
    pushUnique(early, earlySeen, ERROR.PAPER_RISK_INVALID_INPUT);
  }
  if (!configVal.ok) {
    pushUnique(early, earlySeen, ERROR.PAPER_RISK_INVALID_CONFIG);
  }
  if (early.length > 0) {
    return rejected(input, early, null);
  }

  const intent = input.intent;
  const price = input.riskReferencePrice;
  const config = input.riskConfig;
  const stateVal = validatePaperAccountState(input.accountState);
  const state = stateVal.state;
  const codes = [];
  const seen = Object.create(null);

  if (config.allowedMarkets.indexOf(intent.market) === -1) {
    pushUnique(codes, seen, ERROR.PAPER_RISK_MARKET_NOT_ALLOWED);
  }
  if (config.allowedSymbols.indexOf(intent.symbol) === -1) {
    pushUnique(codes, seen, ERROR.PAPER_RISK_SYMBOL_NOT_ALLOWED);
  }

  let held = 0;
  if (hasOwnRecordKey(state.positions, intent.symbol)) {
    held = state.positions[intent.symbol].quantity;
  }

  const isSell = intent.side === SIDE.SELL;
  const isBuy = intent.side === SIDE.BUY;
  if (isSell && intent.quantity > held) {
    pushUnique(codes, seen, ERROR.PAPER_RISK_INSUFFICIENT_POSITION);
  }

  let nonfinite = false;
  let orderNotional = null;
  let requiredCash = null;
  let projectedNotional = null;

  const notionalRes = safeMultiply(intent.quantity, price);
  if (!notionalRes.ok) {
    nonfinite = true;
  } else {
    orderNotional = notionalRes.product;
  }

  if (isBuy) {
    if (orderNotional == null) {
      nonfinite = true;
    } else {
      const comm = buyCommissionAmount(intent, orderNotional, input.costContext);
      if (!comm.ok) {
        nonfinite = true;
      } else {
        const required = addSafe(orderNotional, comm.amount);
        if (!required.ok) {
          nonfinite = true;
        } else {
          requiredCash = required.sum;
        }
      }
    }

    const projectedQtyRes = addSafe(held, intent.quantity);
    if (!projectedQtyRes.ok) {
      nonfinite = true;
    } else {
      const posRes = safeMultiply(projectedQtyRes.sum, price);
      if (!posRes.ok) {
        nonfinite = true;
      } else {
        projectedNotional = posRes.product;
      }
    }
  }

  if (nonfinite) {
    pushUnique(codes, seen, ERROR.PAPER_RISK_NONFINITE_CALCULATION);
  }

  if (isBuy && orderNotional != null && orderNotional > config.maxOrderNotional) {
    pushUnique(codes, seen, ERROR.PAPER_RISK_ORDER_NOTIONAL_EXCEEDED);
  }
  if (isBuy && projectedNotional != null && projectedNotional > config.maxPositionNotional) {
    pushUnique(codes, seen, ERROR.PAPER_RISK_POSITION_NOTIONAL_EXCEEDED);
  }
  if (isBuy && requiredCash != null && requiredCash > state.cash) {
    pushUnique(codes, seen, ERROR.PAPER_RISK_INSUFFICIENT_CASH);
  }

  if (codes.length > 0) {
    return rejected(input, codes, orderNotional);
  }
  return approvedDecision(input, orderNotional);
}

function evaluatePaperRisk(input) {
  try {
    return evaluatePaperRiskBody(input);
  } catch (_err) {
    return rejected(input, [ERROR.PAPER_RISK_INVALID_INPUT], null);
  }
}

module.exports = {
  evaluatePaperRisk,
  validatePaperRiskConfig,
};
