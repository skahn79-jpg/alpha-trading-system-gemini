/**
 * NChart — canvas chart engine (APK-parity UX).
 *
 * Stable API:
 *   const chart = NChart.create(canvas, options)
 *   chart.setData(candles, view?)
 *   chart.draw()
 *
 * Features:
 *   - current-price yellow badge + dotted line (distinct from SMA50 green)
 *   - orange crosshair readout (price / date / oscillator)
 *   - MA100↔MA200 translucent cloud
 *   - 고고저 고점대/저점대 + 고점①(최고)→고점②(이후 낮은 고점) 추세선
 *   - larger date-axis (~20px) and price/osc fonts
 *   - future gutter capped at 30 bars
 */

"use strict";

import NIndicators from "./nindicators.js";
import NDraw from "./ndraw.js";
import ChartGestures from "./chart-gestures.js";

const MAX_FUTURE_GUTTER = 30;
const COLORS = {
  bg: "#0a0f1e",
  grid: "#1a2035",
  axis: "#8aa4b5",
  up: "#00ff88",
  down: "#ff4466",
  sma50: "#22c55e",
  ma100: "#60a5fa",
  ma200: "#f97316",
  last: "#ffd447",
  cross: "#ff8a2b",
  rsi: "#c4b5fd",
  volumeUp: "rgba(0,255,136,0.45)",
  volumeDown: "rgba(255,68,102,0.45)",
  cloudUp: "rgba(34,197,94,0.16)",
  cloudDown: "rgba(249,115,22,0.16)",
  zoneHigh: "rgba(255,68,102,0.16)",
  zoneHighLine: "rgba(255,68,102,0.7)",
  zoneLow: "rgba(0,255,136,0.16)",
  zoneLowLine: "rgba(0,255,136,0.7)",
  poc: "rgba(249,115,22,0.75)",
  hvn: "rgba(249,115,22,0.35)",
};

function num(v, fallback = NaN) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseTime(value) {
  return NDraw.parseTime(value);
}

function formatPrice(value) {
  const n = num(value);
  if (!Number.isFinite(n)) return "-";
  const abs = Math.abs(n);
  if (abs >= 1000) return Math.round(n).toLocaleString("ko-KR");
  if (abs >= 1) return (Math.round(n * 100) / 100).toLocaleString("ko-KR");
  return n.toPrecision(4);
}

