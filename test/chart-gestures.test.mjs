import test from "node:test";
import assert from "node:assert/strict";
import ChartGestures from "../src/chart-gestures.js";
import NChart from "../src/nchart.js";
import NIndicators from "../src/nindicators.js";

test("pinch out (scale>1) reduces visible bar count", () => {
  assert.equal(ChartGestures.nextVisibleCount(80, 2, 400), 40);
});

test("pinch in increases visible bar count but stays within data", () => {
  assert.equal(ChartGestures.nextVisibleCount(80, 0.5, 100), 100);
});

test("horizontal pan increases offset to reveal older bars", () => {
  const next = ChartGestures.nextOffset(0, 40, 200, 20, 100);
  assert.ok(next > 0);
  assert.ok(next <= 80);
});

test("vertical-dominant movement is not treated as chart pan", () => {
  assert.equal(ChartGestures.isHorizontalPan(4, 20), false);
  assert.equal(ChartGestures.isHorizontalPan(20, 4), true);
});

test("future gutter never exceeds 30 bars", () => {
  assert.equal(NChart.futureGutterBars(80, 80), 30);
  assert.ok(NChart.futureGutterBars(200, 80) <= 30);
});

test("nindicators compute/buildSignals/currentZone/accuracy stay compatible", () => {
  const candles = [];
  let price = 100;
  for (let i = 0; i < 220; i += 1) {
    price += (i % 7) - 3;
    candles.push({
      date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
      open: price,
      high: price + 2,
      low: price - 2,
      close: price + 0.5,
      volume: 1000,
    });
  }
  const computed = NIndicators.compute(candles);
  const signals = NIndicators.buildSignals(computed);
  const zone = NIndicators.currentZone(computed);
  const acc = NIndicators.accuracy([{ expected: "up", actual: "up" }, { expected: "up", actual: "down" }]);
  assert.ok(Array.isArray(signals.ranked));
  assert.ok(zone.zone);
  assert.equal(acc.total, 2);
  assert.equal(acc.hits, 1);
  assert.ok(Array.isArray(computed.rsi));
  assert.ok(computed.td);
});

test("detectGogoZones builds high/low bands from swing pivots", () => {
  const closes = [100, 102, 108, 104, 101, 99, 96, 92, 95, 98, 103, 110, 106, 104, 107, 100, 94, 90, 93, 97];
  const candles = closes.map((close, i) => ({
    date: `202602${String(i + 1).padStart(2, "0")}`,
    open: close - 1,
    high: close + 3,
    low: close - 3,
    close,
    volume: 1000,
  }));
  const zones = NIndicators.detectGogoZones(candles);
  assert.ok(zones);
  assert.ok(zones.highHigh > zones.lowLow);
  assert.ok(zones.zoneHigh.high >= zones.zoneHigh.low);
  assert.ok(zones.zoneLow.high >= zones.zoneLow.low);
  assert.ok(String(zones.comment).includes("고점대"));
  assert.ok(Array.isArray(zones.swingHighs) && zones.swingHighs.length > 0);
  assert.ok(Array.isArray(zones.swingLows) && zones.swingLows.length > 0);
  if (zones.trendHigh1 && zones.trendHigh2) {
    assert.ok(zones.trendHigh1.price > zones.trendHigh2.price);
    assert.ok(zones.trendHigh1.i < zones.trendHigh2.i);
  }
});

test("detectGogoZones finds declining high-to-high trendline", () => {
  const candles = [];
  for (let i = 0; i < 36; i += 1) {
    let close = 100 + Math.sin(i / 3) * 2;
    if (i === 6) close = 140;
    else if (i === 20) close = 122;
    else if (i === 13) close = 88;
    else if (i === 28) close = 94;
    candles.push({
      date: `202603${String(i + 1).padStart(2, "0")}`,
      open: close - 1,
      high: close + 4,
      low: close - 4,
      close,
      volume: 1000,
    });
  }
  const zones = NIndicators.detectGogoZones(candles);
  assert.ok(zones);
  assert.ok(zones.trendHigh1 && zones.trendHigh2);
  assert.ok(zones.trendHigh1.price > zones.trendHigh2.price);
  assert.ok(Number.isFinite(zones.trendLinePrice));
  assert.ok(String(zones.comment).includes("추세선"));
});

test("personalAlerts covers 급락 돌파 공포탐욕 뉴스", () => {
  const crash = NIndicators.personalAlerts({ name: "테스트", code: "005930", changeRate: -6.1 });
  assert.equal(crash[0].kind, "crash");
  assert.equal(crash[0].label, "급락");
  const brk = NIndicators.personalAlerts({ name: "테스트", lastClose: 111, recentHigh: 105 });
  assert.equal(brk.some((s) => s.kind === "breakout"), true);
  const fg = NIndicators.personalAlerts({ name: "테스트", fearGreed: 12 });
  assert.equal(fg.some((s) => s.kind === "fearGreed" && s.opportunity), true);
  const news = NIndicators.personalAlerts({ name: "테스트전자", code: "005930", newsTitles: ["테스트전자 실적 상향"] });
  assert.equal(news.some((s) => s.kind === "news" && s.opportunity), true);
});
