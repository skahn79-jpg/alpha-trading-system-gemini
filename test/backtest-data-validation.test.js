"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  LOAD_MODE,
  SOURCE_TYPE,
  FIXTURE_TYPE,
  VERIFICATION_STATUS,
  PRICE_ADJUSTMENT_STATUS,
  CORPORATE_ACTION_POLICY_STATUS,
  FINALITY,
  FINALITY_SOURCE,
  CANDLE_ADJUSTMENT,
  DATASET_TYPE,
  SORT_ORDER,
  CANONICALIZATION_VERSION,
  ERROR,
  validateHistoricalDataset,
  computeDatasetContentChecksum,
  computeDatasetMetadataHash,
} = require("../lib/backtest/data-validation");

function candle(overrides) {
  const tradingDate = overrides && overrides.tradingDate ? overrides.tradingDate : "2100-01-04";
  return {
    symbol: "SYNTH001",
    market: "SYNTHETIC_MARKET",
    tradingDate,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 10,
    isFinal: true,
    candleFinality: FINALITY.FINAL,
    finalitySource: FINALITY_SOURCE.EXPLICIT_FINAL_FLAG,
    adjustmentStatus: CANDLE_ADJUSTMENT.UNKNOWN,
    dataAsOf: `${tradingDate}T15:40:00+09:00`,
    sourceDatasetId: "synthetic-daily-v1",
    ...overrides,
  };
}

function validEnvelope(overrides) {
  const candles = [
    candle({ tradingDate: "2100-01-04" }),
    candle({ tradingDate: "2100-01-05" }),
    candle({ tradingDate: "2100-01-06" }),
  ];
  return {
    datasetId: "synthetic-daily-v1",
    datasetVersion: "1",
    datasetType: DATASET_TYPE.HISTORICAL_DAILY_OHLCV,
    sourceType: SOURCE_TYPE.SYNTHETIC_FIXTURE,
    symbols: ["SYNTH001"],
    markets: ["SYNTHETIC_MARKET"],
    coverage: { from: "2100-01-04", to: "2100-01-06" },
    perSymbolCoverage: { SYNTH001: { from: "2100-01-04", to: "2100-01-06" } },
    timezone: "Asia/Seoul",
    sortOrder: SORT_ORDER.ASCENDING_BY_TRADING_DATE,
    priceAdjustmentStatus: PRICE_ADJUSTMENT_STATUS.UNKNOWN,
    corporateActionPolicyId: "synthetic-ca-v1",
    corporateActionPolicyStatus: CORPORATE_ACTION_POLICY_STATUS.UNKNOWN,
    universePolicyId: "synthetic-universe-v1",
    survivorshipBiasControlled: true,
    calendarVersion: "synthetic-calendar-v1",
    calendarVerificationStatus: VERIFICATION_STATUS.TEST_VERIFIED,
    canonicalizationVersion: CANONICALIZATION_VERSION,
    contentChecksum: null,
    metadataHash: null,
    verificationStatus: VERIFICATION_STATUS.TEST_VERIFIED,
    fixtureType: FIXTURE_TYPE.SYNTHETIC_BACKTEST_DATASET,
    notProductionData: true,
    productionEligible: false,
    candles,
    sourceRefs: [],
    verifiedAt: null,
    generatedAt: null,
    loaderTimestamp: null,
    ...overrides,
  };
}

function validateTest(dataset, extraOpts) {
  return validateHistoricalDataset(dataset, { mode: LOAD_MODE.TEST, ...extraOpts });
}

function hasCode(result, code) {
  return result.errors.some((err) => err.code === code);
}

test("정상 합성 스키마", () => {
  const result = validateTest(validEnvelope());
  assert.equal(result.schemaValid, true);
  assert.equal(result.datasetVerified, false);
  assert.equal(result.backtestExecutionEligible, false);
  assert.equal(result.promotionEligible, false);
});

test("알 수 없는 Envelope 필드 거부", () => {
  const result = validateTest(validEnvelope({ extraField: 1 }));
  assert.equal(result.schemaValid, false);
  assert.equal(hasCode(result, ERROR.UNKNOWN_FIELD), true);
});

test("volume=null 거부", () => {
  const dataset = validEnvelope();
  dataset.candles = dataset.candles.map((c, i) => (i === 0 ? candle({ ...c, volume: null }) : c));
  const result = validateTest(dataset);
  assert.equal(result.schemaValid, false);
  assert.equal(hasCode(result, ERROR.INVALID_VOLUME), true);
});

