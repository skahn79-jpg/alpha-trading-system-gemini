"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  LEAKAGE_ERROR,
  PURGE_UNIT,
  assertFeatureWindowNoLookAhead,
  validateSignalTiming,
  validatePointInTimeInputs,
  validateSplitWindows,
  validatePurgeEmbargo,
} = require("../lib/backtest/leakage-guard");
const { HORIZON_TYPE } = require("../lib/backtest/schemas");

function hasCode(result, code) {
  return result.errors.some((err) => err.code === code);
}

function pitBase(overrides) {
  return {
    featureDataAsOf: "2100-01-04T15:40:00+09:00",
    signalCreatedAt: "2100-01-04T15:40:00+09:00",
    modelTrainingCutoff: "2100-01-03T15:40:00+09:00",
    corporateActionDataPublishedAt: "2100-01-03T15:40:00+09:00",
    financialStatementPublishedAt: "2100-01-03T15:40:00+09:00",
    newsPublishedAt: "2100-01-03T15:40:00+09:00",
    universeMembershipAsOf: "2100-01-04T15:40:00+09:00",
    ...overrides,
  };
}

test("데이터셋에는 목표일이 있고 피처 창에는 없는 정상 사례", () => {
  const result = assertFeatureWindowNoLookAhead({
    featureWindow: [
      { symbol: "SYNTH001", tradingDate: "2100-01-04" },
    ],
    featureAsOfTradingDate: "2100-01-04",
    targetTradingDate: "2100-01-06",
  });
  assert.equal(result.ok, true);
  assert.equal(result.backtestExecutionEligible, false);
});

test("피처 창의 T+1 봉 거부", () => {
  const result = assertFeatureWindowNoLookAhead({
    featureWindow: [
      { symbol: "SYNTH001", tradingDate: "2100-01-04" },
      { symbol: "SYNTH001", tradingDate: "2100-01-05" },
    ],
    featureAsOfTradingDate: "2100-01-04",
    targetTradingDate: "2100-01-06",
  });
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, LEAKAGE_ERROR.LOOKAHEAD_CANDLE_PRESENT), true);
});

test("피처 창의 목표일 봉 거부", () => {
  const result = assertFeatureWindowNoLookAhead({
    featureWindow: [
      { symbol: "SYNTH001", tradingDate: "2100-01-04" },
      { symbol: "SYNTH001", tradingDate: "2100-01-06" },
    ],
    featureAsOfTradingDate: "2100-01-06",
    targetTradingDate: "2100-01-06",
  });
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, LEAKAGE_ERROR.LOOKAHEAD_CANDLE_PRESENT), true);
});

test("featureDataAsOf > signalCreatedAt 거부", () => {
  const result = validateSignalTiming({
    featureDataAsOf: "2100-01-04T16:00:00+09:00",
    signalCreatedAt: "2100-01-04T15:40:00+09:00",
    executionTimestamp: "2100-01-05T09:00:00+09:00",
    signalTradingDate: "2100-01-04",
    earliestExecutionTradingDate: "2100-01-05",
    targetTradingDate: "2100-01-06",
  });
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, LEAKAGE_ERROR.FEATURE_AFTER_SIGNAL), true);
});

test("signalCreatedAt >= executionTimestamp 거부", () => {
  const result = validateSignalTiming({
    featureDataAsOf: "2100-01-04T15:40:00+09:00",
    signalCreatedAt: "2100-01-05T09:00:00+09:00",
    executionTimestamp: "2100-01-05T09:00:00+09:00",
    signalTradingDate: "2100-01-04",
    earliestExecutionTradingDate: "2100-01-05",
    targetTradingDate: "2100-01-06",
  });
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, LEAKAGE_ERROR.SIGNAL_NOT_BEFORE_EXECUTION), true);
});

test("동일 거래일 체결 날짜 거부", () => {
  const result = validateSignalTiming({
    featureDataAsOf: "2100-01-04T15:40:00+09:00",
    signalCreatedAt: "2100-01-04T15:40:00+09:00",
    executionTimestamp: "2100-01-05T09:00:00+09:00",
    signalTradingDate: "2100-01-04",
    earliestExecutionTradingDate: "2100-01-04",
    targetTradingDate: "2100-01-06",
  });
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, LEAKAGE_ERROR.SAME_DAY_EXECUTION), true);
});

test("목표일이 신호일 이하인 경우 거부", () => {
  const result = validateSignalTiming({
    featureDataAsOf: "2100-01-04T15:40:00+09:00",
    signalCreatedAt: "2100-01-04T15:40:00+09:00",
    executionTimestamp: "2100-01-05T09:00:00+09:00",
    signalTradingDate: "2100-01-04",
    earliestExecutionTradingDate: "2100-01-05",
    targetTradingDate: "2100-01-04",
  });
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, LEAKAGE_ERROR.TARGET_NOT_AFTER_SIGNAL), true);
});

