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
