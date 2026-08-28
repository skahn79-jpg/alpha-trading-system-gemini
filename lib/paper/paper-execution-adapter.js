/**
 * GATE 11C Paper execution adapter. Pure executePaper. No I/O.
 * GATE 11D-R1: executedIntentIds use own-property record helpers.
 * GATE 11I: require riskConfig; recheck evaluatePaperRisk at event.open before fill.
 */

"use strict";

const {
  PAPER_MODE,
  PAPER_STATUS,
  SIDE,
  ORDER_TYPE,
  ERROR,
  makePaperError,
  createPaperResult,
} = require("./paper-result");
const {
  isPlainObject,
  isSafeInteger,
  isNonNegSafeInt,
  isPosSafeInt,
  hasOwnRecordKey,
  setOwnRecordKey,
  copyRecord,
  validatePaperAccountState,
} = require("./paper-account-state");
const { applyPaperFill } = require("./paper-ledger-stepper");
const { evaluatePaperRisk } = require("./paper-risk-engine");
const {
  selectEffectiveCostPolicy,
  calculateCommission,
  calculateSellTaxes,
} = require("../backtest/cost-policy");

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

function tryCloneState(state) {
  const validated = validatePaperAccountState(state);
  if (validated.ok) return jsonClone(validated.state);
  try {
    return jsonClone(state);
  } catch (_err) {
    return null;
  }
}

function blocked(errors, accountState) {
  return createPaperResult({
    ok: false,
    paperStatus: PAPER_STATUS.BLOCKED,
    errors,
    executionRecord: null,
    accountState,
  });
}

function filled(executionRecord, accountState) {
  return createPaperResult({
    ok: true,
    paperStatus: PAPER_STATUS.FILLED,
    errors: [],
    executionRecord,
    accountState,
  });
}

function err(code, field) {
  return field === undefined
    ? makePaperError({ code })
    : makePaperError({ code, field });
}

function validateIntent(intent) {
  if (!isPlainObject(intent)) {
    return { ok: false, errors: [err(ERROR.PAPER_INVALID_INPUT, "orderIntent")] };
  }
  if (!isNonEmptyString(intent.intentId)) {
    return { ok: false, errors: [err(ERROR.PAPER_INVALID_INPUT, "intentId")] };
  }
  if (intent.mode !== PAPER_MODE.PAPER) {
    return { ok: false, errors: [err(ERROR.PAPER_MODE_INVALID, "mode")] };
  }
  if (!isNonEmptyString(intent.market)) {
    return { ok: false, errors: [err(ERROR.PAPER_INVALID_INPUT, "market")] };
  }
  if (!isNonEmptyString(intent.symbol)) {
    return { ok: false, errors: [err(ERROR.PAPER_INVALID_INPUT, "symbol")] };
  }
  if (intent.side !== SIDE.BUY && intent.side !== SIDE.SELL) {
    return { ok: false, errors: [err(ERROR.PAPER_INVALID_INPUT, "side")] };
  }
  if (intent.orderType !== ORDER_TYPE.MARKET_OPEN) {
    return { ok: false, errors: [err(ERROR.PAPER_INVALID_INPUT, "orderType")] };
  }
  if (!isNonNegSafeInt(intent.signalSequence)) {
    return { ok: false, errors: [err(ERROR.PAPER_INVALID_INPUT, "signalSequence")] };
  }
  const quantity = intent.quantity;
  if (typeof quantity !== "number" || !Number.isFinite(quantity)) {
    return { ok: false, errors: [err(ERROR.PAPER_INVALID_INPUT, "quantity")] };
  }
  if (quantity <= 0) {
    return { ok: false, errors: [err(ERROR.PAPER_ZERO_QUANTITY, "quantity")] };
  }
  if (!isPosSafeInt(quantity)) {
    return { ok: false, errors: [err(ERROR.PAPER_INVALID_INPUT, "quantity")] };
  }
  return { ok: true, errors: [] };
}