test("학습 cutoff 미래 누출 거부", () => {
  const result = validatePointInTimeInputs(pitBase({
    modelTrainingCutoff: "2100-01-05T15:40:00+09:00",
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, LEAKAGE_ERROR.TRAINING_CUTOFF_LEAKAGE), true);
});

test("기업행동 데이터 미래 누출 거부", () => {
  const result = validatePointInTimeInputs(pitBase({
    corporateActionDataPublishedAt: "2100-01-05T15:40:00+09:00",
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, LEAKAGE_ERROR.PUBLICATION_LEAKAGE), true);
  assert.equal(Object.hasOwn(result, "corporateActionDataPublishedAt"), false);
  assert.equal(Object.hasOwn(result, "featureWindow"), false);
  for (const err of result.errors) {
    assert.equal(Object.hasOwn(err, "featureWindow"), false);
    assert.equal(Object.hasOwn(err, "corporateActionDataPublishedAt"), false);
    if (err.code === LEAKAGE_ERROR.PUBLICATION_LEAKAGE) {
      assert.equal(err.field, "corporateActionDataPublishedAt");
    }
  }
  const dumped = JSON.stringify(result);
  assert.equal(dumped.includes("featureWindow"), false);
});

test("공시 publishedAt 미래 누출 거부", () => {
  const result = validatePointInTimeInputs(pitBase({
    financialStatementPublishedAt: "2100-01-05T15:40:00+09:00",
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, LEAKAGE_ERROR.PUBLICATION_LEAKAGE), true);
});

test("뉴스 publishedAt 미래 누출 거부", () => {
  const result = validatePointInTimeInputs(pitBase({
    newsPublishedAt: "2100-01-05T15:40:00+09:00",
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, LEAKAGE_ERROR.PUBLICATION_LEAKAGE), true);
});

test("유니버스 membership 미래 누출 거부", () => {
  const result = validatePointInTimeInputs(pitBase({
    universeMembershipAsOf: "2100-01-05T15:40:00+09:00",
  }));
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, LEAKAGE_ERROR.UNIVERSE_MEMBERSHIP_LEAKAGE), true);
});

test("분할 구간 중첩 거부", () => {
  const result = validateSplitWindows({
    train: { from: "2100-01-04", to: "2100-02-01" },
    validation: { from: "2100-01-20", to: "2100-03-01" },
    test: { from: "2100-03-02", to: "2100-04-01" },
  });
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, LEAKAGE_ERROR.SPLIT_OVERLAP), true);
});

test("purge 미달 거부", () => {
  const result = validatePurgeEmbargo({
    horizonType: HORIZON_TYPE.SHORT,
    purgeLength: 4,
    purgeUnit: PURGE_UNIT.TRADING_DAY,
    embargoLength: 1,
    embargoUnit: PURGE_UNIT.TRADING_DAY,
    parameterStatus: "UNVERIFIED",
  });
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, LEAKAGE_ERROR.PURGE_INSUFFICIENT), true);
});

test("purge 단위 혼용 거부", () => {
  const result = validatePurgeEmbargo({
    horizonType: HORIZON_TYPE.SHORT,
    purgeLength: 5,
    purgeUnit: PURGE_UNIT.CALENDAR_DAY,
    embargoLength: 1,
    embargoUnit: PURGE_UNIT.TRADING_DAY,
    parameterStatus: "UNVERIFIED",
  });
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, LEAKAGE_ERROR.PURGE_UNIT_MISMATCH), true);
});

test("embargo 미설정 실행 차단", () => {
  const result = validatePurgeEmbargo({
    horizonType: HORIZON_TYPE.SHORT,
    purgeLength: 5,
    purgeUnit: PURGE_UNIT.TRADING_DAY,
    embargoLength: null,
    embargoUnit: PURGE_UNIT.TRADING_DAY,
    parameterStatus: "UNVERIFIED",
  });
  assert.equal(result.ok, false);
  assert.equal(result.backtestExecutionEligible, false);
  assert.equal(hasCode(result, LEAKAGE_ERROR.EMBARGO_NOT_CONFIGURED), true);
});

test("오류 결과에 입력 배열·전체 페이로드가 없는지 확인", () => {
  const featureWindow = [
    { symbol: "SYNTH001", tradingDate: "2100-01-05" },
  ];
  const result = assertFeatureWindowNoLookAhead({
    featureWindow,
    featureAsOfTradingDate: "2100-01-04",
    targetTradingDate: "2100-01-06",
  });
  assert.equal(Object.hasOwn(result, "featureWindow"), false);
  for (const err of result.errors) {
    assert.equal(Object.hasOwn(err, "featureWindow"), false);
  }
  const dumped = JSON.stringify(result);
  assert.equal(dumped.includes("featureWindow"), false);
});

test("금지된 주문·네트워크 모듈 참조가 없는지 확인", () => {
  const files = [
    path.join(__dirname, "../lib/backtest/data-validation.js"),
    path.join(__dirname, "../lib/backtest/leakage-guard.js"),
  ];
  const forbidden = [
    "placeOrder",
    "submitOrder",
    "amendOrder",
    "cancelOrder",
    'require("http")',
    "require('http')",
    'require("https")',
    "require('https')",
    'require("axios")',
    "require('axios')",
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const token of forbidden) {
      assert.equal(text.includes(token), false, `${file} contains ${token}`);
    }
    assert.equal(/kb\/broker/.test(text), false, `${file} kb path`);
    assert.equal(text.includes("/api/trading"), false);
  }
});

test("Missing PIT field does not use current time", () => {
  const result = validatePointInTimeInputs(pitBase({ newsPublishedAt: undefined }));
  delete result.ok;
  const again = validatePointInTimeInputs({
    featureDataAsOf: "2100-01-04T15:40:00+09:00",
    signalCreatedAt: "2100-01-04T15:40:00+09:00",
    modelTrainingCutoff: "2100-01-03T15:40:00+09:00",
    corporateActionDataPublishedAt: "2100-01-03T15:40:00+09:00",
    financialStatementPublishedAt: "2100-01-03T15:40:00+09:00",
    universeMembershipAsOf: "2100-01-04T15:40:00+09:00",
  });
  assert.equal(again.ok, false);
  assert.equal(again.missingData.includes("newsPublishedAt"), true);
  const dumped = JSON.stringify(again);
  const nowYear = String(new Date().getFullYear());
  assert.equal(dumped.includes(nowYear) && nowYear !== "2100", false);
});
