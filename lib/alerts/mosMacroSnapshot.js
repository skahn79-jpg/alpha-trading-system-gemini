'use strict';

/**
 * MOS macro snapshot for SF bits (C_vix, C_fx, C_kr).
 * Alerts/scoring only — Paper/Live stay false; no orders.
 */

const axios = require('axios');

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache = { at: 0, data: null };

function drawdownFromHigh(closes) {
  if (!Array.isArray(closes) || closes.length < 2) return null;
  let max = 0;
  let last = null;
  for (const c of closes) {
    if (!Number.isFinite(c)) continue;
    max = Math.max(max, c);
    last = c;
  }
  if (!last || max <= 0) return null;
  return Math.max(0, 1 - last / max);
}

function pctChange(closes, lookback = 5) {
  if (!Array.isArray(closes) || closes.length < lookback + 1) return null;
  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 1 - lookback];
  if (!Number.isFinite(last) || !Number.isFinite(prev) || prev === 0) return null;
  return last / prev - 1;
}

async function fetchYahooCloses(symbol, range = '1y') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  const { data } = await axios.get(url, {
    timeout: 12000,
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
  });
  const result = data?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0] || {};
  const timestamps = result?.timestamp || [];
  const rows = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = Number(quote.close?.[i]);
    if (!Number.isFinite(close)) continue;
    rows.push({
      date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
      close,
    });
  }
  return rows;
}

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 20) return null;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
    sxx += xs[i] * xs[i];
    syy += ys[i] * ys[i];
    sxy += xs[i] * ys[i];
  }
  const num = n * sxy - sx * sy;
  const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  if (!den) return null;
  return num / den;
}

function returns(closes) {
  const out = [];
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1];
    const b = closes[i];
    if (Number.isFinite(a) && Number.isFinite(b) && a !== 0) out.push(b / a - 1);
  }
  return out;
}

/** ρ60 between stock daily closes and KOSPI series (by date). */
function rho60VsIndex(stockCandles, indexRows) {
  if (!Array.isArray(stockCandles) || !Array.isArray(indexRows)) return null;
  const idx = new Map(indexRows.map((r) => [r.date, r.close]));
  const paired = [];
  for (const c of stockCandles) {
    const date = String(c.date || '').slice(0, 10);
    const ic = idx.get(date);
    const sc = Number(c.close);
    if (!Number.isFinite(ic) || !Number.isFinite(sc)) continue;
    paired.push({ s: sc, i: ic });
  }
  if (paired.length < 40) return null;
  const window = paired.slice(-61);
  return pearson(returns(window.map((p) => p.s)), returns(window.map((p) => p.i)));
}

/**
 * @returns {Promise<{
 *  asOf: string,
 *  vix: number|null,
 *  dVix5d: number|null,
 *  dFx5d: number|null,
 *  usdKrw: number|null,
 *  dKospi: number|null,
 *  dSpy: number|null,
 *  krUsDdGap: number|null,
 *  bits: { C_vix: number, C_fx: number, C_kr: number },
 *  kospi: Array<{date:string, close:number}>,
 *  cached: boolean,
 *  paperLive: false
 * }>}
 */
async function getMosMacroSnapshot({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.data && now - cache.at < CACHE_TTL_MS) {
    return { ...cache.data, cached: true };
  }

  const [vixRows, fxRows, ksRows, spyRows] = await Promise.all([
    fetchYahooCloses('^VIX', '3mo'),
    fetchYahooCloses('KRW=X', '3mo'),
    fetchYahooCloses('^KS11', '1y'),
    fetchYahooCloses('SPY', '1y'),
  ]);

  const vixCloses = vixRows.map((r) => r.close);
  const fxCloses = fxRows.map((r) => r.close);
  const ksCloses = ksRows.map((r) => r.close);
  const spyCloses = spyRows.map((r) => r.close);

  const vix = vixCloses.length ? vixCloses[vixCloses.length - 1] : null;
  const dVix5d = pctChange(vixCloses, 5);
  const usdKrw = fxCloses.length ? fxCloses[fxCloses.length - 1] : null;
  const dFx5d = pctChange(fxCloses, 5);
  const dKospi = drawdownFromHigh(ksCloses);
  const dSpy = drawdownFromHigh(spyCloses);
  const krUsDdGap =
    dKospi != null && dSpy != null ? dKospi - dSpy : null;

  const C_vix = (vix != null && vix >= 25) || (dVix5d != null && dVix5d >= 0.3) ? 1 : 0;
  const C_fx = dFx5d != null && dFx5d >= 0.02 ? 1 : 0;
  const C_kr = krUsDdGap != null && krUsDdGap >= 0.05 ? 1 : 0;

  const asOf =
    vixRows[vixRows.length - 1]?.date ||
    ksRows[ksRows.length - 1]?.date ||
    new Date().toISOString().slice(0, 10);

  const data = {
    asOf,
    vix,
    dVix5d,
    dFx5d,
    usdKrw,
    dKospi,
    dSpy,
    krUsDdGap,
    bits: { C_vix, C_fx, C_kr },
    kospi: ksRows,
    paperLive: false,
    source: 'yahoo',
  };

  cache = { at: now, data };
  return { ...data, cached: false };
}

/** Merge macro into score input only where caller omitted fields. */
function applyMacroToScoreInput(input = {}, macro = null) {
  if (!macro) return { ...input };
  const out = { ...input };
  if (out.vix == null && macro.vix != null) out.vix = macro.vix;
  if (out.dVix5d == null && macro.dVix5d != null) out.dVix5d = macro.dVix5d;
  if (out.dFx5d == null && macro.dFx5d != null) out.dFx5d = macro.dFx5d;
  if (out.krUsDdGap == null && macro.krUsDdGap != null) out.krUsDdGap = macro.krUsDdGap;
  return out;
}

function clearMosMacroCache() {
  cache = { at: 0, data: null };
}

module.exports = {
  getMosMacroSnapshot,
  applyMacroToScoreInput,
  rho60VsIndex,
  clearMosMacroCache,
  drawdownFromHigh,
  pctChange,
  pearson,
};
