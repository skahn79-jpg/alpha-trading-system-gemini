/**
 * NDraw — chart drawing tools (APK-parity).
 *
 * Tools: hline, vline, trend, arrowUp, arrowDown, cross, channel, sine
 * Persistence: sharedKey + CROSS-TF so drawings survive timeframe changes
 * by storing timestamps/prices rather than bar indexes.
 */

"use strict";

const TOOLS = ["hline", "vline", "trend", "arrowUp", "arrowDown", "cross", "channel", "sine"];
const STORAGE_PREFIX = "alpha_ndraw_v1:";
const CROSS_TF = "CROSS-TF";

function safeId() {
  return `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function num(v, fallback = NaN) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseTime(value) {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const s = String(value);
  if (/^\d{8}$/.test(s)) return Date.parse(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00Z`);
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function storageAvailable() {
  try {
    return typeof localStorage !== "undefined" && localStorage;
  } catch {
    return null;
  }
}

function sharedKey(symbol, tool, points = []) {
  const sym = String(symbol || "UNKNOWN").toUpperCase();
  const kind = String(tool || "mark").toLowerCase();
  const stamp = (points || [])
    .map((p) => `${p.t ?? parseTime(p.date) ?? ""}:${Number(p.price || 0).toFixed(4)}`)
    .join("|");
  return `${CROSS_TF}:${sym}:${kind}:${stamp || "open"}`;
}

function normalizeDrawing(raw, symbol) {
  if (!raw || !TOOLS.includes(raw.type)) return null;
  const points = Array.isArray(raw.points) ? raw.points.map((p) => ({
    t: num(p.t, parseTime(p.date)),
    date: p.date || null,
    price: num(p.price),
    extra: p.extra,
  })) : [];
  return {
    id: raw.id || safeId(),
    type: raw.type,
    symbol: String(raw.symbol || symbol || ""),
    timeframe: raw.timeframe || CROSS_TF,
    sharedKey: raw.sharedKey || sharedKey(raw.symbol || symbol, raw.type, points),
    persist: raw.persist !== false,
    color: raw.color || defaultColor(raw.type),
    points,
    meta: raw.meta || {},
  };
}

function defaultColor(type) {
  if (type === "sine") return "#f59e0b";
  if (type === "arrowUp") return "#00ff88";
  if (type === "arrowDown") return "#ff4466";
  if (type === "channel") return "#60a5fa";
  if (type === "cross") return "#e879f9";
  return "#ffd447";
}

function pointsNeeded(type) {
  if (type === "hline" || type === "vline" || type === "arrowUp" || type === "arrowDown" || type === "cross") return 1;
  if (type === "channel") return 3;
  return 2;
}

function sineSamples(p1, p2, cycles = 1, count = 72) {
  const t0 = num(p1.t);
  const t1 = num(p2.t);
  const y0 = num(p1.price);
  const y1 = num(p2.price);
  if (![t0, t1, y0, y1].every(Number.isFinite) || t1 === t0) return [];
  const mid = (y0 + y1) / 2;
  const amp = Math.abs(y1 - y0) / 2 || 1;
  const period = t1 - t0;
  const out = [];
  const span = period * Math.max(1, cycles);
  const start = t0;
  for (let i = 0; i <= count; i += 1) {
    const u = i / count;
    const t = start + span * u;
    const price = mid + amp * Math.sin(u * Math.PI * 2 * cycles);
    out.push({ t, price });
  }
  return out;
}

