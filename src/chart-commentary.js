/**
 * Thin chart-linked commentary helper (complements root chartlab.js).
 * Rule-based only — no order routing, no API keys.
 */

"use strict";

import NIndicators from "./nindicators.js";

function formatPct(n) {
  if (!Number.isFinite(n)) return "-";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}`;
}

function buildChartCommentary(candles, extras = {}) {
  const computed = extras.computed || NIndicators.compute(candles, extras.indicatorOpts || {});
  const pack = NIndicators.buildSignals(computed);
  const zone = pack.zone;
  const last = computed.lastClose;
  const ma50 = computed.ma50?.[computed.ma50.length - 1];
  const ma200 = computed.ma200?.[computed.ma200.length - 1];
  const parts = [];

  if (Number.isFinite(last) && Number.isFinite(ma50)) {
    const gap = ((last - ma50) / ma50) * 100;
    parts.push(`현재가는 SMA50 대비 ${formatPct(gap)}% ${gap >= 0 ? "위" : "아래"}에 있습니다.`);
  }
  if (Number.isFinite(computed.rsiLast)) {
    parts.push(`RSI는 ${zone.rsiValue}로 ${zone.rsi === "overbought" ? "과열권" : zone.rsi === "oversold" ? "침체권" : "중립권"}입니다.`);
  }
  if (Number.isFinite(computed.cmoLast)) {
    parts.push(`CMO ${zone.cmoValue}는 단기 모멘텀 ${zone.cmo === "overbought" ? "과열" : zone.cmo === "oversold" ? "위축" : "균형"} 상태입니다.`);
  }
  const ma100 = computed.ma100?.[computed.ma100.length - 1];
  if (Number.isFinite(ma100) && Number.isFinite(ma200)) {
    parts.push(ma100 >= ma200
      ? "MA100이 MA200 위로 상승 구름을 만들고 있습니다."
      : "MA100이 MA200 아래로 하락 구름을 만들고 있습니다.");
  }
  if (computed.td?.lastEvent) {
    parts.push(`TD Sequential 최근 이벤트: ${computed.td.lastEvent.type}.`);
  }
  if (computed.cycle?.note) parts.push(computed.cycle.note);
  if (computed.halvings?.label && extras.assetType === "crypto") {
    parts.push(`반감기 가이드: ${computed.halvings.label}.`);
  }
  if (extras.labNote) parts.push(String(extras.labNote));
  parts.push("차트 해설은 참고용이며 주문·투자 권유가 아닙니다.");

  return {
    zone,
    signals: pack.ranked,
    recommended: pack.recommended,
    paragraphs: parts,
    text: parts.join(" "),
  };
}

export { buildChartCommentary };
export default { buildChartCommentary };
