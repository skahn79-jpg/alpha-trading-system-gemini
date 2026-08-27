"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const cost = require("../lib/backtest/cost-policy");
const {
  validateCostPolicy,
  validateCostPolicySet,
  validateTradeCostInput,
  selectEffectiveCostPolicy,
  applyRatePpm,
  calculateCommission,
  calculateSellTaxes,
  calculateSyntheticTradeCost,
  createCostResult,
  blockedCostResult,
  makeSafeCostError,
  SAFE_ERROR_KEYS,
  ERROR,
  ROUNDING_MODE,
  CALCULATION_MODE,
  COST_CALCULATION_STATUS,
  CALCULATION_STATUS,
  EXECUTION_STATUS,
  POLICY_STATUS,
  MARKET,
  CURRENCY,
  BROKER_CHANNEL,
  MISSING_DATA,
  POLICY_ENGINE_VERSION,
} = cost;

function hasCode(result, code) {
  return (result.errorCodes && result.errorCodes.includes(code))
    || (result.errors && result.errors.some((err) => err.code === code));
}

function hasErrorCode(errors, code) {
  return errors.some((err) => err.code === code);
}

function makePolicy(overrides) {
  const base = {
    policyId: "synthetic-cost-kospi-v1",
    policyVersion: "1.0.0",
    policyStatus: POLICY_STATUS.TEST_VERIFIED,
    fixtureType: "SYNTHETIC",
    notProductionData: true,
    productionEligible: false,
    market: MARKET.SYNTHETIC_KOSPI,
    currency: CURRENCY.KRW,
    effectiveFrom: "2101-01-01",
    effectiveTo: "2101-12-31",
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    commission: {
      buyRatePpm: 100,
      sellRatePpm: 100,
      minimumBuyAmount: 0,
      minimumSellAmount: 0,
      roundingMode: ROUNDING_MODE.FLOOR,
    },
    sellTaxes: [
      {
        taxType: "SYNTHETIC_TRANSACTION_TAX",
        ratePpm: 1000,
        roundingMode: ROUNDING_MODE.FLOOR,
      },
    ],
    sourceReference: "SYNTHETIC_TEST_POLICY",
    verifiedAt: "2100-12-01T00:00:00.000Z",
  };
  if (!overrides) return base;
  const out = { ...base, ...overrides };
  if (overrides.commission) {
    out.commission = { ...base.commission, ...overrides.commission };
  }
  if (overrides.sellTaxes) {
    out.sellTaxes = overrides.sellTaxes;
  }
  return out;
}

function makeTrade(overrides) {
  const base = {
    calculationMode: CALCULATION_MODE.SYNTHETIC_UNIT_TEST_ONLY,
    market: MARKET.SYNTHETIC_KOSPI,
    currency: CURRENCY.KRW,
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    quantity: 10,
    entryTradingDate: "2101-03-10",
    exitTradingDate: "2101-03-12",
    entryPrice: 10000,
    exitPrice: 11000,
    policies: [makePolicy()],
  };
  if (!overrides) return base;
  const out = { ...base, ...overrides };
  if (overrides.policies) out.policies = overrides.policies;
  return out;
}

function policyA() {
  return makePolicy({
    policyId: "synthetic-cost-kospi-a",
    effectiveFrom: "2101-01-01",
    effectiveTo: "2101-06-30",
    commission: {
      buyRatePpm: 100,
      sellRatePpm: 100,
      minimumBuyAmount: 0,
      minimumSellAmount: 0,
      roundingMode: ROUNDING_MODE.FLOOR,
    },
  });
}

function policyB() {
  return makePolicy({
    policyId: "synthetic-cost-kospi-b",
    effectiveFrom: "2101-07-01",
    effectiveTo: "2101-12-31",
    commission: {
      buyRatePpm: 200,
      sellRatePpm: 200,
      minimumBuyAmount: 0,
      minimumSellAmount: 0,
      roundingMode: ROUNDING_MODE.FLOOR,
    },
    sellTaxes: [
      {
        taxType: "SYNTHETIC_TRANSACTION_TAX",
        ratePpm: 2000,
        roundingMode: ROUNDING_MODE.FLOOR,
      },
    ],
  });
}

function assertNeverEligible(result) {
  assert.equal(result.costPolicyVerified, false);
  assert.equal(result.backtestExecutionEligible, false);
  assert.equal(result.promotionEligible, false);
  assert.equal(result.paperEligible, false);
  assert.equal(result.liveEligible, false);
  assert.equal(result.executionStatus, EXECUTION_STATUS.NOT_EXECUTED);
}

// 1
test("정상 합성 KOSPI 정책", () => {
  const result = validateCostPolicy(makePolicy());
  assert.equal(result.ok, true);
});

// 2
test("정상 합성 KOSDAQ 정책", () => {
  const result = validateCostPolicy(makePolicy({
    policyId: "synthetic-cost-kosdaq-v1",
    market: MARKET.SYNTHETIC_KOSDAQ,
  }));
  assert.equal(result.ok, true);
});

// 3
test("알 수 없는 정책 필드 거부", () => {
  const result = validateCostPolicy(makePolicy({ extraField: 1 }));
  assert.equal(result.ok, false);
  assert.equal(hasErrorCode(result.errors, ERROR.UNKNOWN_FIELD), true);
});

// 4
test("필수 필드 누락 거부", () => {
  const policy = makePolicy();
  delete policy.policyVersion;
  const result = validateCostPolicy(policy);
  assert.equal(result.ok, false);
  assert.equal(hasErrorCode(result.errors, ERROR.MISSING_FIELD), true);
});

// 5
test("실제 시장명과 합성 정책 혼용 거부", () => {
  const result = validateCostPolicy(makePolicy({ market: "KOSPI" }));
  assert.equal(result.ok, false);
  assert.equal(hasErrorCode(result.errors, ERROR.INVALID_MARKET), true);
});

// 6
test("PRODUCTION에서 합성 정책 거부", () => {
  const result = calculateSyntheticTradeCost(makeTrade({ mode: "PRODUCTION" }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.SYNTHETIC_COST_POLICY_BLOCKED_IN_PRODUCTION), true);
});