function findNearestBar(candles, t) {
  if (!Array.isArray(candles) || !Number.isFinite(t)) return -1;
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < candles.length; i += 1) {
    const ct = parseTime(candles[i].date ?? candles[i].t);
    if (!Number.isFinite(ct)) continue;
    const dist = Math.abs(ct - t);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

function mapPoint(point, candles, xAtIndex, yAtPrice) {
  const idx = Number.isFinite(point.index) ? point.index : findNearestBar(candles, point.t);
  if (idx < 0) return null;
  return {
    x: xAtIndex(idx),
    y: yAtPrice(point.price),
    index: idx,
    price: point.price,
  };
}

function drawArrow(ctx, x, y, up, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  if (up) {
    ctx.moveTo(x, y - 10);
    ctx.lineTo(x - 7, y + 6);
    ctx.lineTo(x + 7, y + 6);
  } else {
    ctx.moveTo(x, y + 10);
    ctx.lineTo(x - 7, y - 6);
    ctx.lineTo(x + 7, y - 6);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function renderDrawing(ctx, drawing, env) {
  const { candles, xAtIndex, yAtPrice, plot } = env;
  const mapped = drawing.points.map((p) => mapPoint(p, candles, xAtIndex, yAtPrice)).filter(Boolean);
  ctx.save();
  ctx.strokeStyle = drawing.color;
  ctx.fillStyle = drawing.color;
  ctx.lineWidth = 1.4;
  ctx.setLineDash([]);

  if (drawing.type === "hline" && mapped[0]) {
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(plot.x, mapped[0].y);
    ctx.lineTo(plot.x + plot.w, mapped[0].y);
    ctx.stroke();
  } else if (drawing.type === "vline" && mapped[0]) {
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(mapped[0].x, plot.y);
    ctx.lineTo(mapped[0].x, plot.y + plot.h);
    ctx.stroke();
  } else if (drawing.type === "trend" && mapped[0] && mapped[1]) {
    ctx.beginPath();
    ctx.moveTo(mapped[0].x, mapped[0].y);
    ctx.lineTo(mapped[1].x, mapped[1].y);
    ctx.stroke();
  } else if (drawing.type === "channel" && mapped[0] && mapped[1] && mapped[2]) {
    ctx.beginPath();
    ctx.moveTo(mapped[0].x, mapped[0].y);
    ctx.lineTo(mapped[1].x, mapped[1].y);
    ctx.stroke();
    const dx = mapped[1].x - mapped[0].x;
    const dy = mapped[1].y - mapped[0].y;
    ctx.globalAlpha = 0.16;
    ctx.beginPath();
    ctx.moveTo(mapped[0].x, mapped[0].y);
    ctx.lineTo(mapped[1].x, mapped[1].y);
    ctx.lineTo(mapped[1].x + (mapped[2].x - mapped[1].x), mapped[2].y);
    ctx.lineTo(mapped[0].x + (mapped[2].x - mapped[0].x), mapped[2].y - dy + (mapped[2].y - mapped[1].y));
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(mapped[0].x + (mapped[2].x - mapped[0].x), mapped[0].y + (mapped[2].y - mapped[0].y));
    ctx.lineTo(mapped[1].x + (mapped[2].x - mapped[1].x), mapped[1].y + (mapped[2].y - mapped[1].y));
    ctx.stroke();
  } else if (drawing.type === "arrowUp" && mapped[0]) {
    drawArrow(ctx, mapped[0].x, mapped[0].y, true, drawing.color);
  } else if (drawing.type === "arrowDown" && mapped[0]) {
    drawArrow(ctx, mapped[0].x, mapped[0].y, false, drawing.color);
  } else if (drawing.type === "cross" && mapped[0]) {
    ctx.beginPath();
    ctx.moveTo(mapped[0].x - 8, mapped[0].y);
    ctx.lineTo(mapped[0].x + 8, mapped[0].y);
    ctx.moveTo(mapped[0].x, mapped[0].y - 8);
    ctx.lineTo(mapped[0].x, mapped[0].y + 8);
    ctx.stroke();
  } else if (drawing.type === "sine" && drawing.points[0] && drawing.points[1]) {
    const samples = sineSamples(drawing.points[0], drawing.points[1], drawing.meta.cycles || 1);
    ctx.beginPath();
    let started = false;
    for (const s of samples) {
      const m = mapPoint(s, candles, xAtIndex, yAtPrice);
      if (!m) continue;
      if (!started) {
        ctx.moveTo(m.x, m.y);
        started = true;
      } else ctx.lineTo(m.x, m.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function create(options = {}) {
  const symbol = String(options.symbol || "");
  const memory = Array.isArray(options.drawings) ? options.drawings.map((d) => normalizeDrawing(d, symbol)).filter(Boolean) : [];
  const storeKey = `${STORAGE_PREFIX}${symbol || "GLOBAL"}`;

  function load() {
    const ls = storageAvailable();
    if (!ls) return memory.slice();
    try {
      const raw = JSON.parse(ls.getItem(storeKey) || "[]");
      return (Array.isArray(raw) ? raw : []).map((d) => normalizeDrawing(d, symbol)).filter(Boolean);
    } catch {
      return memory.slice();
    }
  }

  function save(list) {
    const ls = storageAvailable();
    if (!ls) return;
    try {
      ls.setItem(storeKey, JSON.stringify(list.filter((d) => d.persist)));
    } catch {
      /* ignore quota */
    }
  }

  let drawings = load();
  if (memory.length) {
    const keys = new Set(drawings.map((d) => d.sharedKey));
    for (const d of memory) {
      if (!keys.has(d.sharedKey)) drawings.push(d);
    }
  }

  return {
    TOOLS,
    CROSS_TF,
    symbol,
    list() {
      return drawings.slice();
    },
    add(raw) {
      const drawing = normalizeDrawing({ ...raw, symbol: raw.symbol || symbol }, symbol);
      if (!drawing) return null;
      const idx = drawings.findIndex((d) => d.sharedKey === drawing.sharedKey);
      if (idx >= 0) drawings[idx] = drawing;
      else drawings.push(drawing);
      save(drawings);
      return drawing;
    },
    remove(id) {
      drawings = drawings.filter((d) => d.id !== id && d.sharedKey !== id);
      save(drawings);
    },
    clear() {
      drawings = [];
      save(drawings);
    },
    render(ctx, env) {
      for (const d of drawings) renderDrawing(ctx, d, env);
    },
    pointsNeeded,
    sineSamples,
    sharedKey,
  };
}

const NDraw = {
  TOOLS,
  CROSS_TF,
  STORAGE_PREFIX,
  create,
  sharedKey,
  pointsNeeded,
  sineSamples,
  normalizeDrawing,
  renderDrawing,
  parseTime,
  findNearestBar,
};

export default NDraw;
export { TOOLS, CROSS_TF, create, sharedKey, pointsNeeded, sineSamples, normalizeDrawing, renderDrawing, parseTime, findNearestBar };