function validateEvent(event) {
  if (!isPlainObject(event)) {
    return { ok: false, errors: [err(ERROR.PAPER_INVALID_INPUT, "marketEvent")] };
  }
  if (!isNonEmptyString(event.eventId)) {
    return { ok: false, errors: [err(ERROR.PAPER_INVALID_INPUT, "eventId")] };
  }
  if (!isNonEmptyString(event.market)) {
    return { ok: false, errors: [err(ERROR.PAPER_INVALID_INPUT, "market")] };
  }
  if (!isNonEmptyString(event.symbol)) {
    return { ok: false, errors: [err(ERROR.PAPER_INVALID_INPUT, "symbol")] };
  }
  if (!isNonEmptyString(event.tradingDate)) {
    return { ok: false, errors: [err(ERROR.PAPER_INVALID_INPUT, "tradingDate")] };
  }
  if (!isNonNegSafeInt(event.sequence)) {
    return { ok: false, errors: [err(ERROR.PAPER_INVALID_INPUT, "sequence")] };
  }
  if (!isPosSafeInt(event.open)) {
    return { ok: false, errors: [err(ERROR.PAPER_INVALID_INPUT, "open")] };
  }
  return { ok: true, errors: [] };
}

function structuralRisk(risk) {
  if (!isNonEmptyString(risk.riskDecisionId)) {
    return { ok: false, errors: [err(ERROR.PAPER_INVALID_INPUT, "riskDecisionId")] };
  }
  if (!isNonEmptyString(risk.intentId)) {
    return { ok: false, errors: [err(ERROR.PAPER_INVALID_INPUT, "intentId")] };
  }
  if (typeof risk.approved !== "boolean") {
    return { ok: false, errors: [err(ERROR.PAPER_INVALID_INPUT, "approved")] };
  }
  if (!isSafeInteger(risk.requestedQuantity)) {
    return { ok: false, errors: [err(ERROR.PAPER_INVALID_INPUT, "requestedQuantity")] };
  }
  if (!isSafeInteger(risk.approvedQuantity)) {
    return { ok: false, errors: [err(ERROR.PAPER_INVALID_INPUT, "approvedQuantity")] };
  }
  if (!isNonNegSafeInt(risk.validAfterEventSequence)) {
    return { ok: false, errors: [err(ERROR.PAPER_INVALID_INPUT, "validAfterEventSequence")] };
  }
  return { ok: true, errors: [] };
}

function structuralApproval(approval) {
  if (!isNonEmptyString(approval.approvalId)) {
    return { ok: false, errors: [err(ERROR.PAPER_APPROVAL_REQUIRED, "approvalId")] };
  }
  if (!isNonEmptyString(approval.intentId)) {
    return { ok: false, errors: [err(ERROR.PAPER_APPROVAL_REQUIRED, "intentId")] };
  }
  if (!isNonEmptyString(approval.riskDecisionId)) {
    return { ok: false, errors: [err(ERROR.PAPER_APPROVAL_REQUIRED, "riskDecisionId")] };
  }
  if (typeof approval.approved !== "boolean") {
    return { ok: false, errors: [err(ERROR.PAPER_APPROVAL_REQUIRED, "approved")] };
  }
  if (!isSafeInteger(approval.approvedQuantity)) {
    return { ok: false, errors: [err(ERROR.PAPER_APPROVAL_REQUIRED, "approvedQuantity")] };
  }
  if (!isNonNegSafeInt(approval.validAfterEventSequence)) {
    return { ok: false, errors: [err(ERROR.PAPER_APPROVAL_REQUIRED, "validAfterEventSequence")] };
  }
  return { ok: true, errors: [] };
}