// 7
test("잘못된 policyId 거부", () => {
  const result = validateCostPolicy(makePolicy({ policyId: "prod-cost-kospi-v1" }));
  assert.equal(result.ok, false);
  assert.equal(hasErrorCode(result.errors, ERROR.INVALID_POLICY_ID), true);
});

// 8
test("잘못된 policyVersion 거부", () => {
  const result = validateCostPolicy(makePolicy({ policyVersion: "" }));
  assert.equal(result.ok, false);
  assert.equal(hasErrorCode(result.errors, ERROR.INVALID_POLICY_VERSION), true);
});

// 9
test("미지원 policyStatus 거부", () => {
  const result = validateCostPolicy(makePolicy({ policyStatus: "DRAFT" }));
  assert.equal(result.ok, false);
  assert.equal(hasErrorCode(result.errors, ERROR.INVALID_POLICY_STATUS), true);
});

// 10
test("effectiveFrom 형식 오류", () => {
  const result = validateCostPolicy(makePolicy({ effectiveFrom: "2101/01/01" }));
  assert.equal(result.ok, false);
  assert.equal(hasErrorCode(result.errors, ERROR.INVALID_EFFECTIVE_DATE), true);
});

// 11
test("effectiveTo 형식 오류", () => {
  const result = validateCostPolicy(makePolicy({ effectiveTo: "not-a-date" }));
  assert.equal(result.ok, false);
  assert.equal(hasErrorCode(result.errors, ERROR.INVALID_EFFECTIVE_DATE), true);
});

// 12
test("effectiveFrom > effectiveTo 거부", () => {
  const result = validateCostPolicy(makePolicy({
    effectiveFrom: "2101-12-31",
    effectiveTo: "2101-01-01",
  }));
  assert.equal(result.ok, false);
  assert.equal(hasErrorCode(result.errors, ERROR.INVALID_EFFECTIVE_RANGE), true);
});

// 13
test("잘못된 통화 거부", () => {
  const result = validateCostPolicy(makePolicy({ currency: "USD" }));
  assert.equal(result.ok, false);
  assert.equal(hasErrorCode(result.errors, ERROR.INVALID_CURRENCY), true);
});

// 14
test("잘못된 brokerChannel 거부", () => {
  const result = validateCostPolicy(makePolicy({ brokerChannel: "KB_ONLINE" }));
  assert.equal(result.ok, false);
  assert.equal(hasErrorCode(result.errors, ERROR.INVALID_BROKER_CHANNEL), true);
});

// 15
test("음수 ratePpm 거부", () => {
  const result = validateCostPolicy(makePolicy({
    commission: { buyRatePpm: -1 },
  }));
  assert.equal(result.ok, false);
  assert.equal(hasErrorCode(result.errors, ERROR.INVALID_RATE_PPM), true);
});

// 16
test("소수 ratePpm 거부", () => {
  const result = validateCostPolicy(makePolicy({
    commission: { sellRatePpm: 1.5 },
  }));
  assert.equal(result.ok, false);
  assert.equal(hasErrorCode(result.errors, ERROR.INVALID_RATE_PPM), true);
});

// 17
test("문자열 ratePpm 거부", () => {
  const result = validateCostPolicy(makePolicy({
    sellTaxes: [{ taxType: "SYNTHETIC_TRANSACTION_TAX", ratePpm: "1000", roundingMode: ROUNDING_MODE.FLOOR }],
  }));
  assert.equal(result.ok, false);
  assert.equal(hasErrorCode(result.errors, ERROR.INVALID_RATE_PPM), true);
});

// 18
test("NaN·Infinity ratePpm 거부", () => {
  const nanResult = validateCostPolicy(makePolicy({
    commission: { buyRatePpm: Number.NaN },
  }));
  assert.equal(hasErrorCode(nanResult.errors, ERROR.INVALID_RATE_PPM), true);
  const infResult = validateCostPolicy(makePolicy({
    commission: { buyRatePpm: Number.POSITIVE_INFINITY },
  }));
  assert.equal(hasErrorCode(infResult.errors, ERROR.INVALID_RATE_PPM), true);
});

// 19
test("지원하지 않는 반올림 모드 거부", () => {
  const result = validateCostPolicy(makePolicy({
    commission: { roundingMode: "BANKERS" },
  }));
  assert.equal(result.ok, false);
  assert.equal(hasErrorCode(result.errors, ERROR.INVALID_ROUNDING_MODE), true);
});

// 20
test("중복 taxType 거부", () => {
  const result = validateCostPolicy(makePolicy({
    sellTaxes: [
      { taxType: "SYNTHETIC_TRANSACTION_TAX", ratePpm: 1000, roundingMode: ROUNDING_MODE.FLOOR },
      { taxType: "SYNTHETIC_TRANSACTION_TAX", ratePpm: 500, roundingMode: ROUNDING_MODE.FLOOR },
    ],
  }));
  assert.equal(result.ok, false);
  assert.equal(hasErrorCode(result.errors, ERROR.DUPLICATE_TAX_TYPE), true);
});

// 21
test("시장 일치 정책 선택", () => {
  const selected = selectEffectiveCostPolicy({
    market: MARKET.SYNTHETIC_KOSPI,
    tradingDate: "2101-03-10",
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: [makePolicy()],
  });
  assert.equal(selected.ok, true);
  assert.equal(selected.policy.policyId, "synthetic-cost-kospi-v1");
});

// 22
test("KOSPI 정책을 KOSDAQ에 적용하지 않음", () => {
  const selected = selectEffectiveCostPolicy({
    market: MARKET.SYNTHETIC_KOSDAQ,
    tradingDate: "2101-03-10",
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: [makePolicy({ market: MARKET.SYNTHETIC_KOSPI })],
  });
  assert.equal(selected.ok, false);
  assert.equal(selected.code, ERROR.COST_POLICY_MARKET_MISMATCH);
});