test("거래량 음수·소수·문자열·NaN·Infinity 거부", () => {
  const bad = [-1, 1.5, "10", Number.NaN, Number.POSITIVE_INFINITY];
  for (const volume of bad) {
    const dataset = validEnvelope();
    dataset.candles = [
      candle({ tradingDate: "2100-01-04", volume }),
      candle({ tradingDate: "2100-01-05" }),
      candle({ tradingDate: "2100-01-06" }),
    ];
    const result = validateTest(dataset);
    assert.equal(result.schemaValid, false, `volume=${String(volume)}`);
    assert.equal(hasCode(result, ERROR.INVALID_VOLUME), true);
  }
});

test("OHLC 관계 위반", () => {
  const dataset = validEnvelope();
  dataset.candles = [
    candle({ tradingDate: "2100-01-04", high: 90, open: 100, close: 100, low: 99 }),
    candle({ tradingDate: "2100-01-05" }),
    candle({ tradingDate: "2100-01-06" }),
  ];
  const result = validateTest(dataset);
  assert.equal(result.schemaValid, false);
  assert.equal(hasCode(result, ERROR.OHLC_INCONSISTENT), true);
});

test("문자열 가격 거부", () => {
  const dataset = validEnvelope();
  dataset.candles = [
    candle({ tradingDate: "2100-01-04", open: "100" }),
    candle({ tradingDate: "2100-01-05" }),
    candle({ tradingDate: "2100-01-06" }),
  ];
  const result = validateTest(dataset);
  assert.equal(result.schemaValid, false);
  assert.equal(hasCode(result, ERROR.INVALID_PRICE), true);
});

test("동일 심볼·날짜 중복 거부", () => {
  const dataset = validEnvelope();
  dataset.candles = [
    candle({ tradingDate: "2100-01-04" }),
    candle({ tradingDate: "2100-01-04" }),
    candle({ tradingDate: "2100-01-05" }),
  ];
  dataset.coverage = { from: "2100-01-04", to: "2100-01-05" };
  dataset.perSymbolCoverage = { SYNTH001: { from: "2100-01-04", to: "2100-01-05" } };
  const result = validateTest(dataset);
  assert.equal(result.schemaValid, false);
  assert.equal(hasCode(result, ERROR.DUPLICATE_TRADING_DATE), true);
});

test("다른 심볼의 동일 날짜 허용", () => {
  const c1 = candle({ symbol: "SYNTH001", tradingDate: "2100-01-04" });
  const c2 = candle({ symbol: "SYNTH002", tradingDate: "2100-01-04" });
  const dataset = validEnvelope({
    symbols: ["SYNTH001", "SYNTH002"],
    coverage: { from: "2100-01-04", to: "2100-01-04" },
    perSymbolCoverage: {
      SYNTH001: { from: "2100-01-04", to: "2100-01-04" },
      SYNTH002: { from: "2100-01-04", to: "2100-01-04" },
    },
    candles: [c1, c2],
  });
  const result = validateTest(dataset);
  assert.equal(result.schemaValid, true);
});

test("심볼별 날짜 역순 거부", () => {
  const dataset = validEnvelope({
    candles: [
      candle({ tradingDate: "2100-01-06" }),
      candle({ tradingDate: "2100-01-05" }),
      candle({ tradingDate: "2100-01-04" }),
    ],
  });
  const result = validateTest(dataset);
  assert.equal(result.schemaValid, false);
  assert.equal(
    hasCode(result, ERROR.NON_MONOTONIC_DATES) || hasCode(result, ERROR.CANDLES_NOT_SORTED),
    true,
  );
});

test("coverage 불일치", () => {
  const result = validateTest(validEnvelope({
    coverage: { from: "2100-01-04", to: "2100-01-05" },
  }));
  assert.equal(result.schemaValid, false);
  assert.equal(hasCode(result, ERROR.COVERAGE_MISMATCH), true);
});

test("perSymbolCoverage 불일치", () => {
  const result = validateTest(validEnvelope({
    perSymbolCoverage: { SYNTH001: { from: "2100-01-04", to: "2100-01-05" } },
  }));
  assert.equal(result.schemaValid, false);
  assert.equal(hasCode(result, ERROR.PER_SYMBOL_COVERAGE_MISMATCH), true);
});

test("TIME_HEURISTIC 거부", () => {
  const dataset = validEnvelope();
  dataset.candles = dataset.candles.map((c) => candle({
    ...c,
    finalitySource: FINALITY_SOURCE.TIME_HEURISTIC,
  }));
  const result = validateTest(dataset);
  assert.equal(result.schemaValid, false);
  assert.equal(hasCode(result, ERROR.TIME_HEURISTIC_NOT_ALLOWED), true);
});

