/**
 * Chart markers — map analysis events onto canvas/SVG-friendly points.
 */

"use strict";

function fromTd(td, candles = []) {
  const events = td?.events || [];
  return events.map((ev) => ({
    kind: "td",
    index: ev.index,
    date: ev.date || candles[ev.index]?.date,
    price: Number(candles[ev.index]?.close),
    label: ev.type === "buy_setup" || ev.type === "buy_countdown" ? "TD9/13▲" : "TD9/13▼",
    color: String(ev.type).startsWith("buy") ? "#00ff88" : "#ff4466",
    sentiment: String(ev.type).startsWith("buy") ? "bullish" : "bearish",
  })).filter((m) => Number.isFinite(m.price));
}

function fromHalvings(halvings, candles = []) {
  const events = halvings?.events || [];
  return events.map((ev) => ({
    kind: "halving",
    date: ev.date,
    t: ev.t,
    label: `반감기 ${ev.reward}`,
    color: "#ffd447",
    sentiment: "neutral",
    price: candles.length ? Number(candles[candles.length - 1].close) : null,
  }));
}

function fromSignals(signals = []) {
  return (signals || []).slice(0, 8).map((s, i) => ({
    kind: "signal",
    key: s.key || `sig-${i}`,
    label: s.name,
    color: (s.score || 0) >= 60 ? "#00d9ff" : "#ffd447",
    score: s.score,
  }));
}

function mergeMarkers(...lists) {
  return lists.flat().filter(Boolean);
}

export { fromTd, fromHalvings, fromSignals, mergeMarkers };
export default { fromTd, fromHalvings, fromSignals, mergeMarkers };