// 23
test("KOSDAQ 정책을 KOSPI에 적용하지 않음", () => {
  const selected = selectEffectiveCostPolicy({
    market: MARKET.SYNTHETIC_KOSPI,
    tradingDate: "2101-03-10",
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: [makePolicy({
      policyId: "synthetic-cost-kosdaq-v1",
      market: MARKET.SYNTHETIC_KOSDAQ,
    })],
  });
  assert.equal(selected.ok, false);
  assert.equal(selected.code, ERROR.COST_POLICY_MARKET_MISMATCH);
});

// 24
test("effectiveFrom 경계일 포함", () => {
  const selected = selectEffectiveCostPolicy({
    market: MARKET.SYNTHETIC_KOSPI,
    tradingDate: "2101-01-01",
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: [makePolicy()],
  });
  assert.equal(selected.ok, true);
});

// 25
test("effectiveTo 경계일 포함", () => {
  const selected = selectEffectiveCostPolicy({
    market: MARKET.SYNTHETIC_KOSPI,
    tradingDate: "2101-12-31",
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: [makePolicy()],
  });
  assert.equal(selected.ok, true);
});

// 26
test("정책 변경 전 날짜는 정책 A", () => {
  const selected = selectEffectiveCostPolicy({
    market: MARKET.SYNTHETIC_KOSPI,
    tradingDate: "2101-03-10",
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: [policyA(), policyB()],
  });
  assert.equal(selected.ok, true);
  assert.equal(selected.policy.policyId, "synthetic-cost-kospi-a");
});

// 27
test("정책 변경 후 날짜는 정책 B", () => {
  const selected = selectEffectiveCostPolicy({
    market: MARKET.SYNTHETIC_KOSPI,
    tradingDate: "2101-08-01",
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: [policyA(), policyB()],
  });
  assert.equal(selected.ok, true);
  assert.equal(selected.policy.policyId, "synthetic-cost-kospi-b");
});

// 28
test("해당 정책 없음", () => {
  const selected = selectEffectiveCostPolicy({
    market: MARKET.SYNTHETIC_KOSPI,
    tradingDate: "2102-01-01",
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: [makePolicy({ effectiveFrom: "2101-01-01", effectiveTo: "2101-12-31" })],
  });
  assert.equal(selected.ok, false);
  assert.equal(selected.code, ERROR.COST_POLICY_NOT_FOUND);
});

// 29
test("정책 날짜 공백 감지", () => {
  const result = validateCostPolicySet([
    policyA(),
    makePolicy({
      policyId: "synthetic-cost-kospi-gap",
      effectiveFrom: "2101-07-02",
      effectiveTo: "2101-12-31",
    }),
  ]);
  assert.equal(result.ok, false);
  assert.equal(hasErrorCode(result.errors, ERROR.COST_POLICY_GAP), true);
});

// 30
test("정책 날짜 중첩 감지", () => {
  const result = validateCostPolicySet([
    makePolicy({ effectiveFrom: "2101-01-01", effectiveTo: "2101-06-30" }),
    makePolicy({
      policyId: "synthetic-cost-kospi-overlap",
      effectiveFrom: "2101-06-01",
      effectiveTo: "2101-12-31",
    }),
  ]);
  assert.equal(result.ok, false);
  assert.equal(hasErrorCode(result.errors, ERROR.COST_POLICY_OVERLAP), true);
});

// 31
test("입력 순서 변경에도 같은 선택 결과", () => {
  const policies = [policyB(), policyA()];
  const shuffled = [policies[1], policies[0]];
  const a = selectEffectiveCostPolicy({
    market: MARKET.SYNTHETIC_KOSPI,
    tradingDate: "2101-03-10",
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies,
  });
  const b = selectEffectiveCostPolicy({
    market: MARKET.SYNTHETIC_KOSPI,
    tradingDate: "2101-03-10",
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: shuffled,
  });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.policy.policyId, b.policy.policyId);
});

// 32
test("종료 정책 자동 연장 금지", () => {
  const selected = selectEffectiveCostPolicy({
    market: MARKET.SYNTHETIC_KOSPI,
    tradingDate: "2102-06-01",
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: [makePolicy({ effectiveFrom: "2101-01-01", effectiveTo: "2101-12-31" })],
  });
  assert.equal(selected.ok, false);
  assert.equal(selected.code, ERROR.COST_POLICY_NOT_FOUND);
});

// 33
test("미래 정책 소급 적용 금지", () => {
  const selected = selectEffectiveCostPolicy({
    market: MARKET.SYNTHETIC_KOSPI,
    tradingDate: "2100-12-31",
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: [makePolicy({ effectiveFrom: "2101-01-01", effectiveTo: "2101-12-31" })],
  });
  assert.equal(selected.ok, false);
  assert.equal(selected.code, ERROR.COST_POLICY_NOT_FOUND);
});

// 34
test("open-ended 정책 뒤 신규 정책 중첩 감지", () => {
  const result = validateCostPolicySet([
    makePolicy({ effectiveFrom: "2101-01-01", effectiveTo: null }),
    makePolicy({
      policyId: "synthetic-cost-kospi-next",
      effectiveFrom: "2101-07-01",
      effectiveTo: "2101-12-31",
    }),
  ]);
  assert.equal(result.ok, false);
  assert.equal(hasErrorCode(result.errors, ERROR.COST_POLICY_OVERLAP), true);
});

