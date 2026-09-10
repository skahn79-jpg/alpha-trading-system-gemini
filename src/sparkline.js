/**
 * Sparkline helper for compact list previews.
 */

"use strict";

function valuesOf(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => (typeof r === "number" ? r : Number(r?.close))).filter((v) => Number.isFinite(v));
}

function renderSparkline(ctx, rows, options = {}) {
  const values = valuesOf(rows);
  const w = options.width || 120;
  const h = options.height || 28;
  const pad = 2;
  ctx.clearRect(0, 0, w, h);
  if (values.length < 2) return { last: values[0] || null, up: false };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1e-9, max - min);
  const up = values[values.length - 1] >= values[0];
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (v - min) / span) * (h - pad * 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = options.color || (up ? "#00ff88" : "#ff4466");
  ctx.lineWidth = options.lineWidth || 1.4;
  ctx.stroke();
  return { last: values[values.length - 1], up, min, max };
}

function SparklineList() {
  return {
    render(ctx, rows, options) {
      return renderSparkline(ctx, rows, options);
    },
  };
}

export { renderSparkline, SparklineList, valuesOf };
export default { renderSparkline, SparklineList, valuesOf };
