"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PERFORMANCE_STATUS,
  UNIT,
  SYNTHETIC_PERFORMANCE_FIXTURE,
} = require("../lib/backtest/schemas");

const {
  METRIC_STATUS,
  TRADE_OUTCOME,
  DAYS_PER_YEAR,
  computeTotalReturn,
  computeCagr,
  computeMdd,
  classifyTrade,
  computeWinRate,
  validateTradeAggregates,
  computeProfitToLossRatio,
  computeProfitFactor,
  computeExpectedValue,
  createNotExecutedPerformanceResult,
} = require("../lib/backtest/performance");

const SYNTHETIC = { synthetic: true };

function assertSyntheticCalculated(result, expectedValue, unit) {
  assert.equal(result.value, expectedValue);
  assert.equal(result.status, PERFORMANCE_STATUS.SYNTHETIC_FIXTURE_CALCULATED);
  assert.equal(result.fixtureTag, SYNTHETIC_PERFORMANCE_FIXTURE);
  assert.equal(result.notActualPerformance, true);
  assert.equal(result.promotionEligible, false);
  if (unit) assert.equal(result.unit, unit);
}

test("총수익률 이익", () => {
  const expected = 110 / 100 - 1;
  assertSyntheticCalculated(computeTotalReturn(100, 110, SYNTHETIC), expected, UNIT.RATIO);
});

test("총수익률 손실", () => {
  const expected = 90 / 100 - 1;
  assertSyntheticCalculated(computeTotalReturn(100, 90, SYNTHETIC), expected, UNIT.RATIO);
});

test("총수익률 원금 동일", () => {
  const expected = 100 / 100 - 1;
  assertSyntheticCalculated(computeTotalReturn(100, 100, SYNTHETIC), expected, UNIT.RATIO);
});

test("총수익률 시작자산 0", () => {
  const result = computeTotalReturn(0, 100, SYNTHETIC);
  assert.equal(result.value, null);
  assert.equal(result.status, METRIC_STATUS.INVALID_BEGINNING_EQUITY);
  assert.equal(result.fixtureTag, null);
});

test("총수익률 종료자산 음수", () => {
  const result = computeTotalReturn(100, -1, SYNTHETIC);
  assert.equal(result.value, null);
  assert.equal(result.status, METRIC_STATUS.INVALID_ENDING_EQUITY);
});

test("총수익률 문자열·비유한 입력", () => {
  assert.equal(computeTotalReturn("100", 110, SYNTHETIC).status, METRIC_STATUS.INVALID_INPUT);
  assert.equal(computeTotalReturn(100, NaN, SYNTHETIC).status, METRIC_STATUS.INVALID_INPUT);
});

test("CAGR 1년 이상과 HYPOTHESIS", () => {
  const beginningEquity = 100;
  const endingEquity = 121;
  const result = computeCagr({
    beginningEquity,
    endingEquity,
    startDate: "2100-01-01",
    endDate: "2102-01-01",
    minimumAnnualizationDays: 30,
    parameterStatus: "HYPOTHESIS",
  }, SYNTHETIC);
  const expected = (endingEquity / beginningEquity) ** (1 / (730 / 365.2425)) - 1;
  assertSyntheticCalculated(result, expected, UNIT.RATIO);
  assert.equal(result.parameterStatus, METRIC_STATUS.PARAMETER_STATUS_HYPOTHESIS);
  assert.equal(DAYS_PER_YEAR, 365.2425);
});

test("CAGR 30일 이상 1년 미만", () => {
  const beginningEquity = 100;
  const endingEquity = 110;
  const startDate = "2100-01-04";
  const endDate = "2100-03-05";
  const elapsedCalendarDays = (Date.UTC(2100, 2, 5) - Date.UTC(2100, 0, 4)) / 86400000;
  const result = computeCagr({
    beginningEquity,
    endingEquity,
    startDate,
    endDate,
    minimumAnnualizationDays: 30,
  }, SYNTHETIC);
  const expected = (endingEquity / beginningEquity) ** (1 / (elapsedCalendarDays / 365.2425)) - 1;
  assertSyntheticCalculated(result, expected, UNIT.RATIO);
  assert.ok(result.warnings.includes(METRIC_STATUS.SHORT_PERIOD_ANNUALIZED));
});

test("CAGR 설정 기준 미달", () => {
  const result = computeCagr({
    beginningEquity: 100,
    endingEquity: 101,
    startDate: "2100-01-04",
    endDate: "2100-01-10",
    minimumAnnualizationDays: 30,
  }, SYNTHETIC);
  assert.equal(result.value, null);
  assert.equal(result.status, METRIC_STATUS.INSUFFICIENT_OBSERVATION_DAYS);
  assert.equal(result.fixtureTag, null);
});