// 35
test("USER_APPROVAL_REQUIRED 계산 차단", () => {
  const result = calculateSyntheticTradeCost(makeTrade({
    policies: [makePolicy({ policyStatus: POLICY_STATUS.USER_APPROVAL_REQUIRED })],
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.COST_POLICY_NOT_VERIFIED), true);
});

// 36
test("REVOKED 정책 차단", () => {
  const result = calculateSyntheticTradeCost(makeTrade({
    policies: [makePolicy({ policyStatus: POLICY_STATUS.REVOKED })],
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.COST_POLICY_REVOKED), true);
});

// 37
test("FLOOR 정상 계산", () => {
  const result = applyRatePpm(100000, 100, ROUNDING_MODE.FLOOR);
  assert.equal(result.ok, true);
  assert.equal(result.amount, 10);
});

// 38
test("FLOOR 경계 계산", () => {
  const result = applyRatePpm(999999, 1, ROUNDING_MODE.FLOOR);
  assert.equal(result.ok, true);
  assert.equal(result.amount, 0);
});

// 39
test("CEIL 정상 계산", () => {
  const result = applyRatePpm(100000, 100, ROUNDING_MODE.CEIL);
  assert.equal(result.ok, true);
  assert.equal(result.amount, 10);
});

// 40
test("CEIL 나머지 0", () => {
  const result = applyRatePpm(1000000, 1000, ROUNDING_MODE.CEIL);
  assert.equal(result.ok, true);
  assert.equal(result.amount, 1000);
});

// 41
test("ROUND_HALF_UP 0.5 미만", () => {
  const result = applyRatePpm(1499999, 1, ROUNDING_MODE.ROUND_HALF_UP);
  assert.equal(result.ok, true);
  assert.equal(result.amount, 1);
});

// 42
test("ROUND_HALF_UP 정확히 0.5", () => {
  const result = applyRatePpm(500000, 1, ROUNDING_MODE.ROUND_HALF_UP);
  assert.equal(result.ok, true);
  assert.equal(result.amount, 1);
});

// 43
test("ROUND_HALF_UP 0.5 초과", () => {
  const result = applyRatePpm(500001, 1, ROUNDING_MODE.ROUND_HALF_UP);
  assert.equal(result.ok, true);
  assert.equal(result.amount, 1);
});

// 44
test("ratePpm 0", () => {
  const result = applyRatePpm(100000, 0, ROUNDING_MODE.FLOOR);
  assert.equal(result.ok, true);
  assert.equal(result.amount, 0);
});

// 45
test("금액 0", () => {
  const result = applyRatePpm(0, 100, ROUNDING_MODE.FLOOR);
  assert.equal(result.ok, true);
  assert.equal(result.amount, 0);
});

// 46
test("최소 수수료 적용", () => {
  const result = calculateCommission({
    amount: 1000,
    ratePpm: 100,
    minimumAmount: 50,
    roundingMode: ROUNDING_MODE.FLOOR,
  });
  assert.equal(result.ok, true);
  assert.equal(result.amount, 50);
});

// 47
test("최소 수수료와 계산 수수료 동일", () => {
  const result = calculateCommission({
    amount: 100000,
    ratePpm: 100,
    minimumAmount: 10,
    roundingMode: ROUNDING_MODE.FLOOR,
  });
  assert.equal(result.ok, true);
  assert.equal(result.amount, 10);
});

// 48
test("계산 수수료가 최소 수수료 초과", () => {
  const result = calculateCommission({
    amount: 100000,
    ratePpm: 100,
    minimumAmount: 5,
    roundingMode: ROUNDING_MODE.FLOOR,
  });
  assert.equal(result.ok, true);
  assert.equal(result.amount, 10);
});

// 49
test("안전 정수 경계", () => {
  const amount = Math.floor(Number.MAX_SAFE_INTEGER / 100);
  const result = applyRatePpm(amount, 100, ROUNDING_MODE.FLOOR);
  assert.equal(result.ok, true);
  assert.equal(result.amount, Math.floor((amount * 100) / 1000000));
});

// 50
test("곱셈 overflow 차단", () => {
  const result = calculateSyntheticTradeCost(makeTrade({
    quantity: Number.MAX_SAFE_INTEGER,
    entryPrice: 2,
    exitPrice: 2,
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.ARITHMETIC_OVERFLOW), true);
});

// 51
test("정상 단일 합성 거래", () => {
  const result = calculateSyntheticTradeCost(makeTrade());
  assert.equal(result.ok, true);
  assert.equal(result.entryAmount, 100000);
  assert.equal(result.exitAmount, 110000);
  assert.equal(result.entryCommission, 10);
  assert.equal(result.exitCommission, 11);
  assert.equal(result.sellTaxTotal, 110);
  assert.equal(result.totalCost, 131);
  assert.equal(result.grossProfit, 10000);
  assert.equal(result.netProfit, 9869);
  assert.equal(result.costCalculationStatus, COST_CALCULATION_STATUS.CALCULATED_SYNTHETIC_ONLY);
});

// 52
test("매수 수수료 계산", () => {
  const result = calculateSyntheticTradeCost(makeTrade());
  assert.equal(result.entryCommission, 10);
});

// 53
test("매도 수수료 계산", () => {
  const result = calculateSyntheticTradeCost(makeTrade());
  assert.equal(result.exitCommission, 11);
});

// 54
test("매도 세금 개별 반올림", () => {
  const result = calculateSyntheticTradeCost(makeTrade({
    policies: [makePolicy({
      sellTaxes: [
        { taxType: "TAX_A", ratePpm: 333333, roundingMode: ROUNDING_MODE.CEIL },
      ],
    })],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.sellTaxes[0].amount, 36667);
});

// 55
test("복수 매도 세금 합계", () => {
  const result = calculateSyntheticTradeCost(makeTrade({
    policies: [makePolicy({
      sellTaxes: [
        { taxType: "TAX_A", ratePpm: 1000, roundingMode: ROUNDING_MODE.FLOOR },
        { taxType: "TAX_B", ratePpm: 500, roundingMode: ROUNDING_MODE.FLOOR },
      ],
    })],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.sellTaxTotal, 110 + 55);
});

// 56
test("총비용 계산", () => {
  const result = calculateSyntheticTradeCost(makeTrade());
  assert.equal(result.totalCost, result.entryCommission + result.exitCommission + result.sellTaxTotal);
});

// 57
test("grossProfit 계산", () => {
  const result = calculateSyntheticTradeCost(makeTrade());
  assert.equal(result.grossProfit, result.exitAmount - result.entryAmount);
});

// 58
test("netProfit 계산", () => {
  const result = calculateSyntheticTradeCost(makeTrade());
  assert.equal(result.netProfit, result.grossProfit - result.totalCost);
});

// 59
test("매수에는 sellTaxes 미적용", () => {
  const result = calculateSyntheticTradeCost(makeTrade({
    policies: [makePolicy({
      sellTaxes: [
        { taxType: "SYNTHETIC_TRANSACTION_TAX", ratePpm: 999999, roundingMode: ROUNDING_MODE.FLOOR },
      ],
    })],
  }));
  assert.equal(result.entryCommission, 10);
  assert.equal(result.sellTaxTotal, 109999);
  assert.equal(result.exitCommission, 11);
});

// 60
test("진입일 정책 A·청산일 정책 B", () => {
  const result = calculateSyntheticTradeCost(makeTrade({
    entryTradingDate: "2101-03-10",
    exitTradingDate: "2101-08-01",
    policies: [policyA(), policyB()],
  }));
  assert.equal(result.ok, true);
  assert.equal(result.entryPolicyId, "synthetic-cost-kospi-a");
  assert.equal(result.exitPolicyId, "synthetic-cost-kospi-b");
  assert.equal(result.entryCommission, 10);
  assert.equal(result.exitCommission, 22);
  assert.equal(result.sellTaxTotal, 220);
});

// 61
test("진입일 정책 미발견 차단", () => {
  const result = calculateSyntheticTradeCost(makeTrade({
    entryTradingDate: "2102-01-01",
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.COST_POLICY_NOT_FOUND), true);
});

// 62
test("청산일 정책 미발견 차단", () => {
  const result = calculateSyntheticTradeCost(makeTrade({
    exitTradingDate: "2102-01-01",
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.COST_POLICY_NOT_FOUND), true);
});

// 63
test("시장 불일치 차단", () => {
  const result = calculateSyntheticTradeCost(makeTrade({
    market: MARKET.SYNTHETIC_KOSDAQ,
    policies: [makePolicy({ market: MARKET.SYNTHETIC_KOSPI })],
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.COST_POLICY_MARKET_MISMATCH), true);
});

// 64
test("통화 불일치 차단", () => {
  const result = calculateSyntheticTradeCost(makeTrade({
    currency: "USD",
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_CURRENCY), true);
});

// 65
test("채널 불일치 차단", () => {
  const result = calculateSyntheticTradeCost(makeTrade({
    brokerChannel: "KB_ONLINE",
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_BROKER_CHANNEL), true);
});

// 66
test("quantity 소수 거부", () => {
  const result = calculateSyntheticTradeCost(makeTrade({ quantity: 1.5 }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.INVALID_QUANTITY), true);
});

// 67
test("price 문자열·NaN·Infinity 거부", () => {
  const stringPrice = calculateSyntheticTradeCost(makeTrade({ entryPrice: "10000" }));
  assert.equal(hasCode(stringPrice, ERROR.INVALID_PRICE), true);
  const nanPrice = calculateSyntheticTradeCost(makeTrade({ exitPrice: Number.NaN }));
  assert.equal(hasCode(nanPrice, ERROR.INVALID_PRICE), true);
  const infPrice = calculateSyntheticTradeCost(makeTrade({ entryPrice: Number.POSITIVE_INFINITY }));
  assert.equal(hasCode(infPrice, ERROR.INVALID_PRICE), true);
});

// 68
test("입력 정책 배열 불변", () => {
  const policies = Object.freeze([
    Object.freeze(makePolicy()),
  ]);
  const input = makeTrade({ policies });
  const snapshot = JSON.stringify(policies);
  calculateSyntheticTradeCost(input);
  assert.equal(JSON.stringify(policies), snapshot);
  assert.equal(Object.isFrozen(policies), true);
});

// 69
test("입력 거래 객체 불변", () => {
  const trade = Object.freeze(makeTrade());
  const snapshot = JSON.stringify(trade);
  calculateSyntheticTradeCost(trade);
  assert.equal(JSON.stringify(trade), snapshot);
});

// 70
test("동일 입력은 동일 결과", () => {
  const input = makeTrade();
  const a = calculateSyntheticTradeCost(input);
  const b = calculateSyntheticTradeCost(input);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

// 71
test("executionStatus는 NOT_EXECUTED", () => {
  const result = calculateSyntheticTradeCost(makeTrade());
  assert.equal(result.executionStatus, EXECUTION_STATUS.NOT_EXECUTED);
});

// 72
test("calculationStatus는 SIMULATED_CALCULATION_ONLY", () => {
  const result = calculateSyntheticTradeCost(makeTrade());
  assert.equal(result.calculationStatus, CALCULATION_STATUS.SIMULATED_CALCULATION_ONLY);
});

// 73
test("backtestExecutionEligible false", () => {
  const result = calculateSyntheticTradeCost(makeTrade());
  assert.equal(result.backtestExecutionEligible, false);
});

// 74
test("promotion·Paper·Live false", () => {
  const result = calculateSyntheticTradeCost(makeTrade());
  assertNeverEligible(result);
});

// 75
test("전체 성과지표 null", () => {
  const result = calculateSyntheticTradeCost(makeTrade());
  assert.equal(result.totalReturn, null);
  assert.equal(result.cagr, null);
  assert.equal(result.mdd, null);
  assert.equal(result.winRate, null);
  assert.equal(result.profitFactor, null);
});

// 76
test("운영 비용정책 결측 상태 보존", () => {
  const result = calculateSyntheticTradeCost(makeTrade());
  assert.equal(result.missingData.includes(MISSING_DATA.PRODUCTION_COST_POLICY_NOT_CONFIGURED), true);
});

// 77
test("캘린더 미검증 상태 보존", () => {
  const result = calculateSyntheticTradeCost(makeTrade());
  assert.equal(result.missingData.includes(MISSING_DATA.CALENDAR_VALIDATION_NOT_IMPLEMENTED), true);
});

// 78
test("오류 객체에 전체 정책 배열 없음", () => {
  const err = makeSafeCostError({
    code: ERROR.COST_POLICY_NOT_FOUND,
    policies: [makePolicy()],
    input: makeTrade(),
  });
  assert.equal(Object.hasOwn(err, "policies"), false);
  assert.equal(Object.hasOwn(err, "input"), false);
});

// 79
test("오류 객체에 전체 거래 입력 없음", () => {
  const err = makeSafeCostError({
    code: ERROR.INVALID_PRICE,
    field: "entryPrice",
    tradeInput: makeTrade(),
    dataset: {},
  });
  assert.equal(Object.hasOwn(err, "tradeInput"), false);
  assert.equal(Object.hasOwn(err, "dataset"), false);
});

// 80
test("주문·네트워크 모듈 참조 없음", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../lib/backtest/cost-policy.js"),
    "utf8",
  );
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("axios"), false);
  assert.equal(/require\(["']http["']\)/.test(source), false);
  assert.equal(source.includes("/api/trading"), false);
  assert.equal(/kb\/broker/.test(source), false);
  assert.equal(source.includes('require("./execution-model")'), false);
  assert.equal(source.includes('require("./data-validation")'), false);
});

test("validateCostPolicy 추가: sourceReference 허용", () => {
  const result = validateCostPolicy(makePolicy({ sourceReference: "SYNTHETIC_REF" }));
  assert.equal(result.ok, true);
});

test("validateCostPolicy 추가: notProductionData false 거부", () => {
  const result = validateCostPolicy(makePolicy({ notProductionData: false }));
  assert.equal(result.ok, false);
});

test("validateCostPolicy 추가: productionEligible true 거부", () => {
  const result = validateCostPolicy(makePolicy({ productionEligible: true }));
  assert.equal(result.ok, false);
});

test("validateCostPolicySet 추가: 단일 정책 정상", () => {
  const result = validateCostPolicySet([makePolicy()]);
  assert.equal(result.ok, true);
});

test("validateCostPolicySet 추가: 인접 정책 경계 연속", () => {
  const result = validateCostPolicySet([policyA(), policyB()]);
  assert.equal(result.ok, true);
});

test("validateCostPolicySet 추가: policies 비배열 거부", () => {
  const result = validateCostPolicySet(null);
  assert.equal(result.ok, false);
});

test("validateTradeCostInput 추가: 정상 입력", () => {
  const result = validateTradeCostInput(makeTrade());
  assert.equal(result.ok, true);
});

test("validateTradeCostInput 추가: 알 수 없는 필드", () => {
  const result = validateTradeCostInput(makeTrade({ unknown: true }));
  assert.equal(result.ok, false);
  assert.equal(hasErrorCode(result.errors, ERROR.UNKNOWN_FIELD), true);
});

test("validateTradeCostInput 추가: UNSUPPORTED_CALCULATION_MODE", () => {
  const result = validateTradeCostInput(makeTrade({ calculationMode: "PRODUCTION" }));
  assert.equal(result.ok, false);
  assert.equal(hasErrorCode(result.errors, ERROR.SYNTHETIC_COST_POLICY_BLOCKED_IN_PRODUCTION), true);
});

test("selectEffectiveCostPolicy 추가: 2개 이상 중첩 선택", () => {
  const selected = selectEffectiveCostPolicy({
    market: MARKET.SYNTHETIC_KOSPI,
    tradingDate: "2101-03-10",
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: [
      makePolicy({ effectiveFrom: "2101-01-01", effectiveTo: "2101-12-31" }),
      makePolicy({
        policyId: "synthetic-cost-kospi-dup",
        effectiveFrom: "2101-01-01",
        effectiveTo: "2101-12-31",
      }),
    ],
  });
  assert.equal(selected.ok, false);
  assert.equal(selected.code, ERROR.COST_POLICY_OVERLAP);
});

test("selectEffectiveCostPolicy 추가: 채널 불일치 NOT_FOUND", () => {
  const selected = selectEffectiveCostPolicy({
    market: MARKET.SYNTHETIC_KOSPI,
    tradingDate: "2101-03-10",
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: [makePolicy({ brokerChannel: "OTHER" })],
  });
  assert.equal(selected.code, ERROR.COST_POLICY_NOT_FOUND);
});

test("selectEffectiveCostPolicy 추가: 정책 없음 NOT_FOUND", () => {
  const selected = selectEffectiveCostPolicy({
    market: MARKET.SYNTHETIC_KOSPI,
    tradingDate: "2101-03-10",
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    policies: [],
  });
  assert.equal(selected.code, ERROR.COST_POLICY_NOT_FOUND);
});

test("applyRatePpm 추가: CEIL 나머지 있음", () => {
  const result = applyRatePpm(1, 1, ROUNDING_MODE.CEIL);
  assert.equal(result.ok, true);
  assert.equal(result.amount, 1);
});

test("applyRatePpm 추가: ROUND_HALF_UP 올림", () => {
  const result = applyRatePpm(1500000, 1, ROUNDING_MODE.ROUND_HALF_UP);
  assert.equal(result.ok, true);
  assert.equal(result.amount, 2);
});

test("applyRatePpm 추가: 잘못된 amount", () => {
  const result = applyRatePpm(-1, 100, ROUNDING_MODE.FLOOR);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.INVALID_MONEY_AMOUNT);
});

test("calculateCommission 추가: 정상", () => {
  const result = calculateCommission({
    amount: 100000,
    ratePpm: 100,
    minimumAmount: 0,
    roundingMode: ROUNDING_MODE.FLOOR,
  });
  assert.equal(result.ok, true);
  assert.equal(result.amount, 10);
});

test("calculateCommission 추가: 최소 0", () => {
  const result = calculateCommission({
    amount: 0,
    ratePpm: 100,
    minimumAmount: 0,
    roundingMode: ROUNDING_MODE.FLOOR,
  });
  assert.equal(result.amount, 0);
});

test("calculateCommission 추가: overflow 전파", () => {
  const result = calculateCommission({
    amount: Number.MAX_SAFE_INTEGER,
    ratePpm: Number.MAX_SAFE_INTEGER,
    minimumAmount: 0,
    roundingMode: ROUNDING_MODE.FLOOR,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.ARITHMETIC_OVERFLOW);
});

test("calculateSellTaxes 추가: 정상", () => {
  const result = calculateSellTaxes({
    amount: 110000,
    sellTaxes: [
      { taxType: "SYNTHETIC_TRANSACTION_TAX", ratePpm: 1000, roundingMode: ROUNDING_MODE.FLOOR },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.total, 110);
});

test("calculateSellTaxes 추가: 빈 배열", () => {
  const result = calculateSellTaxes({ amount: 100000, sellTaxes: [] });
  assert.equal(result.ok, true);
  assert.equal(result.total, 0);
});

test("calculateSellTaxes 추가: 잘못된 amount", () => {
  const result = calculateSellTaxes({ amount: -1, sellTaxes: [] });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.INVALID_MONEY_AMOUNT);
});

test("calculateSyntheticTradeCost 추가: policyEngineVersion 불일치", () => {
  const result = calculateSyntheticTradeCost(makeTrade({ policyEngineVersion: "other-v9" }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.UNSUPPORTED_POLICY_ENGINE_VERSION), true);
});

test("calculateSyntheticTradeCost 추가: productionEligible 정책 차단", () => {
  const result = calculateSyntheticTradeCost(makeTrade({
    policies: [makePolicy({ productionEligible: true })],
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.SYNTHETIC_COST_POLICY_BLOCKED_IN_PRODUCTION), true);
});

test("calculateSyntheticTradeCost 추가: VERIFIED 정책 계산 차단", () => {
  const result = calculateSyntheticTradeCost(makeTrade({
    policies: [makePolicy({ policyStatus: POLICY_STATUS.VERIFIED })],
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.COST_POLICY_NOT_VERIFIED), true);
});

test("createCostResult 추가: 성공 플래그", () => {
  const result = createCostResult({ ok: true, costCalculationEligible: true });
  assert.equal(result.policyEngineVersion, POLICY_ENGINE_VERSION);
  assert.equal(result.costPolicyVerified, false);
  assert.equal(result.costCalculationEligible, true);
});

test("createCostResult 추가: 실패 시 costCalculationEligible false", () => {
  const result = createCostResult({ ok: false });
  assert.equal(result.costCalculationEligible, false);
});

test("createCostResult 추가: missingData 기본 포함", () => {
  const result = createCostResult({ ok: false });
  assert.equal(result.missingData.includes(MISSING_DATA.PRODUCTION_COST_POLICY_NOT_CONFIGURED), true);
  assert.equal(result.missingData.includes(MISSING_DATA.CALENDAR_VALIDATION_NOT_IMPLEMENTED), true);
});

test("makeSafeCostError 추가: 허용 필드만", () => {
  const err = makeSafeCostError({
    code: ERROR.INVALID_MARKET,
    field: "market",
    policyId: "synthetic-cost-kospi-v1",
    secrets: { token: "x" },
  });
  assert.equal(err.code, ERROR.INVALID_MARKET);
  assert.equal(err.policyId, "synthetic-cost-kospi-v1");
  assert.equal(Object.hasOwn(err, "secrets"), false);
});

test("makeSafeCostError 추가: severity 기본 ERROR", () => {
  const err = makeSafeCostError({ code: ERROR.INVALID_INPUT });
  assert.equal(err.severity, "ERROR");
});

test("makeSafeCostError 추가: WARNING severity 허용", () => {
  const err = makeSafeCostError({ code: ERROR.INVALID_INPUT, severity: "WARNING" });
  assert.equal(err.severity, "WARNING");
});

test("GATE6Q-G01 source pins shared makeBacktestError adapter", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../lib/backtest/cost-policy.js"),
    "utf8"
  );
  assert.equal(src.includes('require("./make-error")'), true);
  assert.equal(src.includes("makeBacktestError"), true);
  assert.equal(src.includes("function makeError"), false);
  assert.equal(src.includes("const err = makeBacktestError(raw.code, extra)"), true);
  assert.equal(src.includes("if (raw.code == null)"), true);
  assert.equal(src.includes("err.severity = raw.severity != null ? raw.severity : \"ERROR\""), true);
  assert.equal(src.includes("for (const key of SAFE_ERROR_KEYS)"), true);
  assert.equal(src.includes("return { severity: \"ERROR\" }"), true);
});

test("GATE6Q-G02 unknown field keeps cost extras and stays inside SAFE_ERROR_KEYS", () => {
  const result = validateCostPolicy(makePolicy({ extraField: 1 }));
  assert.equal(result.ok, false);
  const err = result.errors.find((e) => e.code === ERROR.UNKNOWN_FIELD);
  assert.equal(err.field, "extraField");
  assert.equal(err.severity, "ERROR");
  const allowed = new Set(SAFE_ERROR_KEYS);
  for (const key of Object.keys(err)) {
    assert.equal(allowed.has(key), true, key);
  }
});

test("GATE6Q-G03 non-object input keeps severity ERROR without a code key", () => {
  const err = makeSafeCostError(null);
  assert.deepEqual(err, { severity: "ERROR" });
  assert.equal(Object.prototype.hasOwnProperty.call(err, "code"), false);
});

test("GATE6Q-G04 adapter copies cost extras and drops cause tradeId stage", () => {
  const err = makeSafeCostError({
    code: ERROR.UNKNOWN_FIELD,
    field: "extraField",
    policyId: "synthetic-cost-kospi-v1",
    policyVersion: "1.0.0",
    brokerChannel: BROKER_CHANNEL.SYNTHETIC_ONLINE,
    currency: CURRENCY.KRW,
    taxType: "SEC",
    cause: "TRAIN_ROOT_A",
    tradeId: "T1",
    stage: "DATA",
  });
  assert.equal(err.field, "extraField");
  assert.equal(err.policyId, "synthetic-cost-kospi-v1");
  assert.equal(err.policyVersion, "1.0.0");
  assert.equal(err.brokerChannel, BROKER_CHANNEL.SYNTHETIC_ONLINE);
  assert.equal(err.currency, CURRENCY.KRW);
  assert.equal(err.taxType, "SEC");
  assert.equal(err.severity, "ERROR");
  assert.equal(Object.prototype.hasOwnProperty.call(err, "cause"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(err, "tradeId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(err, "stage"), false);
});

test("GATE6Q-G05 missing or null code omits the code key", () => {
  const missing = makeSafeCostError({ field: "policyId" });
  assert.equal(Object.prototype.hasOwnProperty.call(missing, "code"), false);
  assert.equal(missing.severity, "ERROR");
  const nulled = makeSafeCostError({ code: null, field: "policyId" });
  assert.equal(Object.prototype.hasOwnProperty.call(nulled, "code"), false);
  assert.equal(nulled.field, "policyId");
});

test("GATE6Q-G06 non-null non-string severity is preserved", () => {
  const empty = makeSafeCostError({ code: ERROR.INVALID_INPUT, severity: "" });
  assert.equal(empty.code, ERROR.INVALID_INPUT);
  assert.equal(empty.severity, "");
  const numeric = makeSafeCostError({ code: ERROR.INVALID_INPUT, severity: 0 });
  assert.equal(numeric.severity, 0);
});

test("GATE7C-C01 late policy-status fail after amounts keeps null leftover amounts", () => {
  const result = calculateSyntheticTradeCost(makeTrade({
    policies: [makePolicy({ policyStatus: POLICY_STATUS.VERIFIED })],
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.COST_POLICY_NOT_VERIFIED), true);
  assert.equal(result.entryAmount, null);
  assert.equal(result.exitAmount, null);
  assertNeverEligible(result);
});

test("GATE7C-C02 early multiply overflow still null amounts", () => {
  const result = calculateSyntheticTradeCost(makeTrade({
    quantity: Number.MAX_SAFE_INTEGER,
    entryPrice: 2,
    exitPrice: 2,
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, ERROR.ARITHMETIC_OVERFLOW), true);
  assert.equal(result.entryAmount, null);
  assert.equal(result.exitAmount, null);
  assertNeverEligible(result);
});

test("GATE7F-A01 makeSafeCostError still drops null extras", () => {
  const err = makeSafeCostError({ code: ERROR.INVALID_INPUT, field: null });
  assert.equal(err.code, ERROR.INVALID_INPUT);
  assert.equal(Object.prototype.hasOwnProperty.call(err, "field"), false);
});

test("GATE7X-C01 blockedCostResult extra cannot overwrite ok/errors/flags/amounts", () => {
  const first = [{ code: ERROR.INVALID_INPUT, field: "quantity" }];
  const other = [{ code: ERROR.ARITHMETIC_OVERFLOW, field: "totalCost" }];
  const extra = {
    ok: true,
    liveEligible: true,
    costCalculationEligible: true,
    entryAmount: 1,
    exitAmount: 2,
    totalCost: 3,
    errors: other,
  };
  const result = blockedCostResult(first, extra);
  assert.equal(result.ok, false);
  assert.equal(result.costCalculationEligible, false);
  assert.equal(result.liveEligible, false);
  assert.equal(result.entryAmount, null);
  assert.equal(result.exitAmount, null);
  assert.equal(result.totalCost, null);
  assert.equal(hasCode(result, ERROR.INVALID_INPUT), true);
  assert.equal(hasCode(result, ERROR.ARITHMETIC_OVERFLOW), false);
  assert.equal(result.errors === other, false);
  first.push({ code: ERROR.COST_POLICY_NOT_VERIFIED });
  other.push({ code: ERROR.COST_POLICY_GAP });
  assert.equal(hasCode(result, ERROR.COST_POLICY_NOT_VERIFIED), false);
  assert.equal(hasCode(result, ERROR.COST_POLICY_GAP), false);
  assertNeverEligible(result);
});

test("GATE7Y-X01 freeze pins blockedCostResult extra allowlist", () => {
  const src = fs.readFileSync(path.join(__dirname, "../lib/backtest/cost-policy.js"), "utf8");
  const start = src.indexOf("function blockedCostResult");
  const end = src.indexOf("function calculateSyntheticTradeCost");
  assert.equal(start >= 0, true);
  assert.equal(end > start, true);
  const block = src.slice(start, end);
  assert.equal(block.includes("warnings: src.warnings"), true);
  assert.equal(block.includes("missingData: src.missingData"), true);
  assert.equal(block.includes("...src"), false);
  const forbidden = [
    "entryAmount",
    "exitAmount",
    "totalCost",
    "grossProfit",
    "netProfit",
    "entryCommission",
    "exitCommission",
    "sellTaxes",
    "sellTaxTotal",
    "liveEligible",
    "paperEligible",
    "promotionEligible",
    "backtestExecutionEligible",
    "costPolicyVerified",
  ];
  for (const key of forbidden) {
    assert.equal(block.includes(key), false);
  }
  const litStart = block.indexOf("createCostResult({");
  const litEnd = block.indexOf("});", litStart);
  assert.equal(litStart >= 0, true);
  assert.equal(litEnd > litStart, true);
  const lit = block.slice(litStart, litEnd);
  assert.equal(lit.includes("ok: false"), true);
  assert.equal(lit.includes("costCalculationEligible: false"), true);
  assert.equal(lit.includes("errors,"), true);
});


test("GATE8G-C01 createCostResult sellTaxes copy does not spread t", () => {
  const src = fs.readFileSync(path.join(__dirname, "../lib/backtest/cost-policy.js"), "utf8");
  const start = src.indexOf("function createCostResult");
  const end = src.indexOf("function collectUnknownKeys");
  assert.equal(start >= 0, true);
  assert.equal(end > start, true);
  const block = src.slice(start, end);
  assert.equal(block.includes("{ ...t"), false);
  assert.equal(block.includes("taxType: t && t.taxType"), true);
  assert.equal(block.includes("amount: t && t.amount"), true);
});

test("GATE8G-C02 copied sellTaxes keep taxType and amount, drop extras", () => {
  const result = createCostResult({
    ok: true,
    costCalculationEligible: true,
    sellTaxes: [{ taxType: "TAX_A", amount: 1, junkKey: true, liveEligible: true, ratePpm: 9 }],
  });
  assert.equal(Array.isArray(result.sellTaxes), true);
  assert.equal(result.sellTaxes.length, 1);
  assert.equal(result.sellTaxes[0].taxType, "TAX_A");
  assert.equal(result.sellTaxes[0].amount, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(result.sellTaxes[0], "junkKey"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.sellTaxes[0], "liveEligible"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.sellTaxes[0], "ratePpm"), false);
  assert.equal(result.liveEligible, false);
});

test("GATE8G-F01 lifecycle still freezes 8F", () => {
  const src = fs.readFileSync(path.join(__dirname, "../lib/backtest/multi-trade-lifecycle.js"), "utf8");
  assert.equal(src.includes("8F freeze"), true);
});