test("HISTORICAL_DATE 단독 운영 승격 차단", () => {
  const dataset = validEnvelope();
  dataset.candles = dataset.candles.map((c) => candle({
    ...c,
    finalitySource: FINALITY_SOURCE.HISTORICAL_DATE,
  }));
  const result = validateTest(dataset);
  assert.equal(result.schemaValid, true);
  assert.equal(result.datasetVerified, false);
  assert.equal(result.backtestDataEligible, false);
  assert.equal(result.promotionEligible, false);
  assert.equal(result.backtestExecutionEligible, false);
});

test("캘린더 미주입 시 스키마 통과·데이터 검증 실패", () => {
  const result = validateTest(validEnvelope(), { calendarProvider: null });
  assert.equal(result.schemaValid, true);
  assert.equal(result.datasetVerified, false);
  assert.equal(result.backtestDataEligible, false);
  assert.equal(result.backtestExecutionEligible, false);
  assert.equal(result.missingData.includes("CALENDAR_UNAVAILABLE"), true);
});

test("합성 fixture PRODUCTION 거부", () => {
  const result = validateHistoricalDataset(validEnvelope(), { mode: LOAD_MODE.PRODUCTION });
  assert.equal(result.schemaValid, false);
  assert.equal(hasCode(result, ERROR.SYNTHETIC_FIXTURE_NOT_ALLOWED), true);
});

test("contentChecksum 변조 감지", () => {
  const base = validEnvelope();
  const contentChecksum = computeDatasetContentChecksum(base);
  const injected = { ...base, contentChecksum };
  const ok = validateTest(injected);
  assert.equal(ok.schemaValid, true);
  const mutated = {
    ...injected,
    candles: injected.candles.map((c, i) => (i === 0 ? candle({ ...c, close: 101 }) : c)),
  };
  const result = validateTest(mutated);
  assert.equal(hasCode(result, ERROR.CONTENT_CHECKSUM_MISMATCH), true);
  assert.equal(result.datasetVerified, false);
});

test("metadataHash 변조 감지", () => {
  const base = validEnvelope();
  const metadataHash = computeDatasetMetadataHash(base);
  const injected = { ...base, metadataHash };
  const ok = validateTest(injected);
  assert.equal(ok.schemaValid, true);
  const mutated = { ...injected, verificationStatus: VERIFICATION_STATUS.PENDING };
  const result = validateTest(mutated);
  assert.equal(hasCode(result, ERROR.METADATA_HASH_MISMATCH), true);
  assert.equal(result.datasetVerified, false);
});

test("수정주가 UNKNOWN 실행 차단", () => {
  const result = validateTest(validEnvelope({
    priceAdjustmentStatus: PRICE_ADJUSTMENT_STATUS.UNKNOWN,
  }));
  assert.equal(result.schemaValid, true);
  assert.equal(result.datasetVerified, false);
  assert.equal(result.backtestDataEligible, false);
  assert.equal(result.backtestExecutionEligible, false);
  assert.equal(result.promotionEligible, false);
});

test("생존편향 미통제 실행 차단", () => {
  const result = validateTest(validEnvelope({ survivorshipBiasControlled: false }));
  assert.equal(result.schemaValid, true);
  assert.equal(result.datasetVerified, false);
  assert.equal(result.backtestDataEligible, false);
  assert.equal(result.backtestExecutionEligible, false);
});

test("date 별칭 거부", () => {
  const dataset = validEnvelope();
  dataset.candles = dataset.candles.map((c, i) => (
    i === 0 ? candle({ ...c, date: c.tradingDate }) : c
  ));
  const result = validateTest(dataset);
  assert.equal(result.schemaValid, false);
  assert.equal(hasCode(result, ERROR.DATE_ALIAS_NOT_ALLOWED), true);
});

test("Envelope VERIFIED + Candle UNKNOWN", () => {
  const dataset = validEnvelope({
    priceAdjustmentStatus: PRICE_ADJUSTMENT_STATUS.VERIFIED,
  });
  const result = validateTest(dataset);
  assert.equal(hasCode(result, ERROR.ADJUSTMENT_POLICY_MISMATCH), true);
  assert.equal(result.datasetVerified, false);
  assert.equal(result.backtestDataEligible, false);
  assert.equal(result.backtestExecutionEligible, false);
  assert.equal(result.promotionEligible, false);
});

test("캔들 adjustmentStatus 혼재", () => {
  const dataset = validEnvelope({
    priceAdjustmentStatus: PRICE_ADJUSTMENT_STATUS.UNKNOWN,
    candles: [
      candle({ tradingDate: "2100-01-04", adjustmentStatus: CANDLE_ADJUSTMENT.UNKNOWN }),
      candle({ tradingDate: "2100-01-05", adjustmentStatus: CANDLE_ADJUSTMENT.VERIFIED }),
      candle({ tradingDate: "2100-01-06", adjustmentStatus: CANDLE_ADJUSTMENT.UNKNOWN }),
    ],
  });
  const result = validateTest(dataset);
  assert.equal(hasCode(result, ERROR.ADJUSTMENT_POLICY_MISMATCH), true);
  assert.equal(result.datasetVerified, false);
  assert.equal(result.backtestDataEligible, false);
});