function executePaper(input) {
  if (!isPlainObject(input)) {
    return blocked([err(ERROR.PAPER_INVALID_INPUT)], null);
  }

  const snapshot = tryCloneState(input.accountState);

  if (typeof input.paperExecutionEnabled !== "boolean") {
    return blocked([err(ERROR.PAPER_INVALID_INPUT, "paperExecutionEnabled")], snapshot);
  }
  if (!isNonEmptyString(input.executionId)) {
    return blocked([err(ERROR.PAPER_INVALID_INPUT, "executionId")], snapshot);
  }
  if (!isPlainObject(input.costContext)) {
    return blocked([err(ERROR.PAPER_INVALID_INPUT, "costContext")], snapshot);
  }

  const stateVal = validatePaperAccountState(input.accountState);
  if (!stateVal.ok) {
    return blocked(stateVal.errors, snapshot);
  }
  const current = jsonClone(stateVal.state);

  const intentCheck = validateIntent(input.orderIntent);
  if (!intentCheck.ok) {
    return blocked(intentCheck.errors, current);
  }
  const intent = input.orderIntent;

  const eventCheck = validateEvent(input.marketEvent);
  if (!eventCheck.ok) {
    return blocked(eventCheck.errors, jsonClone(current));
  }
  const event = input.marketEvent;

  if (event.symbol !== intent.symbol) {
    return blocked([err(ERROR.PAPER_SYMBOL_MISMATCH, "symbol")], jsonClone(current));
  }
  if (event.market !== intent.market) {
    return blocked([err(ERROR.PAPER_MARKET_MISMATCH, "market")], jsonClone(current));
  }

  const lastSeq = current.lastProcessedSequence;
  const lastEid = current.lastProcessedEventId;
  if (lastSeq === event.sequence || lastEid === event.eventId) {
    return blocked([err(ERROR.PAPER_DUPLICATE_EVENT)], jsonClone(current));
  }
  if (lastSeq !== null && event.sequence < lastSeq) {
    return blocked([err(ERROR.PAPER_OUT_OF_ORDER_EVENT)], jsonClone(current));
  }

  function consumeBlock(errors) {
    const next = jsonClone(current);
    next.lastProcessedSequence = event.sequence;
    next.lastProcessedEventId = event.eventId;
    return blocked(errors, next);
  }

  if (input.paperExecutionEnabled !== true) {
    return consumeBlock([err(ERROR.PAPER_KILL_SWITCH, "paperExecutionEnabled")]);
  }

  const riskObj = input.riskDecision;
  if (!isPlainObject(riskObj)) {
    return consumeBlock([err(ERROR.PAPER_INVALID_INPUT, "riskDecision")]);
  }
  const riskStruct = structuralRisk(riskObj);
  if (!riskStruct.ok) {
    return consumeBlock(riskStruct.errors);
  }

  const approvalObj = input.userApproval;
  if (!isPlainObject(approvalObj)) {
    return consumeBlock([err(ERROR.PAPER_APPROVAL_REQUIRED, "userApproval")]);
  }
  const approvalStruct = structuralApproval(approvalObj);
  if (!approvalStruct.ok) {
    return consumeBlock(approvalStruct.errors);
  }

  const signalSeq = intent.signalSequence;
  const riskSeq = riskObj.validAfterEventSequence;
  const approvalSeq = approvalObj.validAfterEventSequence;
  const eventSeq = event.sequence;
  if (signalSeq >= eventSeq || riskSeq >= eventSeq || approvalSeq >= eventSeq) {
    return consumeBlock([err(ERROR.PAPER_SAME_EVENT_EXECUTION)]);
  }
  if (signalSeq > riskSeq || signalSeq > approvalSeq) {
    return consumeBlock([err(ERROR.PAPER_INVALID_INPUT)]);
  }

  if (riskObj.approved !== true) {
    return consumeBlock([err(ERROR.PAPER_RISK_REJECTED)]);
  }
  if (
    riskObj.intentId !== intent.intentId
    || riskObj.requestedQuantity !== intent.quantity
    || riskObj.approvedQuantity !== intent.quantity
    || riskObj.requestedQuantity !== riskObj.approvedQuantity
  ) {
    return consumeBlock([err(ERROR.PAPER_RISK_MISMATCH)]);
  }

  if (approvalObj.approved !== true) {
    return consumeBlock([err(ERROR.PAPER_APPROVAL_REQUIRED)]);
  }
  if (
    approvalObj.intentId !== intent.intentId
    || approvalObj.riskDecisionId !== riskObj.riskDecisionId
    || approvalObj.approvedQuantity !== intent.quantity
  ) {
    return consumeBlock([err(ERROR.PAPER_APPROVAL_MISMATCH)]);
  }

  if (hasOwnRecordKey(current.executedIntentIds, intent.intentId)) {
    return consumeBlock([err(ERROR.PAPER_INTENT_ALREADY_EXECUTED, "intentId")]);
  }

  if (!isPlainObject(input.riskConfig)) {
    return consumeBlock([err(ERROR.PAPER_RISK_INVALID_CONFIG, "riskConfig")]);
  }
  const riskRecheck = evaluatePaperRisk({
    accountState: current,
    intent,
    riskReferencePrice: event.open,
    riskConfig: input.riskConfig,
    costContext: {
      policies: input.costContext.policies,
      brokerChannel: input.costContext.brokerChannel,
      currency: input.costContext.currency,
      tradingDate: event.tradingDate,
    },
    riskDecisionId: riskObj.riskDecisionId,
    validAfterEventSequence: riskObj.validAfterEventSequence,
  });
  if (riskRecheck.approved !== true) {
    const codes = Array.isArray(riskRecheck.reasonCodes) ? riskRecheck.reasonCodes : [];
    const recheckErrors = [];
    for (let i = 0; i < codes.length; i += 1) {
      recheckErrors.push(err(codes[i]));
    }
    if (recheckErrors.length === 0) {
      recheckErrors.push(err(ERROR.PAPER_RISK_INVALID_INPUT));
    }
    return consumeBlock(recheckErrors);
  }

  const costContext = input.costContext;
  const selected = selectEffectiveCostPolicy({
    market: event.market,
    tradingDate: event.tradingDate,
    brokerChannel: costContext.brokerChannel,
    currency: costContext.currency,
    policies: costContext.policies,
  });
  if (!selected.ok) {
    return consumeBlock([err(ERROR.PAPER_COST_FAILED)]);
  }
  const policy = selected.policy;
  if (!isPlainObject(policy) || !isPlainObject(policy.commission)) {
    return consumeBlock([err(ERROR.PAPER_COST_FAILED)]);
  }

  const fillPrice = event.open;
  const notionalRes = safeMultiply(intent.quantity, fillPrice);
  if (!notionalRes.ok) {
    return consumeBlock([err(ERROR.PAPER_COST_FAILED)]);
  }
  const notional = notionalRes.product;

  let commissionRes;
  let taxAmount = 0;
  if (intent.side === SIDE.BUY) {
    commissionRes = calculateCommission({
      amount: notional,
      ratePpm: policy.commission.buyRatePpm,
      minimumAmount: policy.commission.minimumBuyAmount,
      roundingMode: policy.commission.roundingMode,
    });
    taxAmount = 0;
  } else {
    commissionRes = calculateCommission({
      amount: notional,
      ratePpm: policy.commission.sellRatePpm,
      minimumAmount: policy.commission.minimumSellAmount,
      roundingMode: policy.commission.roundingMode,
    });
    const taxRes = calculateSellTaxes({
      amount: notional,
      sellTaxes: policy.sellTaxes,
    });
    if (!taxRes.ok) {
      return consumeBlock([err(ERROR.PAPER_COST_FAILED)]);
    }
    taxAmount = taxRes.total;
  }
  if (!commissionRes.ok) {
    return consumeBlock([err(ERROR.PAPER_COST_FAILED)]);
  }

  const stepped = applyPaperFill(current, {
    side: intent.side,
    symbol: intent.symbol,
    quantity: intent.quantity,
    fillPrice,
    commission: commissionRes.amount,
    tax: taxAmount,
    eventId: event.eventId,
    sequence: event.sequence,
    intentId: intent.intentId,
  });
  if (!stepped.ok) {
    return consumeBlock(stepped.errors);
  }

  const next = stepped.state;
  next.lastProcessedSequence = event.sequence;
  next.lastProcessedEventId = event.eventId;
  const executed = copyRecord(next.executedIntentIds);
  setOwnRecordKey(executed, intent.intentId, input.executionId);
  next.executedIntentIds = executed;

  const totalCost = commissionRes.amount + taxAmount;
  const record = {
    executionId: input.executionId,
    mode: PAPER_MODE.PAPER,
    intentId: intent.intentId,
    riskDecisionId: riskObj.riskDecisionId,
    approvalId: approvalObj.approvalId,
    eventId: event.eventId,
    market: event.market,
    symbol: event.symbol,
    side: intent.side,
    quantity: intent.quantity,
    fillPrice,
    cost: {
      commission: commissionRes.amount,
      tax: taxAmount,
      total: totalCost,
    },
    status: PAPER_STATUS.FILLED,
    sequence: event.sequence,
  };

  return filled(record, jsonClone(next));
}

module.exports = {
  executePaper,
};