function formatDate(value) {
  const s = String(value || "");
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return `${s.slice(0, 4)}.${s.slice(5, 7)}.${s.slice(8, 10)}`;
  if (/^\d{6}$/.test(s)) return `${s.slice(0, 4)}.${s.slice(4, 6)}`;
  const t = parseTime(s);
  if (!Number.isFinite(t)) return s.slice(0, 10);
  const d = new Date(t);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}.${mm}.${dd}`;
}

function futureGutterBars(visibleCount, requested = 8) {
  const want = Number.isFinite(requested) ? requested : 8;
  const zoomedOut = visibleCount >= 180;
  const cap = zoomedOut ? Math.min(MAX_FUTURE_GUTTER, 12) : MAX_FUTURE_GUTTER;
  return clamp(want, 0, cap);
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function computeLayout(width, height, candleCount, options = {}) {
  const dateAxisPx = options.dateAxisPx || 20;
  const pad = {
    l: options.padL || 78,
    r: options.padR || 72,
    t: options.padT || 28,
    b: Math.max(36, dateAxisPx + 16),
  };
  const gutter = futureGutterBars(candleCount, options.futureGutter);
  const slots = Math.max(1, candleCount + gutter);
  const plotW = Math.max(40, width - pad.l - pad.r);
  const plotH = Math.max(80, height - pad.t - pad.b);
  const oscH = options.hideOsc ? 0 : Math.max(48, Math.round(plotH * 0.18));
  const volH = options.hideVolume ? 0 : Math.max(36, Math.round(plotH * 0.14));
  const gap = 10;
  const mainH = Math.max(80, plotH - oscH - volH - (oscH ? gap : 0) - (volH ? gap : 0));
  const main = { x: pad.l, y: pad.t, w: plotW, h: mainH };
  const vol = { x: pad.l, y: main.y + main.h + gap, w: plotW, h: volH };
  const osc = { x: pad.l, y: vol.h ? vol.y + vol.h + gap : main.y + main.h + gap, w: plotW, h: oscH };
  const step = plotW / slots;
  return { width, height, pad, gutter, slots, step, main, vol, osc, dateAxisPx };
}

function priceRange(rows, extras = []) {
  let hi = -Infinity;
  let lo = Infinity;
  for (const c of rows) {
    hi = Math.max(hi, num(c.high, num(c.close)));
    lo = Math.min(lo, num(c.low, num(c.close)));
  }
  // Overlay extras (고고저 전구간 고점대 등)는 보이는 봉 진폭을 납작하게 만들 수 있어
  // 현재 윈도우 고저 근처(±15%)에 있는 값만 반영한다.
  const span = Number.isFinite(hi) && Number.isFinite(lo) ? hi - lo : 0;
  const band = Math.max(span * 0.15, Math.abs(hi) * 0.002);
  for (const v of extras) {
    if (!Number.isFinite(v)) continue;
    if (span > 0 && (v > hi + band || v < lo - band)) continue;
    hi = Math.max(hi, v);
    lo = Math.min(lo, v);
  }
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) {
    hi = 1;
    lo = 0;
  }
  const pad = Math.max(1e-6, (hi - lo) * 0.035);
  return { max: hi + pad, min: Math.max(0, lo - pad) };
}

function sliceView(candles, view) {
  const rows = Array.isArray(candles) ? candles : [];
  const count = clamp(view?.count || rows.length, 1, Math.max(1, rows.length));
  const maxOffset = Math.max(0, rows.length - count);
  const offset = clamp(view?.offset || 0, 0, maxOffset);
  const start = Math.max(0, rows.length - count - offset);
  return { full: rows, visible: rows.slice(start, start + count), start, count, offset, maxOffset };
}

function createMockCtx() {
  const calls = [];
  const fn = (name) => (...args) => { calls.push([name, args]); };
  return {
    calls,
    save: fn("save"),
    restore: fn("restore"),
    beginPath: fn("beginPath"),
    moveTo: fn("moveTo"),
    lineTo: fn("lineTo"),
    stroke: fn("stroke"),
    fill: fn("fill"),
    fillRect: fn("fillRect"),
    strokeRect: fn("strokeRect"),
    arc: fn("arc"),
    closePath: fn("closePath"),
    fillText: fn("fillText"),
    strokeText: fn("strokeText"),
    setLineDash: fn("setLineDash"),
    measureText: (text) => ({ width: String(text).length * 7 }),
    scale() {},
    clearRect: fn("clearRect"),
    quadraticCurveTo: fn("quadraticCurveTo"),
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    font: "12px sans-serif",
    textAlign: "left",
    textBaseline: "alphabetic",
    globalAlpha: 1,
  };
}

function getCanvasSize(canvas, fallbackW, fallbackH) {
  if (!canvas) return { cssW: fallbackW, cssH: fallbackH, dpr: 1 };
  const cssW = canvas.clientWidth || canvas.width || fallbackW;
  const cssH = canvas.clientHeight || canvas.height || fallbackH;
  const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
  return { cssW, cssH, dpr };
}

function ChartEngine(canvas, options = {}) {
  this.canvas = canvas || null;
  this.options = {
    futureGutter: 8,
    dateAxisPx: 20,
    priceAxisPx: 14,
    oscAxisPx: 13,
    showSma50: true,
    showMaCloud: true,
    showLastPrice: true,
    showCrosshair: true,
    showRainbow: false,
    showHalving: false,
    showGogoZones: true,
    symbol: options.symbol || "",
    timeframe: options.timeframe || "D",
    ...options,
  };
  this.full = [];
  this.view = { offset: 0, count: 80 };
  this.computed = null;
  this.layout = null;
  this.hover = null;
  this.drawings = NDraw.create({ symbol: this.options.symbol, drawings: options.drawings });
  this.listeners = [];
  this._bind();
}

ChartEngine.prototype._emitView = function emitView() {
  if (typeof this.options.onViewChange === "function") {
    this.options.onViewChange({ offset: this.view.offset || 0, count: this.view.count });
  }
};

ChartEngine.prototype._applyPinch = function applyPinch(scale, baseCount) {
  const next = ChartGestures.nextVisibleCount(baseCount, scale, this.full.length);
  this.view.count = next;
  const sliced = sliceView(this.full, this.view);
  this.view.offset = sliced.offset;
  this.view.count = sliced.count;
  this._emitView();
  this.draw();
};

ChartEngine.prototype._applyPan = function applyPan(dx, startOffset, cssW) {
  const next = ChartGestures.nextOffset(startOffset, dx, cssW, this.view.count, this.full.length);
  this.view.offset = next;
  this._emitView();
  this.draw();
};

ChartEngine.prototype._bind = function bind() {
  if (!this.canvas || typeof this.canvas.addEventListener !== "function") return;
  if (this.canvas.style) this.canvas.style.touchAction = "none";

  const move = (ev) => {
    const pt = this._eventPoint(ev);
    if (this._drag && this._drag.pointerId === ev.pointerId) {
      const dx = ev.clientX - this._drag.startX;
      const dy = ev.clientY - this._drag.startY;
      if (this._drag.locked == null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        this._drag.locked = ChartGestures.isHorizontalPan(dx, dy) ? "x" : "y";
      }
      if (this._drag.locked === "x") {
        ev.preventDefault?.();
        const { cssW } = getCanvasSize(this.canvas, this.options.width || 900, this.options.height || 560);
        this._applyPan(dx, this._drag.startOffset, cssW);
      }
    }
    this.hover = this.hitTest(pt.x, pt.y);
    this.draw();
    if (typeof this.options.onHover === "function") this.options.onHover(this.hover);
  };
  const down = (ev) => {
    this._drag = { pointerId: ev.pointerId, startX: ev.clientX, startY: ev.clientY, startOffset: this.view.offset || 0, locked: null };
    try { this.canvas.setPointerCapture?.(ev.pointerId); } catch { /* ignore */ }
  };
  const up = (ev) => {
    this._drag = null;
    try { this.canvas.releasePointerCapture?.(ev.pointerId); } catch { /* ignore */ }
  };
  const leave = () => {
    this._drag = null;
    this.hover = null;
    this.draw();
    if (typeof this.options.onHover === "function") this.options.onHover(null);
  };
  const wheel = (ev) => {
    ev.preventDefault?.();
    const zoomIn = ev.deltaY < 0;
    const scale = zoomIn ? 1.18 : 0.85;
    this._applyPinch(scale, this.view.count);
  };
  const touchStart = (ev) => {
    if (ev.touches.length >= 2) {
      this._drag = null;
      this._pinch = {
        dist: ChartGestures.touchDistance(ev.touches[0], ev.touches[1]),
        count: this.view.count,
      };
      ev.preventDefault();
    }
  };
  const touchMove = (ev) => {
    if (ev.touches.length >= 2 && this._pinch) {
      ev.preventDefault();
      const dist = ChartGestures.touchDistance(ev.touches[0], ev.touches[1]);
      const scale = dist / Math.max(1, this._pinch.dist);
      this._applyPinch(scale, this._pinch.count);
    }
  };
  const touchEnd = () => {
    this._pinch = null;
  };

  this.canvas.addEventListener("pointerdown", down);
  this.canvas.addEventListener("pointermove", move);
  this.canvas.addEventListener("pointerup", up);
  this.canvas.addEventListener("pointercancel", up);
  this.canvas.addEventListener("pointerleave", leave);
  this.canvas.addEventListener("wheel", wheel, { passive: false });
  this.canvas.addEventListener("touchstart", touchStart, { passive: false });
  this.canvas.addEventListener("touchmove", touchMove, { passive: false });
  this.canvas.addEventListener("touchend", touchEnd);
  this.canvas.addEventListener("touchcancel", touchEnd);
  this.listeners.push(
    ["pointerdown", down],
    ["pointermove", move],
    ["pointerup", up],
    ["pointercancel", up],
    ["pointerleave", leave],
    ["wheel", wheel],
    ["touchstart", touchStart],
    ["touchmove", touchMove],
    ["touchend", touchEnd],
    ["touchcancel", touchEnd]
  );
};

ChartEngine.prototype.destroy = function destroy() {
  if (!this.canvas) return;
  for (const [type, fn] of this.listeners) this.canvas.removeEventListener(type, fn);
  this.listeners = [];
};

ChartEngine.prototype._eventPoint = function eventPoint(ev) {
  const rect = this.canvas.getBoundingClientRect ? this.canvas.getBoundingClientRect() : { left: 0, top: 0 };
  return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
};

ChartEngine.prototype.setData = function setData(candles, view) {
  this.full = Array.isArray(candles) ? candles : [];
  if (view) this.view = { ...this.view, ...view };
  if (!this.view.count) this.view.count = Math.min(80, this.full.length || 1);
  this.computed = NIndicators.compute(this.full, {
    includeHalving: this.options.showHalving || this.options.assetType === "crypto",
  });
  return this;
};

ChartEngine.prototype.setView = function setView(view) {
  this.view = { ...this.view, ...view };
  return this;
};

ChartEngine.prototype.setTimeframe = function setTimeframe(tf) {
  this.options.timeframe = tf;
  return this;
};

ChartEngine.prototype.setDrawings = function setDrawings(list) {
  this.drawings = NDraw.create({ symbol: this.options.symbol, drawings: list });
  return this;
};

ChartEngine.prototype.hitTest = function hitTest(x, y) {
  const sliced = sliceView(this.full, this.view);
  const layout = this.layout || computeLayout(800, 520, sliced.visible.length, this.options);
  const idx = Math.round((x - layout.main.x) / layout.step);
  if (idx < 0 || idx >= sliced.visible.length) {
    return { x, y, index: null, candle: null, osc: null };
  }
  const candle = sliced.visible[idx];
  const fullIdx = sliced.start + idx;
  const rsi = this.computed?.rsi?.[fullIdx];
  const cmo = this.computed?.cmo?.[fullIdx];
  return {
    x,
    y,
    index: idx,
    fullIndex: fullIdx,
    candle,
    date: candle?.date,
    price: candle ? num(candle.close) : null,
    osc: {
      rsi: Number.isFinite(rsi) ? Math.round(rsi * 10) / 10 : null,
      cmo: Number.isFinite(cmo) ? Math.round(cmo * 10) / 10 : null,
    },
  };
};

ChartEngine.prototype._ctx = function getCtx() {
  if (!this.canvas) return createMockCtx();
  if (typeof this.canvas.getContext !== "function") return createMockCtx();
  return this.canvas.getContext("2d") || createMockCtx();
};

ChartEngine.prototype.draw = function draw() {
  const sliced = sliceView(this.full, this.view);
  const visible = sliced.visible;
  const { cssW, cssH, dpr } = getCanvasSize(this.canvas, this.options.width || 900, this.options.height || 560);
  if (this.canvas && this.canvas.width !== undefined) {
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    if (this.canvas.style) {
      this.canvas.style.width = `${cssW}px`;
      this.canvas.style.height = `${cssH}px`;
    }
  }
  const ctx = this._ctx();
  if (ctx.scale && dpr !== 1) ctx.scale(dpr, dpr);
  const layout = computeLayout(cssW, cssH, visible.length, this.options);
  this.layout = layout;
  const extras = [];
  if (this.computed) {
    extras.push(this.computed.ma50?.[sliced.start + visible.length - 1]);
    extras.push(this.computed.ma100?.[sliced.start + visible.length - 1]);
    extras.push(this.computed.ma200?.[sliced.start + visible.length - 1]);
  }
  if (Array.isArray(this.options.overlayPrices)) extras.push(...this.options.overlayPrices);
  const gogoZones = this.options.showGogoZones === false ? null : NIndicators.detectGogoZones(this.full);
  const volumeProfile = NIndicators.volumeProfile(visible);
  if (gogoZones) extras.push(gogoZones.highHigh, gogoZones.highLow, gogoZones.lowHigh, gogoZones.lowLow, gogoZones.trendLinePrice);
  if (volumeProfile) extras.push(volumeProfile.poc, ...(volumeProfile.hvn || []));
  const range = priceRange(visible, extras);
  const xAtIndex = (i) => layout.main.x + i * layout.step + layout.step * 0.5;
  const yAtPrice = (p) => layout.main.y + ((range.max - num(p, range.min)) / Math.max(1e-9, range.max - range.min)) * layout.main.h;
  const yOsc = (v) => layout.osc.y + layout.osc.h - (num(v, 50) / 100) * layout.osc.h;

  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, cssW, cssH);

  this._drawGrid(ctx, layout, range);
  if (gogoZones) this._drawGogoZones(ctx, layout, yAtPrice, gogoZones, sliced, xAtIndex);
  if (volumeProfile) this._drawVolumeProfile(ctx, layout, yAtPrice, volumeProfile);
  if (this.options.showMaCloud) this._drawMaCloud(ctx, sliced, xAtIndex, yAtPrice);
  if (this.options.showRainbow) this._drawRainbow(ctx, sliced, xAtIndex, yAtPrice);
  if (this.options.showSma50) this._drawLine(ctx, sliced, this.computed?.ma50, xAtIndex, yAtPrice, COLORS.sma50, 1.6);
  this._drawCandles(ctx, visible, xAtIndex, yAtPrice, layout);
  if (this.options.showLastPrice) this._drawLastPrice(ctx, visible, layout, yAtPrice);
  if (this.options.showHalving) this._drawHalvings(ctx, visible, layout, xAtIndex);
  this._drawVolume(ctx, visible, layout, xAtIndex);
  this._drawOsc(ctx, sliced, layout, xAtIndex, yOsc);
  this._drawAxes(ctx, visible, layout, range);
  this.drawings.render(ctx, {
    candles: visible,
    xAtIndex,
    yAtPrice,
    plot: layout.main,
  });
  if (this.options.overlays) this._drawOverlays(ctx, this.options.overlays, visible, xAtIndex, yAtPrice, layout);
  if (this.options.showCrosshair && this.hover?.candle) this._drawCrosshair(ctx, layout, yAtPrice, yOsc);

  return {
    layout,
    gutter: layout.gutter,
    visible: visible.length,
    last: visible[visible.length - 1] || null,
    gogoZones,
    volumeProfile,
  };
};

ChartEngine.prototype._drawGrid = function drawGrid(ctx, layout, range) {
  ctx.save();
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g += 1) {
    const y = layout.main.y + (layout.main.h / 4) * g;
    ctx.beginPath();
    ctx.moveTo(layout.main.x, y);
    ctx.lineTo(layout.main.x + layout.main.w, y);
    ctx.stroke();
  }
  ctx.restore();
};

ChartEngine.prototype._drawLine = function drawLine(ctx, sliced, series, xAtIndex, yAtPrice, color, width) {
  if (!series) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width || 1.4;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < sliced.visible.length; i += 1) {
    const v = series[sliced.start + i];
    if (!Number.isFinite(v)) continue;
    const x = xAtIndex(i);
    const y = yAtPrice(v);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
};

ChartEngine.prototype._drawGogoZones = function drawGogoZones(ctx, layout, yAtPrice, zones, sliced, xAtIndex) {
  if (!zones) return;
  const left = layout.main.x;
  const right = layout.main.x + layout.main.w;
  const band = (lo, hi, fill, stroke, label, alignTop) => {
    const y1 = yAtPrice(hi);
    const y2 = yAtPrice(lo);
    const top = Math.min(y1, y2);
    const h = Math.max(3, Math.abs(y2 - y1));
    ctx.fillStyle = fill;
    ctx.fillRect(left, top, right - left, h);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(left, top + h / 2);
    ctx.lineTo(right, top + h / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = stroke;
    ctx.font = "10px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = alignTop ? "bottom" : "top";
    ctx.fillText(label, left + 4, alignTop ? top - 2 : top + h + 2);
  };
  ctx.save();
  band(zones.highLow, zones.highHigh, COLORS.zoneHigh, COLORS.zoneHighLine, `고점대 ${formatPrice(zones.highLow)}~${formatPrice(zones.highHigh)}`, true);
  band(zones.lowLow, zones.lowHigh, COLORS.zoneLow, COLORS.zoneLowLine, `저점대 ${formatPrice(zones.lowLow)}~${formatPrice(zones.lowHigh)}`, false);

  const plotPivot = (pivot, fill) => {
    if (!pivot || !sliced || typeof xAtIndex !== "function") return;
    const vis = pivot.i - sliced.start;
    if (vis < 0 || vis >= sliced.visible.length) return;
    const x = xAtIndex(vis);
    const y = yAtPrice(pivot.price);
    ctx.beginPath();
    ctx.fillStyle = fill;
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  };
  (zones.swingHighs || []).forEach((p) => plotPivot(p, COLORS.zoneHighLine));
  (zones.swingLows || []).forEach((p) => plotPivot(p, COLORS.zoneLowLine));

  if (zones.trendHigh1 && zones.trendHigh2 && sliced && typeof xAtIndex === "function") {
    const h1 = zones.trendHigh1;
    const h2 = zones.trendHigh2;
    const span = h2.i - h1.i;
    if (span > 0) {
      const slope = (h2.price - h1.price) / span;
      const startVis = Math.max(0, h1.i - sliced.start);
      const endVis = sliced.visible.length - 1;
      if (endVis >= startVis) {
        const pStart = h1.price + slope * (sliced.start + startVis - h1.i);
        const pEnd = h1.price + slope * (sliced.start + endVis - h1.i);
        ctx.strokeStyle = zones.isBreakout ? COLORS.zoneLowLine : COLORS.zoneHighLine;
        ctx.lineWidth = 1.4;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(xAtIndex(startVis), yAtPrice(pStart));
        ctx.lineTo(xAtIndex(endVis), yAtPrice(pEnd));
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }
  ctx.restore();
};

ChartEngine.prototype._drawVolumeProfile = function drawVolumeProfile(ctx, layout, yAtPrice, profile) {
  if (!profile || !Number.isFinite(profile.poc)) return;
  const left = layout.main.x;
  const right = layout.main.x + layout.main.w;
  const line = (price, color, dash, label) => {
    const y = yAtPrice(price);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    ctx.setLineDash([]);
    if (label) {
      ctx.fillStyle = color;
      ctx.font = "10px sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText(label, right - 4, y - 2);
    }
  };
  ctx.save();
  (profile.hvn || []).forEach((price) => {
    if (Number.isFinite(price) && Math.abs(price - profile.poc) / Math.max(profile.poc, 1) > 0.004) {
      line(price, COLORS.hvn, [1, 4]);
    }
  });
  line(profile.poc, COLORS.poc, [2, 3], `POC ${formatPrice(profile.poc)}`);
  ctx.restore();
};

ChartEngine.prototype._drawMaCloud = function drawMaCloud(ctx, sliced, xAtIndex, yAtPrice) {
  const a = this.computed?.ma100;
  const b = this.computed?.ma200;
  if (!a || !b) return;
  const pts = [];
  for (let i = 0; i < sliced.visible.length; i += 1) {
    const va = a[sliced.start + i];
    const vb = b[sliced.start + i];
    if (!Number.isFinite(va) || !Number.isFinite(vb)) continue;
    pts.push({ x: xAtIndex(i), y1: yAtPrice(va), y2: yAtPrice(vb), up: va >= vb });
  }
  if (pts.length < 2) return;
  const up = pts[pts.length - 1].up;
  ctx.save();
  ctx.fillStyle = up ? COLORS.cloudUp : COLORS.cloudDown;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y1);
  for (const p of pts) ctx.lineTo(p.x, p.y1);
  for (let i = pts.length - 1; i >= 0; i -= 1) ctx.lineTo(pts[i].x, pts[i].y2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  this._drawLine(ctx, sliced, a, xAtIndex, yAtPrice, COLORS.ma100, 1.2);
  this._drawLine(ctx, sliced, b, xAtIndex, yAtPrice, COLORS.ma200, 1.2);
};

ChartEngine.prototype._drawRainbow = function drawRainbow(ctx, sliced, xAtIndex, yAtPrice) {
  const bands = this.computed?.rainbow || [];
  for (const band of bands) {
    this._drawLine(ctx, sliced, band.series, xAtIndex, yAtPrice, band.color, 1);
  }
};

ChartEngine.prototype._drawCandles = function drawCandles(ctx, visible, xAtIndex, yAtPrice, layout) {
  const w = Math.max(2, Math.min(11, layout.step * 0.62));
  for (let i = 0; i < visible.length; i += 1) {
    const c = visible[i];
    const x = xAtIndex(i);
    const up = num(c.close) >= num(c.open);
    ctx.strokeStyle = up ? COLORS.up : COLORS.down;
    ctx.fillStyle = up ? COLORS.up : COLORS.down;
    ctx.beginPath();
    ctx.moveTo(x, yAtPrice(c.high));
    ctx.lineTo(x, yAtPrice(c.low));
    ctx.stroke();
    const y1 = yAtPrice(c.open);
    const y2 = yAtPrice(c.close);
    ctx.fillRect(x - w / 2, Math.min(y1, y2), w, Math.max(1.4, Math.abs(y2 - y1)));
  }
};

ChartEngine.prototype._drawLastPrice = function drawLastPrice(ctx, visible, layout, yAtPrice) {
  const last = visible[visible.length - 1];
  if (!last) return;
  const y = yAtPrice(last.close);
  ctx.save();
  ctx.strokeStyle = COLORS.last;
  ctx.setLineDash([3, 4]);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(layout.main.x, y);
  ctx.lineTo(layout.main.x + layout.main.w, y);
  ctx.stroke();
  const label = formatPrice(last.close);
  ctx.setLineDash([]);
  ctx.font = "bold 12px sans-serif";
  const tw = Math.max(52, ctx.measureText(label).width + 14);
  const bx = layout.main.x + layout.main.w + 6;
  const by = y - 10;
  ctx.fillStyle = COLORS.last;
  ctx.fillRect(bx, by, tw, 20);
  ctx.fillStyle = "#1a1400";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, bx + tw / 2, y);
  ctx.restore();
};

ChartEngine.prototype._drawHalvings = function drawHalvings(ctx, visible, layout, xAtIndex) {
  const events = this.computed?.halvings?.events || [];
  if (!events.length) return;
  ctx.save();
  ctx.strokeStyle = "rgba(255,212,71,0.45)";
  ctx.setLineDash([2, 4]);
  for (const ev of events) {
    const idx = NDraw.findNearestBar(visible, ev.t);
    if (idx < 0) continue;
    const x = xAtIndex(idx);
    ctx.beginPath();
    ctx.moveTo(x, layout.main.y);
    ctx.lineTo(x, layout.main.y + layout.main.h);
    ctx.stroke();
  }
  ctx.restore();
};

ChartEngine.prototype._drawVolume = function drawVolume(ctx, visible, layout, xAtIndex) {
  if (!layout.vol.h) return;
  const maxVol = Math.max(1, ...visible.map((c) => num(c.volume, 0)));
  const w = Math.max(1.5, Math.min(11, layout.step * 0.62));
  for (let i = 0; i < visible.length; i += 1) {
    const c = visible[i];
    const h = (num(c.volume, 0) / maxVol) * layout.vol.h;
    const up = num(c.close) >= num(c.open);
    ctx.fillStyle = up ? COLORS.volumeUp : COLORS.volumeDown;
    ctx.fillRect(xAtIndex(i) - w / 2, layout.vol.y + layout.vol.h - h, w, Math.max(1, h));
  }
};

ChartEngine.prototype._drawOsc = function drawOsc(ctx, sliced, layout, xAtIndex, yOsc) {
  if (!layout.osc.h || !this.computed) return;
  ctx.save();
  ctx.strokeStyle = "rgba(239,68,68,0.55)";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(layout.osc.x, yOsc(70));
  ctx.lineTo(layout.osc.x + layout.osc.w, yOsc(70));
  ctx.stroke();
  ctx.strokeStyle = "rgba(34,197,94,0.55)";
  ctx.beginPath();
  ctx.moveTo(layout.osc.x, yOsc(30));
  ctx.lineTo(layout.osc.x + layout.osc.w, yOsc(30));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = COLORS.rsi;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < sliced.visible.length; i += 1) {
    const v = this.computed.rsi[sliced.start + i];
    if (!Number.isFinite(v)) continue;
    const x = xAtIndex(i);
    const y = yOsc(v);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
};

ChartEngine.prototype._drawAxes = function drawAxes(ctx, visible, layout, range) {
  ctx.save();
  ctx.fillStyle = COLORS.axis;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.font = `${this.options.priceAxisPx || 14}px sans-serif`;
  for (let g = 0; g <= 4; g += 1) {
    const price = range.max - ((range.max - range.min) / 4) * g;
    const y = layout.main.y + (layout.main.h / 4) * g;
    ctx.fillText(formatPrice(price), layout.main.x - 8, y);
  }
  if (layout.osc.h) {
    ctx.font = `${this.options.oscAxisPx || 13}px sans-serif`;
    ctx.fillText("70", layout.osc.x - 8, layout.osc.y + layout.osc.h * 0.3);
    ctx.fillText("30", layout.osc.x - 8, layout.osc.y + layout.osc.h * 0.7);
    ctx.fillText("RSI", layout.osc.x - 8, layout.osc.y + 8);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = `${layout.dateAxisPx || 20}px sans-serif`;
  const step = Math.max(1, Math.ceil(visible.length / 5));
  for (let i = 0; i < visible.length; i += 1) {
    if (i !== 0 && i !== visible.length - 1 && i % step !== 0) continue;
    const x = layout.main.x + i * layout.step + layout.step * 0.5;
    ctx.fillText(formatDate(visible[i].date), x, layout.main.y + (layout.vol.h ? layout.vol.h + layout.osc.h + layout.main.h + 22 : layout.main.h + 10));
  }
  ctx.restore();
};

ChartEngine.prototype._drawOverlays = function drawOverlays(ctx, overlays, visible, xAtIndex, yAtPrice, layout) {
  if (!overlays) return;
  ctx.save();
  const lines = overlays.lines || [];
  for (const line of lines) {
    if (!Number.isFinite(line.price)) continue;
    ctx.strokeStyle = line.color || "#9b5cff";
    ctx.setLineDash(line.dash || [4, 4]);
    ctx.beginPath();
    ctx.moveTo(layout.main.x, yAtPrice(line.price));
    ctx.lineTo(layout.main.x + layout.main.w, yAtPrice(line.price));
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const mark of overlays.markers || []) {
    const idx = Number.isFinite(mark.index) ? mark.index : NDraw.findNearestBar(visible, parseTime(mark.date));
    if (idx < 0 || idx >= visible.length) continue;
    ctx.fillStyle = mark.color || "#00d9ff";
    ctx.beginPath();
    ctx.arc(xAtIndex(idx), yAtPrice(mark.price), 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
};

ChartEngine.prototype._drawCrosshair = function drawCrosshair(ctx, layout, yAtPrice, yOsc) {
  const hover = this.hover;
  if (!hover?.candle) return;
  const x = this.layout.main.x + hover.index * this.layout.step + this.layout.step * 0.5;
  const y = yAtPrice(hover.price);
  ctx.save();
  ctx.strokeStyle = COLORS.cross;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(x, layout.main.y);
  ctx.lineTo(x, layout.osc.h ? layout.osc.y + layout.osc.h : layout.main.y + layout.main.h);
  ctx.moveTo(layout.main.x, y);
  ctx.lineTo(layout.main.x + layout.main.w, y);
  ctx.stroke();
  ctx.setLineDash([]);
  const rsi = hover.osc?.rsi;
  const cmo = hover.osc?.cmo;
  const lines = [
    formatDate(hover.date),
    `가격 ${formatPrice(hover.price)}`,
    rsi != null ? `RSI ${rsi}` : null,
    cmo != null ? `CMO ${cmo}` : null,
  ].filter(Boolean);
  ctx.font = "12px sans-serif";
  const tw = Math.max(...lines.map((t) => ctx.measureText(t).width)) + 16;
  const th = lines.length * 16 + 10;
  const bx = clamp(x + 10, layout.main.x, layout.main.x + layout.main.w - tw);
  const by = clamp(y - th - 8, layout.main.y, layout.main.y + layout.main.h - th);
  ctx.fillStyle = "rgba(255,138,43,0.92)";
  ctx.fillRect(bx, by, tw, th);
  ctx.fillStyle = "#1a0e00";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  lines.forEach((t, i) => ctx.fillText(t, bx + 8, by + 6 + i * 16));
  ctx.restore();
};

function create(canvas, options) {
  return new ChartEngine(canvas, options);
}

const NChart = {
  create,
  COLORS,
  MAX_FUTURE_GUTTER,
  futureGutterBars,
  computeLayout,
  sliceView,
  formatPrice,
  formatDate,
  priceRange,
  detectGogoZones: NIndicators.detectGogoZones,
  volumeProfile: NIndicators.volumeProfile,
};

export default NChart;
export { create, COLORS, MAX_FUTURE_GUTTER, futureGutterBars, computeLayout, sliceView, formatPrice, formatDate, priceRange };