test("가짜 CalendarProvider 차단", () => {
  const candles = [
    {
      symbol: "AAA001",
      market: "KOSPI",
      tradingDate: "2024-01-02",
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 10,
      isFinal: true,
      candleFinality: FINALITY.FINAL,
      finalitySource: FINALITY_SOURCE.EXPLICIT_FINAL_FLAG,
      adjustmentStatus: CANDLE_ADJUSTMENT.VERIFIED,
      dataAsOf: "2024-01-02T15:40:00+09:00",
      sourceDatasetId: "local-verified-daily-v1",
    },
    {
      symbol: "AAA001",
      market: "KOSPI",
      tradingDate: "2024-01-03",
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 10,
      isFinal: true,
      candleFinality: FINALITY.FINAL,
      finalitySource: FINALITY_SOURCE.EXPLICIT_FINAL_FLAG,
      adjustmentStatus: CANDLE_ADJUSTMENT.VERIFIED,
      dataAsOf: "2024-01-03T15:40:00+09:00",
      sourceDatasetId: "local-verified-daily-v1",
    },
    {
      symbol: "AAA001",
      market: "KOSPI",
      tradingDate: "2024-01-04",
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 10,
      isFinal: true,
      candleFinality: FINALITY.FINAL,
      finalitySource: FINALITY_SOURCE.EXPLICIT_FINAL_FLAG,
      adjustmentStatus: CANDLE_ADJUSTMENT.VERIFIED,
      dataAsOf: "2024-01-04T15:40:00+09:00",
      sourceDatasetId: "local-verified-daily-v1",
    },
  ];
  const dataset = {
    datasetId: "local-verified-daily-v1",
    datasetVersion: "1",
    datasetType: DATASET_TYPE.HISTORICAL_DAILY_OHLCV,
    sourceType: SOURCE_TYPE.LOCAL_VERIFIED_FILE,
    symbols: ["AAA001"],
    markets: ["KOSPI"],
    coverage: { from: "2024-01-02", to: "2024-01-04" },
    perSymbolCoverage: { AAA001: { from: "2024-01-02", to: "2024-01-04" } },
    timezone: "Asia/Seoul",
    sortOrder: SORT_ORDER.ASCENDING_BY_TRADING_DATE,
    priceAdjustmentStatus: PRICE_ADJUSTMENT_STATUS.VERIFIED,
    corporateActionPolicyId: "local-ca-v1",
    corporateActionPolicyStatus: CORPORATE_ACTION_POLICY_STATUS.VERIFIED,
    universePolicyId: "local-universe-v1",
    survivorshipBiasControlled: true,
    calendarVersion: "unverified-calendar-v1",
    calendarVerificationStatus: VERIFICATION_STATUS.VERIFIED,
    canonicalizationVersion: CANONICALIZATION_VERSION,
    verificationStatus: VERIFICATION_STATUS.VERIFIED,
    notProductionData: false,
    productionEligible: true,
    candles,
    sourceRefs: [],
    verifiedAt: null,
    generatedAt: null,
    loaderTimestamp: null,
  };
  dataset.contentChecksum = computeDatasetContentChecksum(dataset);
  dataset.metadataHash = computeDatasetMetadataHash(dataset);
  const calendarProvider = {
    getTradingDayStatus() {
      return { tradingDayStatus: "TRADING_DAY" };
    },
  };
  const result = validateHistoricalDataset(dataset, {
    mode: LOAD_MODE.PRODUCTION,
    calendarProvider,
  });
  assert.equal(result.schemaValid, true);
  assert.equal(result.datasetVerified, false);
  assert.equal(result.backtestDataEligible, false);
  assert.equal(result.backtestExecutionEligible, false);
  assert.equal(result.promotionEligible, false);
  assert.equal(result.missingData.includes("CALENDAR_VALIDATION_NOT_IMPLEMENTED"), true);
  assert.equal(result.missingData.includes("CALENDAR_UNAVAILABLE"), false);
});

test("오류 결과에 전체 페이로드가 없는지 확인", () => {
  const dataset = validEnvelope({ extraField: true });
  const result = validateTest(dataset);
  assert.equal(Object.hasOwn(result, "candles"), false);
  for (const err of result.errors) {
    assert.equal(Object.hasOwn(err, "candles"), false);
  }
  const dumped = JSON.stringify(result);
  assert.equal(/"candles"\s*:/.test(dumped), false);
  assert.equal(dumped.includes('"open":100'), false);
});