test("CAGR 설정 누락은 기본 30을 쓰지 않음", () => {
  const result = computeCagr({
    beginningEquity: 100,
    endingEquity: 121,
    startDate: "2100-01-01",
    endDate: "2102-01-01",
  }, SYNTHETIC);
  assert.equal(result.value, null);
  assert.equal(result.status, METRIC_STATUS.MINIMUM_ANNUALIZATION_DAYS_NOT_CONFIGURED);
});

test("CAGR 윤년 구간", () => {
  const beginningEquity = 100;
  const endingEquity = 110;
  const result = computeCagr({
    beginningEquity,
    endingEquity,
    startDate: "2104-01-01",
    endDate: "2105-01-01",
    minimumAnnualizationDays: 30,
  }, SYNTHETIC);
  const expected = (endingEquity / beginningEquity) ** (1 / (366 / 365.2425)) - 1;
  assertSyntheticCalculated(result, expected, UNIT.RATIO);
});

test("CAGR 잘못된 날짜", () => {
  assert.equal(computeCagr({
    beginningEquity: 100,
    endingEquity: 110,
    startDate: "2100/01/01",
    endDate: "2102-01-01",
    minimumAnnualizationDays: 30,
  }, SYNTHETIC).status, METRIC_STATUS.INVALID_DATE_FORMAT);
  assert.equal(computeCagr({
    beginningEquity: 100,
    endingEquity: 110,
    startDate: "2100-02-30",
    endDate: "2102-01-01",
    minimumAnnualizationDays: 30,
  }, SYNTHETIC).status, METRIC_STATUS.INVALID_DATE_VALUE);
});

test("CAGR 동일 날짜", () => {
  const result = computeCagr({
    beginningEquity: 100,
    endingEquity: 100,
    startDate: "2100-01-04",
    endDate: "2100-01-04",
    minimumAnnualizationDays: 30,
  }, SYNTHETIC);
  assert.equal(result.value, null);
  assert.equal(result.status, METRIC_STATUS.INVALID_ELAPSED_PERIOD);
});

test("CAGR minimumAnnualizationDays 0·음수·소수·문자열·NaN·Infinity 거부", () => {
  for (const minimumAnnualizationDays of [0, -1, 1.5, "30", NaN, Infinity]) {
    const result = computeCagr({
      beginningEquity: 100,
      endingEquity: 121,
      startDate: "2100-01-01",
      endDate: "2102-01-01",
      minimumAnnualizationDays,
    }, SYNTHETIC);
    assert.equal(result.value, null);
    assert.equal(result.status, METRIC_STATUS.INVALID_INPUT);
  }
});

test("CAGR endingEquity=0은 -1", () => {
  const result = computeCagr({
    beginningEquity: 100,
    endingEquity: 0,
    startDate: "2100-01-01",
    endDate: "2102-01-01",
    minimumAnnualizationDays: 30,
  }, SYNTHETIC);
  assert.equal(result.value, -1);
  assert.equal(result.status, PERFORMANCE_STATUS.SYNTHETIC_FIXTURE_CALCULATED);
  assert.equal(result.notActualPerformance, true);
  assert.equal(result.promotionEligible, false);
});

test("MDD 상승만", () => {
  assertSyntheticCalculated(computeMdd([100, 110, 120], SYNTHETIC), 0, UNIT.RATIO);
});

test("MDD 하락 후 회복", () => {
  const expected = (100 - 80) / 100;
  assertSyntheticCalculated(computeMdd([100, 80, 100], SYNTHETIC), expected, UNIT.RATIO);
});

test("MDD 복수 고점", () => {
  const expected = (120 - 60) / 120;
  assertSyntheticCalculated(computeMdd([100, 90, 120, 60], SYNTHETIC), expected, UNIT.RATIO);
});

test("MDD 빈 배열", () => {
  const result = computeMdd([], SYNTHETIC);
  assert.equal(result.value, null);
  assert.equal(result.status, METRIC_STATUS.DATA_INSUFFICIENT);
});

test("MDD 음수·NaN·문자열 숫자", () => {
  assert.equal(computeMdd([100, -1], SYNTHETIC).status, METRIC_STATUS.INVALID_EQUITY_CURVE);
  assert.equal(computeMdd([100, NaN], SYNTHETIC).status, METRIC_STATUS.INVALID_INPUT);
  assert.equal(computeMdd(["100", 110], SYNTHETIC).status, METRIC_STATUS.INVALID_INPUT);
  assert.equal(computeMdd(null, SYNTHETIC).status, METRIC_STATUS.INVALID_INPUT);
});

