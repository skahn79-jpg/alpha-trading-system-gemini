"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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
  STATUS,
  SYNTHETIC_MARKETS,
  VALIDATION_MARKET_CONTRACT,
  validateHistoricalDataset,
  computeDatasetContentChecksum,
  computeDatasetMetadataHash,
} = require("../lib/backtest/data-validation");

const DATA_VALIDATION_PATH = path.join(__dirname, "..", "lib", "backtest", "data-validation.js");
const CALENDAR_VALIDATION_PATH = path.join(__dirname, "..", "lib", "backtest", "calendar-validation.js");

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

function pad2(n) {
  return String(n).padStart(2, "0");
}

function addDaysYmd(ymd, days) {
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  const day = Number(ymd.slice(8, 10));
  const dt = new Date(Date.UTC(year, month - 1, day + days));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function isWeekendYmd(ymd) {
  const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

function makeCalendarDay(tradingDate, overrides) {
  const extras = overrides || {};
  return {
    tradingDate,
    dayStatus: extras.dayStatus || (isWeekendYmd(tradingDate) ? "NON_TRADING_DAY" : "TRADING_DAY"),
    sessionStatus: extras.sessionStatus || "FINAL",
    statusSource: extras.statusSource || "SYNTHETIC_EXPLICIT",
    market: extras.market || SYNTHETIC_MARKETS.SYNTHETIC_KOSPI,
    calendarId: extras.calendarId || "synthetic-calendar-unit",
  };
}

function buildSyntheticCalendar(options) {
  const opts = options || {};
  const start = opts.start || "2100-01-04";
  const dayCount = opts.dayCount || 14;
  const market = opts.market || SYNTHETIC_MARKETS.SYNTHETIC_KOSPI;
  const calendarId = opts.calendarId || "synthetic-calendar-unit";
  const calendarVersion = opts.calendarVersion || "synthetic-calendar-v1";
  const days = [];
  for (let i = 0; i < dayCount; i += 1) {
    days.push(makeCalendarDay(addDaysYmd(start, i), { market, calendarId }));
  }
  if (Array.isArray(opts.patchDays)) {
    for (const patch of opts.patchDays) {
      const row = days.find((d) => d.tradingDate === patch.tradingDate);
      if (row) Object.assign(row, patch);
    }
  }
  return {
    calendarId,
    calendarVersion,
    calendarStatus: "TEST_VERIFIED",
    fixtureType: "SYNTHETIC",
    notProductionData: true,
    productionEligible: false,
    market,
    timezone: "Asia/Seoul",
    coverage: { from: start, to: addDaysYmd(start, dayCount - 1) },
    generatedAt: "2100-01-01T00:00:00+09:00",
    verifiedAt: "2100-01-01T00:00:00+09:00",
    days,
  };
}

function tradingDatesOf(calendar) {
  return calendar.days
    .filter((d) => d.dayStatus === "TRADING_DAY")
    .map((d) => d.tradingDate);
}

function cloneJson(value) {
  return JSON.stringify(value);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function integratedCandle(tradingDate, overrides) {
  const extras = overrides || {};
  const market = extras.market || SYNTHETIC_MARKETS.SYNTHETIC_KOSPI;
  return candle({
    symbol: extras.symbol || "SYNTH001",
    market,
    tradingDate,
    sourceDatasetId: extras.sourceDatasetId || "synthetic-daily-v1",
    ...extras,
  });
}

function integratedEnvelope(calendar, overrides) {
  const extras = Object.assign({}, overrides || {});
  const requestedDates = extras.tradingDates;
  const candleMarket = extras.candleMarket;
  const symbol = extras.symbol || "SYNTH001";
  const providedCandles = extras.candles;
  delete extras.tradingDates;
  delete extras.candleMarket;
  delete extras.symbol;
  delete extras.candles;

  const dates = Array.isArray(requestedDates)
    ? [...requestedDates].sort()
    : tradingDatesOf(calendar).slice(0, 3);
  const market = candleMarket || calendar.market;
  const candles = Array.isArray(providedCandles)
    ? providedCandles
    : dates.map((d) => integratedCandle(d, { market, symbol }));
  const from = dates[0];
  const to = dates[dates.length - 1];
  return validEnvelope({
    datasetId: "synthetic-daily-v1",
    symbols: [symbol],
    markets: [calendar.market],
    coverage: { from, to },
    perSymbolCoverage: { [symbol]: { from, to } },
    calendarVersion: calendar.calendarVersion,
    candles,
    ...extras,
  });
}

function calendarValidationRange(calendar, overrides) {
  const extras = overrides || {};
  return {
    requiredFrom: extras.requiredFrom || calendar.coverage.from,
    requiredTo: extras.requiredTo || calendar.coverage.to,
  };
}

function validateIntegrated(dataset, calendar, extraOpts) {
  return validateHistoricalDataset(dataset, {
    mode: LOAD_MODE.SYNTHETIC_UNIT_TEST_ONLY,
    calendar,
    calendarValidation: calendarValidationRange(calendar),
    ...extraOpts,
  });
}

function assertOperationalBlocked(result) {
  assert.equal(result.calendarVerified, false);
  assert.equal(result.calendarDataEligible, false);
  assert.equal(result.datasetVerified, false);
  assert.equal(result.backtestDataEligible, false);
  assert.equal(result.backtestExecutionEligible, false);
  assert.equal(result.promotionEligible, false);
  assert.equal(result.paperEligible, false);
  assert.equal(result.liveEligible, false);
}

test("GATE5F-01 캘린더 미제공 기존 정상 결과", () => {
  const result = validateTest(validEnvelope());
  assert.equal(result.schemaValid, true);
  assert.equal(result.syntheticCalendarProvided, false);
  assert.equal(result.syntheticCalendarVerified, false);
  assert.equal(result.syntheticCandleDatesVerified, false);
  assertOperationalBlocked(result);
});

test("GATE5F-02 캘린더 미제공 CALENDAR_UNAVAILABLE 유지", () => {
  const result = validateTest(validEnvelope());
  assert.equal(result.missingData.includes("CALENDAR_UNAVAILABLE"), true);
});

test("GATE5F-03 캘린더 미제공 datasetVerified=false", () => {
  assert.equal(validateTest(validEnvelope()).datasetVerified, false);
});

test("GATE5F-04 캘린더 미제공 backtestDataEligible=false", () => {
  assert.equal(validateTest(validEnvelope()).backtestDataEligible, false);
});

test("GATE5F-05 캘린더 미제공 기존 TEST 모드 유지", () => {
  const result = validateHistoricalDataset(validEnvelope(), { mode: LOAD_MODE.TEST });
  assert.equal(result.schemaValid, true);
  assert.equal(result.syntheticCalendarProvided, false);
});

test("GATE5F-06 정상 합성 데이터셋과 캘린더 schemaValid", () => {
  const calendar = buildSyntheticCalendar();
  const result = validateIntegrated(integratedEnvelope(calendar), calendar);
  assert.equal(result.schemaValid, true);
});

test("GATE5F-07 syntheticCalendarProvided=true", () => {
  const calendar = buildSyntheticCalendar();
  const result = validateIntegrated(integratedEnvelope(calendar), calendar);
  assert.equal(result.syntheticCalendarProvided, true);
});

test("GATE5F-08 syntheticCalendarVerified=true", () => {
  const calendar = buildSyntheticCalendar();
  const result = validateIntegrated(integratedEnvelope(calendar), calendar);
  assert.equal(result.syntheticCalendarVerified, true);
});

test("GATE5F-09 syntheticCandleDatesVerified=true", () => {
  const calendar = buildSyntheticCalendar();
  const result = validateIntegrated(integratedEnvelope(calendar), calendar);
  assert.equal(result.syntheticCandleDatesVerified, true);
});

test("GATE5F-10 calendarVerified=false", () => {
  const calendar = buildSyntheticCalendar();
  const result = validateIntegrated(integratedEnvelope(calendar), calendar);
  assert.equal(result.calendarVerified, false);
});

test("GATE5F-11 calendarDataEligible=false", () => {
  const calendar = buildSyntheticCalendar();
  const result = validateIntegrated(integratedEnvelope(calendar), calendar);
  assert.equal(result.calendarDataEligible, false);
});

test("GATE5F-12 datasetVerified=false", () => {
  const calendar = buildSyntheticCalendar();
  const result = validateIntegrated(integratedEnvelope(calendar), calendar);
  assert.equal(result.datasetVerified, false);
});

test("GATE5F-13 backtestDataEligible=false", () => {
  const calendar = buildSyntheticCalendar();
  const result = validateIntegrated(integratedEnvelope(calendar), calendar);
  assert.equal(result.backtestDataEligible, false);
});

test("GATE5F-14 backtestExecutionEligible=false", () => {
  const calendar = buildSyntheticCalendar();
  const result = validateIntegrated(integratedEnvelope(calendar), calendar);
  assert.equal(result.backtestExecutionEligible, false);
});

test("GATE5F-15 promotion·Paper·Live=false", () => {
  const calendar = buildSyntheticCalendar();
  const result = validateIntegrated(integratedEnvelope(calendar), calendar);
  assert.equal(result.promotionEligible, false);
  assert.equal(result.paperEligible, false);
  assert.equal(result.liveEligible, false);
});

test("GATE5F-16 CALENDAR_UNAVAILABLE 제거", () => {
  const calendar = buildSyntheticCalendar();
  const result = validateIntegrated(integratedEnvelope(calendar), calendar);
  assert.equal(result.missingData.includes("CALENDAR_UNAVAILABLE"), false);
});

test("GATE5F-17 CALENDAR_VALIDATION_NOT_IMPLEMENTED 제거", () => {
  const calendar = buildSyntheticCalendar();
  const result = validateIntegrated(integratedEnvelope(calendar), calendar);
  assert.equal(result.missingData.includes("CALENDAR_VALIDATION_NOT_IMPLEMENTED"), false);
});

test("GATE5F-18 PRODUCTION_CALENDAR_NOT_CONFIGURED 추가", () => {
  const calendar = buildSyntheticCalendar();
  const result = validateIntegrated(integratedEnvelope(calendar), calendar);
  assert.equal(result.missingData.includes("PRODUCTION_CALENDAR_NOT_CONFIGURED"), true);
});

test("GATE5F-19 calendarId·calendarVersion 반환", () => {
  const calendar = buildSyntheticCalendar();
  const result = validateIntegrated(integratedEnvelope(calendar), calendar);
  assert.equal(result.calendarId, calendar.calendarId);
  assert.equal(result.calendarVersion, calendar.calendarVersion);
});

test("GATE5F-20 calendar·days 원문 미반환", () => {
  const calendar = buildSyntheticCalendar();
  const result = validateIntegrated(integratedEnvelope(calendar), calendar);
  assert.equal(Object.hasOwn(result, "calendar"), false);
  assert.equal(Object.hasOwn(result, "days"), false);
  const dumped = JSON.stringify(result);
  assert.equal(/"days"\s*:/.test(dumped), false);
  assert.equal(dumped.includes('"statusSource":"SYNTHETIC_EXPLICIT"'), false);
});

test("GATE5F-21 알 수 없는 캘린더 필드", () => {
  const calendar = buildSyntheticCalendar();
  calendar.holidayName = "SYNTHETIC_HOLIDAY";
  const result = validateIntegrated(integratedEnvelope(calendar), calendar);
  assert.equal(hasCode(result, ERROR.UNKNOWN_FIELD), true);
  assert.equal(result.syntheticCalendarVerified, false);
  assert.equal(result.status, STATUS.BLOCKED_SYNTHETIC_CALENDAR_VALIDATION);
});

test("GATE5F-22 coverage 내부 날짜 누락", () => {
  const calendar = buildSyntheticCalendar();
  calendar.days.splice(2, 1);
  const result = validateIntegrated(integratedEnvelope(calendar), calendar);
  assert.equal(hasCode(result, ERROR.CALENDAR_DATE_MISSING), true);
  assert.equal(result.syntheticCalendarVerified, false);
});

test("GATE5F-23 역순 날짜", () => {
  const calendar = buildSyntheticCalendar();
  const dataset = integratedEnvelope(calendar);
  const reversed = deepClone(calendar);
  const first = reversed.days[0];
  reversed.days[0] = reversed.days[1];
  reversed.days[1] = first;
  const result = validateIntegrated(dataset, reversed);
  assert.equal(hasCode(result, ERROR.NON_MONOTONIC_CALENDAR_DATE), true);
});

test("GATE5F-24 중복 날짜", () => {
  const calendar = buildSyntheticCalendar();
  const dataset = integratedEnvelope(calendar);
  const duplicated = deepClone(calendar);
  duplicated.days[2] = { ...duplicated.days[1] };
  const result = validateIntegrated(dataset, duplicated);
  assert.equal(hasCode(result, ERROR.DUPLICATE_CALENDAR_DATE), true);
});

test("GATE5F-25 PENDING day", () => {
  const calendar = buildSyntheticCalendar();
  const dataset = integratedEnvelope(calendar);
  const mutated = deepClone(calendar);
  mutated.days.find((d) => d.tradingDate === dataset.candles[0].tradingDate).dayStatus = "PENDING";
  const result = validateIntegrated(dataset, mutated);
  assert.equal(hasCode(result, ERROR.CALENDAR_PENDING), true);
  assert.equal(result.syntheticCandleDatesVerified, false);
});

test("GATE5F-26 CONFLICT day", () => {
  const calendar = buildSyntheticCalendar();
  const dataset = integratedEnvelope(calendar);
  const mutated = deepClone(calendar);
  mutated.days.find((d) => d.tradingDate === dataset.candles[0].tradingDate).dayStatus = "CONFLICT";
  const result = validateIntegrated(dataset, mutated);
  assert.equal(hasCode(result, ERROR.CALENDAR_SOURCE_CONFLICT), true);
});

test("GATE5F-27 PENDING session", () => {
  const calendar = buildSyntheticCalendar();
  const trading = tradingDatesOf(calendar)[0];
  calendar.days.find((d) => d.tradingDate === trading).sessionStatus = "PENDING";
  const result = validateIntegrated(integratedEnvelope(calendar), calendar);
  assert.equal(hasCode(result, ERROR.SESSION_SCHEDULE_PENDING), true);
});

test("GATE5F-28 실제 시장명과 합성 캘린더 혼용", () => {
  const calendar = buildSyntheticCalendar();
  const dates = tradingDatesOf(calendar).slice(0, 3);
  const dataset = validEnvelope({
    datasetId: "local-verified-daily-v1",
    sourceType: SOURCE_TYPE.LOCAL_VERIFIED_FILE,
    symbols: ["AAA001"],
    markets: ["KOSPI"],
    coverage: { from: dates[0], to: dates[2] },
    perSymbolCoverage: { AAA001: { from: dates[0], to: dates[2] } },
    calendarVersion: calendar.calendarVersion,
    verificationStatus: VERIFICATION_STATUS.VERIFIED,
    notProductionData: false,
    productionEligible: true,
    fixtureType: undefined,
    candles: dates.map((d) => candle({
      symbol: "AAA001",
      market: "KOSPI",
      tradingDate: d,
      sourceDatasetId: "local-verified-daily-v1",
      adjustmentStatus: CANDLE_ADJUSTMENT.VERIFIED,
    })),
  });
  delete dataset.fixtureType;
  const result = validateIntegrated(dataset, calendar);
  assert.equal(hasCode(result, ERROR.CALENDAR_MARKET_MISMATCH), true);
});

test("GATE5F-29 PRODUCTION 모드 합성 캘린더 차단", () => {
  const calendar = buildSyntheticCalendar();
  const dates = tradingDatesOf(calendar).slice(0, 3);
  const dataset = validEnvelope({
    datasetId: "local-verified-daily-v1",
    sourceType: SOURCE_TYPE.LOCAL_VERIFIED_FILE,
    symbols: ["AAA001"],
    markets: [calendar.market],
    coverage: { from: dates[0], to: dates[2] },
    perSymbolCoverage: { AAA001: { from: dates[0], to: dates[2] } },
    calendarVersion: calendar.calendarVersion,
    verificationStatus: VERIFICATION_STATUS.VERIFIED,
    notProductionData: false,
    productionEligible: true,
    candles: dates.map((d) => candle({
      symbol: "AAA001",
      market: calendar.market,
      tradingDate: d,
      sourceDatasetId: "local-verified-daily-v1",
      adjustmentStatus: CANDLE_ADJUSTMENT.VERIFIED,
    })),
  });
  delete dataset.fixtureType;
  const result = validateHistoricalDataset(dataset, {
    mode: LOAD_MODE.PRODUCTION,
    calendar,
    calendarValidation: calendarValidationRange(calendar),
  });
  assert.equal(hasCode(result, ERROR.SYNTHETIC_CALENDAR_BLOCKED_IN_PRODUCTION), true);
  assert.equal(result.syntheticCalendarVerified, false);
});

test("GATE5F-30 캘린더 실패 후 캔들 날짜 대조 미실행", () => {
  const calendar = buildSyntheticCalendar();
  calendar.holidayName = "SYNTHETIC_HOLIDAY";
  const weekend = calendar.days.find((d) => d.dayStatus === "NON_TRADING_DAY");
  const dataset = integratedEnvelope(calendar, { tradingDates: [weekend.tradingDate] });
  const result = validateIntegrated(dataset, calendar);
  assert.equal(hasCode(result, ERROR.UNKNOWN_FIELD), true);
  assert.equal(hasCode(result, ERROR.CANDLE_ON_NON_TRADING_DAY), false);
});

test("GATE5F-31 dataset·calendar 시장 불일치", () => {
  const calendar = buildSyntheticCalendar({ market: SYNTHETIC_MARKETS.SYNTHETIC_KOSPI });
  const dataset = integratedEnvelope(calendar, {
    markets: [SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ],
    candleMarket: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ,
  });
  const result = validateIntegrated(dataset, calendar);
  assert.equal(hasCode(result, ERROR.CALENDAR_MARKET_MISMATCH), true);
});

test("GATE5F-32 candle·calendar 시장 불일치", () => {
  const calendar = buildSyntheticCalendar();
  const dates = tradingDatesOf(calendar).slice(0, 3);
  const dataset = integratedEnvelope(calendar, {
    symbols: ["SYNTH001", "SYNTH002"],
    markets: [SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ, SYNTHETIC_MARKETS.SYNTHETIC_KOSPI],
    coverage: { from: dates[0], to: dates[2] },
    perSymbolCoverage: {
      SYNTH001: { from: dates[0], to: dates[0] },
      SYNTH002: { from: dates[1], to: dates[2] },
    },
    candles: [
      integratedCandle(dates[0], { symbol: "SYNTH001", market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ }),
      integratedCandle(dates[1], { symbol: "SYNTH002", market: SYNTHETIC_MARKETS.SYNTHETIC_KOSPI }),
      integratedCandle(dates[2], { symbol: "SYNTH002", market: SYNTHETIC_MARKETS.SYNTHETIC_KOSPI }),
    ],
  });
  const result = validateIntegrated(dataset, calendar);
  assert.equal(hasCode(result, ERROR.CALENDAR_MARKET_MISMATCH), true);
});

test("GATE5F-33 calendarVersion 불일치", () => {
  const calendar = buildSyntheticCalendar({ calendarVersion: "synthetic-calendar-v1" });
  const dataset = integratedEnvelope(calendar, { calendarVersion: "synthetic-calendar-v2" });
  const result = validateIntegrated(dataset, calendar);
  assert.equal(hasCode(result, ERROR.CALENDAR_VERSION_MISMATCH), true);
});

test("GATE5F-34 requiredFrom coverage 밖", () => {
  const calendar = buildSyntheticCalendar();
  const result = validateIntegrated(integratedEnvelope(calendar), calendar, {
    calendarValidation: {
      requiredFrom: addDaysYmd(calendar.coverage.from, -1),
      requiredTo: calendar.coverage.to,
    },
  });
  assert.equal(hasCode(result, ERROR.CALENDAR_RANGE_INSUFFICIENT), true);
  assert.equal(hasCode(result, ERROR.CANDLE_ON_NON_TRADING_DAY), false);
});

test("GATE5F-35 requiredTo coverage 밖", () => {
  const calendar = buildSyntheticCalendar();
  const result = validateIntegrated(integratedEnvelope(calendar), calendar, {
    calendarValidation: {
      requiredFrom: calendar.coverage.from,
      requiredTo: addDaysYmd(calendar.coverage.to, 1),
    },
  });
  assert.equal(hasCode(result, ERROR.CALENDAR_RANGE_INSUFFICIENT), true);
});

test("GATE5F-36 requiredFrom > requiredTo", () => {
  const calendar = buildSyntheticCalendar();
  const result = validateIntegrated(integratedEnvelope(calendar), calendar, {
    calendarValidation: {
      requiredFrom: calendar.coverage.to,
      requiredTo: calendar.coverage.from,
    },
  });
  assert.equal(hasCode(result, ERROR.INVALID_COVERAGE_RANGE), true);
});

test("GATE5F-37 다중 시장에 단일 캘린더", () => {
  const calendar = buildSyntheticCalendar();
  const dates = tradingDatesOf(calendar).slice(0, 2);
  const dataset = validEnvelope({
    symbols: ["SYNTH001", "SYNTH002"],
    markets: [SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ, SYNTHETIC_MARKETS.SYNTHETIC_KOSPI],
    coverage: { from: dates[0], to: dates[1] },
    perSymbolCoverage: {
      SYNTH001: { from: dates[0], to: dates[0] },
      SYNTH002: { from: dates[1], to: dates[1] },
    },
    calendarVersion: calendar.calendarVersion,
    candles: [
      integratedCandle(dates[0], { symbol: "SYNTH001", market: SYNTHETIC_MARKETS.SYNTHETIC_KOSPI }),
      integratedCandle(dates[1], { symbol: "SYNTH002", market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ }),
    ],
  });
  const result = validateIntegrated(dataset, calendar);
  assert.equal(hasCode(result, ERROR.MULTI_MARKET_CALENDAR_REQUIRED), true);
});

test("GATE5F-38 캘린더에 없는 캔들 날짜", () => {
  const calendar = buildSyntheticCalendar({ dayCount: 10 });
  const missingDate = addDaysYmd(calendar.coverage.to, 3);
  const dates = [...tradingDatesOf(calendar).slice(0, 2), missingDate];
  const dataset = integratedEnvelope(calendar, { tradingDates: dates });
  const result = validateIntegrated(dataset, calendar);
  assert.equal(
    hasCode(result, ERROR.CALENDAR_DATE_MISSING) || hasCode(result, ERROR.CALENDAR_DATE_OUTSIDE_COVERAGE),
    true,
  );
});

test("GATE5F-39 NON_TRADING_DAY 캔들", () => {
  const calendar = buildSyntheticCalendar();
  const weekend = calendar.days.find((d) => d.dayStatus === "NON_TRADING_DAY").tradingDate;
  const dates = [weekend, ...tradingDatesOf(calendar).slice(0, 2)];
  const dataset = integratedEnvelope(calendar, { tradingDates: dates });
  const result = validateIntegrated(dataset, calendar);
  assert.equal(hasCode(result, ERROR.CANDLE_ON_NON_TRADING_DAY), true);
});

test("GATE5F-40 FINAL이 아닌 날짜", () => {
  const calendar = buildSyntheticCalendar();
  const trading = tradingDatesOf(calendar)[1];
  calendar.days.find((d) => d.tradingDate === trading).sessionStatus = "PENDING";
  const result = validateIntegrated(integratedEnvelope(calendar), calendar);
  assert.equal(hasCode(result, ERROR.SESSION_SCHEDULE_PENDING), true);
});

test("GATE5F-41 동일 날짜 다른 시장", () => {
  const calendar = buildSyntheticCalendar();
  const date = tradingDatesOf(calendar)[0];
  const dataset = validEnvelope({
    symbols: ["SYNTH001", "SYNTH002"],
    markets: [SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ, SYNTHETIC_MARKETS.SYNTHETIC_KOSPI],
    coverage: { from: date, to: date },
    perSymbolCoverage: {
      SYNTH001: { from: date, to: date },
      SYNTH002: { from: date, to: date },
    },
    calendarVersion: calendar.calendarVersion,
    candles: [
      integratedCandle(date, { symbol: "SYNTH001", market: SYNTHETIC_MARKETS.SYNTHETIC_KOSPI }),
      integratedCandle(date, { symbol: "SYNTH002", market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ }),
    ],
  });
  const result = validateIntegrated(dataset, calendar);
  assert.equal(
    hasCode(result, ERROR.MULTI_MARKET_CALENDAR_REQUIRED)
      || hasCode(result, ERROR.CALENDAR_MARKET_MISMATCH),
    true,
  );
});

test("GATE5F-42 calendarVerified=true 무시", () => {
  const calendar = buildSyntheticCalendar();
  const result = validateIntegrated(integratedEnvelope(calendar), calendar, { calendarVerified: true });
  assert.equal(result.calendarVerified, false);
});

test("GATE5F-43 calendarDataEligible=true 무시", () => {
  const calendar = buildSyntheticCalendar();
  const result = validateIntegrated(integratedEnvelope(calendar), calendar, { calendarDataEligible: true });
  assert.equal(result.calendarDataEligible, false);
});

test("GATE5F-44 datasetVerified=true 무시", () => {
  const calendar = buildSyntheticCalendar();
  const result = validateIntegrated(integratedEnvelope(calendar), calendar, { datasetVerified: true });
  assert.equal(result.datasetVerified, false);
});

test("GATE5F-45 backtestDataEligible=true 무시", () => {
  const calendar = buildSyntheticCalendar();
  const result = validateIntegrated(integratedEnvelope(calendar), calendar, { backtestDataEligible: true });
  assert.equal(result.backtestDataEligible, false);
});

test("GATE5F-46 backtestExecutionEligible=true 무시", () => {
  const calendar = buildSyntheticCalendar();
  const result = validateIntegrated(integratedEnvelope(calendar), calendar, {
    backtestExecutionEligible: true,
  });
  assert.equal(result.backtestExecutionEligible, false);
});

test("GATE5F-47 promotionEligible=true 무시", () => {
  const calendar = buildSyntheticCalendar();
  const result = validateIntegrated(integratedEnvelope(calendar), calendar, { promotionEligible: true });
  assert.equal(result.promotionEligible, false);
});

test("GATE5F-48 paperEligible=true 무시", () => {
  const calendar = buildSyntheticCalendar();
  const result = validateIntegrated(integratedEnvelope(calendar), calendar, { paperEligible: true });
  assert.equal(result.paperEligible, false);
});

test("GATE5F-49 liveEligible=true 무시", () => {
  const calendar = buildSyntheticCalendar();
  const result = validateIntegrated(integratedEnvelope(calendar), calendar, { liveEligible: true });
  assert.equal(result.liveEligible, false);
});

test("GATE5F-50 모든 승격 플래그 동시 주입 차단", () => {
  const calendar = buildSyntheticCalendar();
  const result = validateIntegrated(integratedEnvelope(calendar), calendar, {
    calendarVerified: true,
    calendarDataEligible: true,
    datasetVerified: true,
    backtestDataEligible: true,
    backtestExecutionEligible: true,
    promotionEligible: true,
    paperEligible: true,
    liveEligible: true,
  });
  assertOperationalBlocked(result);
  assert.equal(result.syntheticCalendarVerified, true);
  assert.equal(result.syntheticCandleDatesVerified, true);
});

test("GATE5F-51 dataset 입력 불변", () => {
  const calendar = buildSyntheticCalendar();
  const dataset = integratedEnvelope(calendar);
  const before = cloneJson(dataset);
  validateIntegrated(dataset, calendar);
  assert.equal(cloneJson(dataset), before);
});

test("GATE5F-52 calendar 입력 불변", () => {
  const calendar = buildSyntheticCalendar();
  const before = cloneJson(calendar);
  validateIntegrated(integratedEnvelope(calendar), calendar);
  assert.equal(cloneJson(calendar), before);
});

test("GATE5F-53 opts 입력 불변", () => {
  const calendar = buildSyntheticCalendar();
  const opts = {
    mode: LOAD_MODE.SYNTHETIC_UNIT_TEST_ONLY,
    calendar,
    calendarValidation: calendarValidationRange(calendar),
  };
  const before = cloneJson(opts);
  validateHistoricalDataset(integratedEnvelope(calendar), opts);
  assert.equal(cloneJson(opts), before);
});

test("GATE5F-54 동일 입력은 동일 결과", () => {
  const calendar = buildSyntheticCalendar();
  const dataset = integratedEnvelope(calendar);
  const a = validateIntegrated(deepClone(dataset), deepClone(calendar));
  const b = validateIntegrated(deepClone(dataset), deepClone(calendar));
  assert.equal(cloneJson(a), cloneJson(b));
});

test("GATE5F-55 오류에 dataset 없음", () => {
  const calendar = buildSyntheticCalendar();
  calendar.holidayName = "X";
  const result = validateIntegrated(integratedEnvelope(calendar), calendar);
  const dumped = JSON.stringify(result);
  assert.equal(Object.hasOwn(result, "dataset"), false);
  assert.equal(/"candles"\s*:/.test(dumped), false);
  for (const err of result.errors) {
    assert.equal(Object.hasOwn(err, "dataset"), false);
  }
});

test("GATE5F-56 오류에 candles 없음", () => {
  const calendar = buildSyntheticCalendar();
  const weekend = calendar.days.find((d) => d.dayStatus === "NON_TRADING_DAY").tradingDate;
  const result = validateIntegrated(
    integratedEnvelope(calendar, { tradingDates: [weekend] }),
    calendar,
  );
  const dumped = JSON.stringify(result);
  assert.equal(/"candles"\s*:/.test(dumped), false);
  for (const err of result.errors) {
    assert.equal(Object.hasOwn(err, "candles"), false);
  }
});

test("GATE5F-57 오류에 calendar 없음", () => {
  const calendar = buildSyntheticCalendar();
  calendar.holidayName = "X";
  const result = validateIntegrated(integratedEnvelope(calendar), calendar);
  const dumped = JSON.stringify(result);
  assert.equal(Object.hasOwn(result, "calendar"), false);
  assert.equal(/"calendar"\s*:/.test(dumped), false);
  for (const err of result.errors) {
    assert.equal(Object.hasOwn(err, "calendar"), false);
    assert.equal(Object.hasOwn(err, "days"), false);
  }
});

test("GATE5F-58 오류에 days 없음", () => {
  const calendar = buildSyntheticCalendar();
  calendar.days.splice(1, 1);
  const result = validateIntegrated(integratedEnvelope(calendar), calendar);
  const dumped = JSON.stringify(result);
  assert.equal(/"days"\s*:/.test(dumped), false);
  for (const err of result.errors) {
    assert.equal(Object.hasOwn(err, "days"), false);
  }
});

test("GATE5F-59 네트워크·주문 참조 없음", () => {
  const source = fs.readFileSync(DATA_VALIDATION_PATH, "utf8");
  assert.equal(/axios/i.test(source), false);
  assert.equal(/\bfetch\s*\(/i.test(source), false);
  assert.equal(/https?:\/\//i.test(source), false);
  assert.equal(/\bbroker\b/i.test(source), false);
  assert.equal(/\border\b/i.test(source), false);
});

test("GATE5F-60 순환 의존성 없음", () => {
  const calendarSource = fs.readFileSync(CALENDAR_VALIDATION_PATH, "utf8");
  assert.equal(calendarSource.includes("data-validation"), false);
  assert.equal(/require\(["']\.\/data-validation["']\)/.test(calendarSource), false);
  const dataSource = fs.readFileSync(DATA_VALIDATION_PATH, "utf8");
  assert.equal(dataSource.includes('require("./calendar-validation")'), true);
});

test("GATE5F-61 정상 경로 경계: coverage.from 일치", () => {
  const calendar = buildSyntheticCalendar({ start: "2100-03-01", dayCount: 10 });
  const result = validateIntegrated(integratedEnvelope(calendar), calendar, {
    calendarValidation: {
      requiredFrom: calendar.coverage.from,
      requiredTo: calendar.coverage.to,
    },
  });
  assert.equal(result.syntheticCalendarVerified, true);
  assert.equal(result.syntheticCandleDatesVerified, true);
});

test("GATE5F-62 정상 경로 경계: requiredFrom=requiredTo 거래일", () => {
  const calendar = buildSyntheticCalendar();
  const day = tradingDatesOf(calendar)[0];
  const dataset = integratedEnvelope(calendar, { tradingDates: [day] });
  const result = validateIntegrated(dataset, calendar, {
    calendarValidation: { requiredFrom: day, requiredTo: day },
  });
  assert.equal(result.syntheticCandleDatesVerified, true);
});

test("GATE5F-63 정상 경로: SYNTHETIC_KOSDAQ", () => {
  const calendar = buildSyntheticCalendar({ market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ });
  const result = validateIntegrated(integratedEnvelope(calendar), calendar);
  assert.equal(result.syntheticCalendarVerified, true);
  assert.equal(result.syntheticCandleDatesVerified, true);
  assert.equal(result.calendarVerified, false);
});

test("GATE5F-64 실패 경로: 데이터셋 오류 후 캘린더 미실행", () => {
  const calendar = buildSyntheticCalendar();
  calendar.holidayName = "X";
  const dataset = integratedEnvelope(calendar, { extraField: true });
  const result = validateIntegrated(dataset, calendar);
  assert.equal(hasCode(result, ERROR.UNKNOWN_FIELD), true);
  assert.equal(result.errors.some((e) => e.field === "holidayName"), false);
  assert.equal(result.syntheticCalendarVerified, false);
});

test("GATE5F-65 실패 경로: 캘린더 실패 시 PRODUCTION_CALENDAR_NOT_CONFIGURED 없음", () => {
  const calendar = buildSyntheticCalendar();
  calendar.holidayName = "X";
  const result = validateIntegrated(integratedEnvelope(calendar), calendar);
  assert.equal(result.missingData.includes("PRODUCTION_CALENDAR_NOT_CONFIGURED"), false);
  assert.equal(result.status, STATUS.BLOCKED_SYNTHETIC_CALENDAR_VALIDATION);
});

test("GATE5F-66 경계: requiredTo=coverage.to 통과", () => {
  const calendar = buildSyntheticCalendar({ start: "2100-04-01", dayCount: 12 });
  const result = validateIntegrated(integratedEnvelope(calendar), calendar, {
    calendarValidation: {
      requiredFrom: calendar.coverage.from,
      requiredTo: calendar.coverage.to,
    },
  });
  assert.equal(result.syntheticCalendarVerified, true);
});

test("GATE5F-67 오류 화이트리스트 외 필드 제거", () => {
  const calendar = buildSyntheticCalendar();
  calendar.holidayName = "X";
  const result = validateIntegrated(integratedEnvelope(calendar), calendar);
  const allowed = new Set([
    "code", "severity", "field", "recordIndex", "symbol", "tradingDate",
    "datasetId", "datasetVersion", "contentChecksum", "metadataHash",
    "calendarId", "calendarVersion", "market", "dayStatus", "sessionStatus",
  ]);
  for (const err of result.errors) {
    for (const key of Object.keys(err)) {
      assert.equal(allowed.has(key), true, key);
    }
  }
});

test("GATE5F-68 calendarValidationStatus 정상값", () => {
  const calendar = buildSyntheticCalendar();
  const result = validateIntegrated(integratedEnvelope(calendar), calendar);
  assert.equal(result.calendarValidationStatus, STATUS.SYNTHETIC_CALENDAR_VERIFIED);
});

test("GATE5I-D01 기본 marketContract는 legacy 유지", () => {
  const result = validateTest(validEnvelope());
  assert.equal(result.schemaValid, true);
});

test("GATE5I-D02 legacy contract에서 SYNTHETIC_MARKET 허용", () => {
  const result = validateHistoricalDataset(validEnvelope(), {
    mode: LOAD_MODE.TEST,
    marketContract: VALIDATION_MARKET_CONTRACT.LEGACY_SYNTHETIC,
  });
  assert.equal(result.schemaValid, true);
});

test("GATE5I-D03 normalized contract에서 SYNTHETIC_MARKET 차단", () => {
  const result = validateHistoricalDataset(validEnvelope(), {
    mode: LOAD_MODE.TEST,
    marketContract: VALIDATION_MARKET_CONTRACT.NORMALIZED_SYNTHETIC,
  });
  assert.equal(result.schemaValid, true);
  assert.equal(hasCode(result, ERROR.LEGACY_MARKET_NOT_ALLOWED_IN_NORMALIZED_VALIDATION), true);
});

test("GATE5I-D04 normalized contract에서 SYNTHETIC_KOSPI 허용", () => {
  const dataset = validEnvelope({
    markets: [SYNTHETIC_MARKETS.SYNTHETIC_KOSPI],
    candles: [
      candle({ tradingDate: "2100-01-04", market: SYNTHETIC_MARKETS.SYNTHETIC_KOSPI }),
      candle({ tradingDate: "2100-01-05", market: SYNTHETIC_MARKETS.SYNTHETIC_KOSPI }),
      candle({ tradingDate: "2100-01-06", market: SYNTHETIC_MARKETS.SYNTHETIC_KOSPI }),
    ],
  });
  const result = validateHistoricalDataset(dataset, {
    mode: LOAD_MODE.TEST,
    marketContract: VALIDATION_MARKET_CONTRACT.NORMALIZED_SYNTHETIC,
  });
  assert.equal(result.schemaValid, true);
});

test("GATE5I-D05 normalized contract에서 SYNTHETIC_KOSDAQ 허용", () => {
  const dataset = validEnvelope({
    markets: [SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ],
    candles: [
      candle({ tradingDate: "2100-01-04", market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ }),
      candle({ tradingDate: "2100-01-05", market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ }),
      candle({ tradingDate: "2100-01-06", market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ }),
    ],
  });
  const result = validateHistoricalDataset(dataset, {
    mode: LOAD_MODE.TEST,
    marketContract: VALIDATION_MARKET_CONTRACT.NORMALIZED_SYNTHETIC,
  });
  assert.equal(result.schemaValid, true);
});

test("GATE5I-D06 normalized contract에서 KOSPI 차단", () => {
  const dataset = validEnvelope({
    markets: ["KOSPI"],
    candles: [
      candle({ tradingDate: "2100-01-04", market: "KOSPI" }),
      candle({ tradingDate: "2100-01-05", market: "KOSPI" }),
      candle({ tradingDate: "2100-01-06", market: "KOSPI" }),
    ],
  });
  const result = validateHistoricalDataset(dataset, {
    mode: LOAD_MODE.TEST,
    marketContract: VALIDATION_MARKET_CONTRACT.NORMALIZED_SYNTHETIC,
  });
  assert.equal(result.schemaValid, true);
  assert.equal(hasCode(result, ERROR.PRODUCTION_MARKET_NOT_ALLOWED), true);
});

test("GATE5I-D07 normalized contract에서 KOSDAQ 차단", () => {
  const dataset = validEnvelope({
    markets: ["KOSDAQ"],
    candles: [
      candle({ tradingDate: "2100-01-04", market: "KOSDAQ" }),
      candle({ tradingDate: "2100-01-05", market: "KOSDAQ" }),
      candle({ tradingDate: "2100-01-06", market: "KOSDAQ" }),
    ],
  });
  const result = validateHistoricalDataset(dataset, {
    mode: LOAD_MODE.TEST,
    marketContract: VALIDATION_MARKET_CONTRACT.NORMALIZED_SYNTHETIC,
  });
  assert.equal(result.schemaValid, true);
  assert.equal(hasCode(result, ERROR.PRODUCTION_MARKET_NOT_ALLOWED), true);
});

test("GATE5I-D08 marketContract=null은 legacy fallback", () => {
  const result = validateHistoricalDataset(validEnvelope(), {
    mode: LOAD_MODE.TEST,
    marketContract: null,
  });
  assert.equal(result.schemaValid, true);
});

test("GATE5I-D09 marketContract=undefined는 legacy fallback", () => {
  const result = validateHistoricalDataset(validEnvelope(), {
    mode: LOAD_MODE.TEST,
    marketContract: undefined,
  });
  assert.equal(result.schemaValid, true);
});

test("GATE5I-D10 marketContract empty string 거부", () => {
  const result = validateHistoricalDataset(validEnvelope(), {
    mode: LOAD_MODE.TEST,
    marketContract: "",
  });
  assert.equal(result.schemaValid, true);
  assert.equal(hasCode(result, ERROR.INVALID_MARKET_CONTRACT), true);
});

test("GATE5I-D11 marketContract unknown 거부", () => {
  const result = validateHistoricalDataset(validEnvelope(), {
    mode: LOAD_MODE.TEST,
    marketContract: "UNKNOWN",
  });
  assert.equal(result.schemaValid, true);
  assert.equal(hasCode(result, ERROR.INVALID_MARKET_CONTRACT), true);
});

test("GATE5I-D12 normalized + mixed markets 배열 차단", () => {
  const dataset = validEnvelope({
    markets: [SYNTHETIC_MARKETS.SYNTHETIC_KOSPI, SYNTHETIC_MARKETS.SYNTHETIC_MARKET],
  });
  const result = validateHistoricalDataset(dataset, {
    mode: LOAD_MODE.TEST,
    marketContract: VALIDATION_MARKET_CONTRACT.NORMALIZED_SYNTHETIC,
  });
  assert.equal(result.schemaValid, true);
  assert.equal(
    hasCode(result, ERROR.LEGACY_MARKET_NOT_ALLOWED_IN_NORMALIZED_VALIDATION)
      || hasCode(result, ERROR.MARKETS_NOT_SORTED),
    true,
  );
});

test("GATE5I-D13 normalized + candle market mismatch 차단", () => {
  const dataset = validEnvelope({
    markets: [SYNTHETIC_MARKETS.SYNTHETIC_KOSPI],
    candles: [
      candle({ tradingDate: "2100-01-04", market: SYNTHETIC_MARKETS.SYNTHETIC_MARKET }),
      candle({ tradingDate: "2100-01-05", market: SYNTHETIC_MARKETS.SYNTHETIC_KOSPI }),
      candle({ tradingDate: "2100-01-06", market: SYNTHETIC_MARKETS.SYNTHETIC_KOSPI }),
    ],
  });
  const result = validateHistoricalDataset(dataset, {
    mode: LOAD_MODE.TEST,
    marketContract: VALIDATION_MARKET_CONTRACT.NORMALIZED_SYNTHETIC,
  });
  assert.equal(result.schemaValid, false);
  assert.equal(hasCode(result, ERROR.LEGACY_MARKET_NOT_ALLOWED_IN_NORMALIZED_VALIDATION), true);
});

test("GATE5I-D14 dataset-candle mismatch는 legacy에서도 차단", () => {
  const dataset = validEnvelope({
    markets: [SYNTHETIC_MARKETS.SYNTHETIC_KOSPI],
    candles: [
      candle({ tradingDate: "2100-01-04", market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ }),
      candle({ tradingDate: "2100-01-05", market: SYNTHETIC_MARKETS.SYNTHETIC_KOSPI }),
      candle({ tradingDate: "2100-01-06", market: SYNTHETIC_MARKETS.SYNTHETIC_KOSPI }),
    ],
  });
  const result = validateHistoricalDataset(dataset, {
    mode: LOAD_MODE.TEST,
    marketContract: VALIDATION_MARKET_CONTRACT.LEGACY_SYNTHETIC,
  });
  assert.equal(result.schemaValid, false);
  assert.equal(hasCode(result, ERROR.SYMBOL_MARKET_MISMATCH), true);
});

test("GATE5I-D15 normalized + legacy market 단독 차단", () => {
  const dataset = validEnvelope({
    markets: [SYNTHETIC_MARKETS.SYNTHETIC_MARKET],
  });
  const result = validateHistoricalDataset(dataset, {
    mode: LOAD_MODE.TEST,
    marketContract: VALIDATION_MARKET_CONTRACT.NORMALIZED_SYNTHETIC,
  });
  assert.equal(result.schemaValid, true);
  assert.equal(hasCode(result, ERROR.LEGACY_MARKET_NOT_ALLOWED_IN_NORMALIZED_VALIDATION), true);
});

test("GATE5I-D16 normalized + production market candle 차단", () => {
  const dataset = validEnvelope({
    markets: [SYNTHETIC_MARKETS.SYNTHETIC_KOSPI],
    candles: [
      candle({ tradingDate: "2100-01-04", market: "KOSPI" }),
      candle({ tradingDate: "2100-01-05", market: SYNTHETIC_MARKETS.SYNTHETIC_KOSPI }),
      candle({ tradingDate: "2100-01-06", market: SYNTHETIC_MARKETS.SYNTHETIC_KOSPI }),
    ],
  });
  const result = validateHistoricalDataset(dataset, {
    mode: LOAD_MODE.TEST,
    marketContract: VALIDATION_MARKET_CONTRACT.NORMALIZED_SYNTHETIC,
  });
  assert.equal(result.schemaValid, false);
  assert.equal(hasCode(result, ERROR.PRODUCTION_MARKET_NOT_ALLOWED), true);
});

test("GATE5I-D17 결과에 marketContract 필드 미노출", () => {
  const result = validateHistoricalDataset(validEnvelope(), {
    mode: LOAD_MODE.TEST,
    marketContract: VALIDATION_MARKET_CONTRACT.NORMALIZED_SYNTHETIC,
  });
  assert.equal(Object.hasOwn(result, "marketContract"), false);
});

test("GATE5I-D18 normalized 검증은 입력 불변", () => {
  const dataset = validEnvelope({
    markets: [SYNTHETIC_MARKETS.SYNTHETIC_KOSPI],
    candles: [
      candle({ tradingDate: "2100-01-04", market: SYNTHETIC_MARKETS.SYNTHETIC_KOSPI }),
      candle({ tradingDate: "2100-01-05", market: SYNTHETIC_MARKETS.SYNTHETIC_KOSPI }),
      candle({ tradingDate: "2100-01-06", market: SYNTHETIC_MARKETS.SYNTHETIC_KOSPI }),
    ],
  });
  const before = cloneJson(dataset);
  validateHistoricalDataset(dataset, {
    mode: LOAD_MODE.TEST,
    marketContract: VALIDATION_MARKET_CONTRACT.NORMALIZED_SYNTHETIC,
  });
  assert.equal(cloneJson(dataset), before);
});

test("GATE5I-D19 동일 입력 normalized 결과 결정적", () => {
  const dataset = validEnvelope({
    markets: [SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ],
    candles: [
      candle({ tradingDate: "2100-01-04", market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ }),
      candle({ tradingDate: "2100-01-05", market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ }),
      candle({ tradingDate: "2100-01-06", market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ }),
    ],
  });
  const a = validateHistoricalDataset(deepClone(dataset), {
    mode: LOAD_MODE.TEST,
    marketContract: VALIDATION_MARKET_CONTRACT.NORMALIZED_SYNTHETIC,
  });
  const b = validateHistoricalDataset(deepClone(dataset), {
    mode: LOAD_MODE.TEST,
    marketContract: VALIDATION_MARKET_CONTRACT.NORMALIZED_SYNTHETIC,
  });
  assert.equal(cloneJson(a), cloneJson(b));
});

test("GATE5I-D20 legacy contract는 fallback 금지(legacy 유지)", () => {
  const legacy = validateHistoricalDataset(validEnvelope(), {
    mode: LOAD_MODE.TEST,
    marketContract: VALIDATION_MARKET_CONTRACT.LEGACY_SYNTHETIC,
  });
  const normalized = validateHistoricalDataset(validEnvelope(), {
    mode: LOAD_MODE.TEST,
    marketContract: VALIDATION_MARKET_CONTRACT.NORMALIZED_SYNTHETIC,
  });
  assert.equal(legacy.schemaValid, true);
  assert.equal(normalized.schemaValid, true);
  assert.equal(hasCode(normalized, ERROR.LEGACY_MARKET_NOT_ALLOWED_IN_NORMALIZED_VALIDATION), true);
});

test("GATE5I-D21 invalid marketContract에서도 오류 결정적", () => {
  const a = validateHistoricalDataset(validEnvelope(), {
    mode: LOAD_MODE.TEST,
    marketContract: "INVALID_CONTRACT",
  });
  const b = validateHistoricalDataset(validEnvelope(), {
    mode: LOAD_MODE.TEST,
    marketContract: "INVALID_CONTRACT",
  });
  assert.equal(a.schemaValid, true);
  assert.equal(hasCode(a, ERROR.INVALID_MARKET_CONTRACT), true);
  assert.equal(cloneJson(a), cloneJson(b));
});

test("GATE5I-D22 normalized + markets unknown 문자열 차단", () => {
  const dataset = validEnvelope({
    markets: ["SYNTHETIC_UNKNOWN"],
    candles: [
      candle({ tradingDate: "2100-01-04", market: "SYNTHETIC_UNKNOWN" }),
      candle({ tradingDate: "2100-01-05", market: "SYNTHETIC_UNKNOWN" }),
      candle({ tradingDate: "2100-01-06", market: "SYNTHETIC_UNKNOWN" }),
    ],
  });
  const result = validateHistoricalDataset(dataset, {
    mode: LOAD_MODE.TEST,
    marketContract: VALIDATION_MARKET_CONTRACT.NORMALIZED_SYNTHETIC,
  });
  assert.equal(result.schemaValid, false);
  assert.equal(hasCode(result, ERROR.SYMBOL_MARKET_MISMATCH), true);
});

test("GATE5I-D23 normalized + calendar 통합 검증 KOSPI 정상", () => {
  const calendar = buildSyntheticCalendar({ market: SYNTHETIC_MARKETS.SYNTHETIC_KOSPI });
  const dataset = integratedEnvelope(calendar, {
    markets: [SYNTHETIC_MARKETS.SYNTHETIC_KOSPI],
    candleMarket: SYNTHETIC_MARKETS.SYNTHETIC_KOSPI,
  });
  const result = validateHistoricalDataset(dataset, {
    mode: LOAD_MODE.SYNTHETIC_UNIT_TEST_ONLY,
    marketContract: VALIDATION_MARKET_CONTRACT.NORMALIZED_SYNTHETIC,
    calendar,
    calendarValidation: calendarValidationRange(calendar),
  });
  assert.equal(result.schemaValid, true);
  assert.equal(result.syntheticCalendarVerified, true);
});

test("GATE5I-D24 normalized + calendar 통합 검증 KOSDAQ 정상", () => {
  const calendar = buildSyntheticCalendar({ market: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ });
  const dataset = integratedEnvelope(calendar, {
    markets: [SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ],
    candleMarket: SYNTHETIC_MARKETS.SYNTHETIC_KOSDAQ,
  });
  const result = validateHistoricalDataset(dataset, {
    mode: LOAD_MODE.SYNTHETIC_UNIT_TEST_ONLY,
    marketContract: VALIDATION_MARKET_CONTRACT.NORMALIZED_SYNTHETIC,
    calendar,
    calendarValidation: calendarValidationRange(calendar),
  });
  assert.equal(result.schemaValid, true);
  assert.equal(result.syntheticCalendarVerified, true);
});

test("GATE5I-D25 normalized + legacy candle 포함 시 calendar 단계 이전 차단", () => {
  const calendar = buildSyntheticCalendar({ market: SYNTHETIC_MARKETS.SYNTHETIC_KOSPI });
  const dataset = integratedEnvelope(calendar, {
    markets: [SYNTHETIC_MARKETS.SYNTHETIC_KOSPI],
    candles: [
      integratedCandle(tradingDatesOf(calendar)[0], { market: SYNTHETIC_MARKETS.SYNTHETIC_MARKET }),
      integratedCandle(tradingDatesOf(calendar)[1], { market: SYNTHETIC_MARKETS.SYNTHETIC_KOSPI }),
      integratedCandle(tradingDatesOf(calendar)[2], { market: SYNTHETIC_MARKETS.SYNTHETIC_KOSPI }),
    ],
  });
  const result = validateHistoricalDataset(dataset, {
    mode: LOAD_MODE.SYNTHETIC_UNIT_TEST_ONLY,
    marketContract: VALIDATION_MARKET_CONTRACT.NORMALIZED_SYNTHETIC,
    calendar,
    calendarValidation: calendarValidationRange(calendar),
  });
  assert.equal(result.schemaValid, false);
  assert.equal(hasCode(result, ERROR.LEGACY_MARKET_NOT_ALLOWED_IN_NORMALIZED_VALIDATION), true);
});

test("GATE6N-G01 source pins shared makeBacktestError and no local makeError", () => {
  const src = fs.readFileSync(DATA_VALIDATION_PATH, "utf8");
  assert.equal(src.includes('require("./make-error")'), true);
  assert.equal(src.includes("makeBacktestError"), true);
  assert.equal(src.includes("function makeError"), false);
  assert.equal(src.includes("{ field: null }"), false);
});

test("GATE6N-G02 null dataset has no field key and severity ERROR", () => {
  const result = validateTest(null);
  assert.equal(result.schemaValid, false);
  assert.equal(hasCode(result, ERROR.INVALID_INPUT), true);
  const err = result.errors.find((e) => e.code === ERROR.INVALID_INPUT);
  assert.equal(err.severity, "ERROR");
  assert.equal(Object.prototype.hasOwnProperty.call(err, "field"), false);
});

test("GATE6N-G03 unknown field keeps datasetId field and severity ERROR", () => {
  const result = validateTest(validEnvelope({ extraField: 1 }));
  assert.equal(hasCode(result, ERROR.UNKNOWN_FIELD), true);
  const err = result.errors.find((e) => e.code === ERROR.UNKNOWN_FIELD);
  assert.equal(err.field, "extraField");
  assert.equal(err.datasetId, "synthetic-daily-v1");
  assert.equal(err.severity, "ERROR");
});