test("MDD 시작 0 경로 [0] [0,0] [0,10]", () => {
  for (const curve of [[0], [0, 0], [0, 10]]) {
    const result = computeMdd(curve, SYNTHETIC);
    assert.equal(result.value, null);
    assert.equal(result.status, METRIC_STATUS.INVALID_EQUITY_CURVE);
  }
});

test("MDD 중간 0은 전액 손실", () => {
  assertSyntheticCalculated(computeMdd([100, 0], SYNTHETIC), 1, UNIT.RATIO);
});

test("승률 승·패 혼합", () => {
  const expected = 3 / (3 + 1);
  assertSyntheticCalculated(computeWinRate({
    winningTradeCount: 3,
    losingTradeCount: 1,
    breakEvenTradeCount: 0,
  }, SYNTHETIC), expected, UNIT.RATIO);
});

test("승률 보합은 분모에서 제외", () => {
  const expected = 2 / (2 + 2);
  assertSyntheticCalculated(computeWinRate({
    winningTradeCount: 2,
    losingTradeCount: 2,
    breakEvenTradeCount: 5,
  }, SYNTHETIC), expected, UNIT.RATIO);
});

test("승률 보합만", () => {
  const result = computeWinRate({
    winningTradeCount: 0,
    losingTradeCount: 0,
    breakEvenTradeCount: 4,
  }, SYNTHETIC);
  assert.equal(result.value, null);
  assert.equal(result.status, METRIC_STATUS.NO_DECISIVE_TRADES);
});

test("승률 거래 없음", () => {
  const result = computeWinRate({
    winningTradeCount: 0,
    losingTradeCount: 0,
    breakEvenTradeCount: 0,
  }, SYNTHETIC);
  assert.equal(result.value, null);
  assert.equal(result.status, METRIC_STATUS.NO_CLOSED_TRADES);
});

test("손익비 정상", () => {
  const expected = 10 / Math.abs(-5);
  assertSyntheticCalculated(computeProfitToLossRatio({
    averageProfitPerWinningTrade: 10,
    averageLossPerLosingTrade: -5,
    winningTradeCount: 3,
    losingTradeCount: 2,
  }, SYNTHETIC), expected, UNIT.RATIO);
});

test("손익비 승리 없음", () => {
  const result = computeProfitToLossRatio({
    averageProfitPerWinningTrade: null,
    averageLossPerLosingTrade: -4,
    winningTradeCount: 0,
    losingTradeCount: 2,
  }, SYNTHETIC);
  assert.equal(result.value, null);
  assert.equal(result.status, METRIC_STATUS.NO_WINNING_TRADES);
});

test("손익비 손실 없음", () => {
  const result = computeProfitToLossRatio({
    averageProfitPerWinningTrade: 8,
    averageLossPerLosingTrade: null,
    winningTradeCount: 2,
    losingTradeCount: 0,
  }, SYNTHETIC);
  assert.equal(result.value, null);
  assert.equal(result.status, METRIC_STATUS.NO_LOSING_TRADES);
});

test("손익비 평균 이익 0 모순", () => {
  const result = computeProfitToLossRatio({
    averageProfitPerWinningTrade: 0,
    averageLossPerLosingTrade: -3,
    winningTradeCount: 2,
    losingTradeCount: 2,
  }, SYNTHETIC);
  assert.equal(result.value, null);
  assert.equal(result.status, METRIC_STATUS.INVALID_TRADE_AGGREGATE);
});

test("손익비 평균 손실 0 모순", () => {
  const result = computeProfitToLossRatio({
    averageProfitPerWinningTrade: 5,
    averageLossPerLosingTrade: 0,
    winningTradeCount: 2,
    losingTradeCount: 2,
  }, SYNTHETIC);
  assert.equal(result.value, null);
  assert.equal(result.status, METRIC_STATUS.INVALID_TRADE_AGGREGATE);
});

test("Profit Factor 정상", () => {
  const expected = 80 / Math.abs(-40);
  assertSyntheticCalculated(computeProfitFactor({
    grossProfit: 80,
    grossLoss: -40,
    winningTradeCount: 2,
    losingTradeCount: 2,
  }, SYNTHETIC), expected, UNIT.RATIO);
});

test("Profit Factor 손실 거래 없음은 Infinity가 아님", () => {
  const result = computeProfitFactor({
    grossProfit: 80,
    grossLoss: 0,
    winningTradeCount: 2,
    losingTradeCount: 0,
  }, SYNTHETIC);
  assert.equal(result.value, null);
  assert.equal(result.status, METRIC_STATUS.NO_LOSING_TRADES);
  assert.notEqual(result.value, Infinity);
});

test("Profit Factor 이익 거래 없음은 ZERO_GROSS_PROFIT", () => {
  const result = computeProfitFactor({
    grossProfit: 0,
    grossLoss: -40,
    winningTradeCount: 0,
    losingTradeCount: 2,
  }, SYNTHETIC);
  assert.equal(result.value, 0);
  assert.equal(result.status, METRIC_STATUS.ZERO_GROSS_PROFIT);
  assert.equal(result.fixtureTag, null);
});

test("Profit Factor 건수와 총손익 모순", () => {
  assert.equal(computeProfitFactor({
    grossProfit: 0,
    grossLoss: -40,
    winningTradeCount: 2,
    losingTradeCount: 2,
  }, SYNTHETIC).status, METRIC_STATUS.INVALID_TRADE_AGGREGATE);
  assert.equal(computeProfitFactor({
    grossProfit: 80,
    grossLoss: 10,
    winningTradeCount: 2,
    losingTradeCount: 2,
  }, SYNTHETIC).status, METRIC_STATUS.INVALID_TRADE_AGGREGATE);
});

test("Profit Factor 손실 건수와 grossLoss=0 모순", () => {
  const result = computeProfitFactor({
    winningTradeCount: 0,
    losingTradeCount: 1,
    grossProfit: 0,
    grossLoss: 0,
  }, SYNTHETIC);
  assert.equal(result.value, null);
  assert.equal(result.status, METRIC_STATUS.INVALID_TRADE_AGGREGATE);
});

test("기대값 승·패·보합 혼합", () => {
  const expected = 30 / (2 + 1 + 1);
  assertSyntheticCalculated(computeExpectedValue({
    totalNetPnl: 30,
    winningTradeCount: 2,
    losingTradeCount: 1,
    breakEvenTradeCount: 1,
  }, SYNTHETIC), expected, UNIT.CURRENCY);
});

test("기대값 보합만", () => {
  const expected = 0 / 3;
  assertSyntheticCalculated(computeExpectedValue({
    totalNetPnl: 0,
    winningTradeCount: 0,
    losingTradeCount: 0,
    breakEvenTradeCount: 3,
  }, SYNTHETIC), expected, UNIT.CURRENCY);
});

test("기대값 거래 없음", () => {
  const result = computeExpectedValue({
    totalNetPnl: 0,
    winningTradeCount: 0,
    losingTradeCount: 0,
    breakEvenTradeCount: 0,
  }, SYNTHETIC);
  assert.equal(result.value, null);
  assert.equal(result.status, METRIC_STATUS.NO_CLOSED_TRADES);
});

test("기대값 건수 합 불일치", () => {
  const result = computeExpectedValue({
    totalNetPnl: 10,
    winningTradeCount: 1,
    losingTradeCount: 1,
    breakEvenTradeCount: 0,
    totalClosedTrades: 5,
  }, SYNTHETIC);
  assert.equal(result.value, null);
  assert.equal(result.status, METRIC_STATUS.INVALID_TRADE_AGGREGATE);
});

test("classifyTrade 승·패·보합", () => {
  assert.equal(classifyTrade(2.5).outcome, TRADE_OUTCOME.WINNING_TRADE);
  assert.equal(classifyTrade(-1).outcome, TRADE_OUTCOME.LOSING_TRADE);
  assert.equal(classifyTrade(0).outcome, TRADE_OUTCOME.BREAK_EVEN_TRADE);
  assert.equal(classifyTrade(NaN).status, METRIC_STATUS.INVALID_INPUT);
});

test("validateTradeAggregates 불변조건", () => {
  assert.equal(validateTradeAggregates({
    winningTradeCount: 2,
    losingTradeCount: 1,
    breakEvenTradeCount: 0,
    averageProfitPerWinningTrade: 4,
    averageLossPerLosingTrade: -2,
  }).ok, true);
  assert.equal(validateTradeAggregates({
    winningTradeCount: 2,
    losingTradeCount: 1,
    averageProfitPerWinningTrade: 0,
    averageLossPerLosingTrade: -2,
  }).status, METRIC_STATUS.INVALID_TRADE_AGGREGATE);
  assert.equal(validateTradeAggregates({
    winningTradeCount: 0,
    losingTradeCount: 1,
    averageProfitPerWinningTrade: 4,
    averageLossPerLosingTrade: -2,
  }).status, METRIC_STATUS.INVALID_TRADE_AGGREGATE);
});

test("performance는 createNotExecutedPerformanceResult를 재수출", () => {
  const result = createNotExecutedPerformanceResult();
  assert.equal(result.totalReturn.status, PERFORMANCE_STATUS.NOT_EXECUTED);
  assert.equal(result.totalReturn.value, null);
});
