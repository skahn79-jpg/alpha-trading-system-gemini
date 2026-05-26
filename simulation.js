/**
 * ALPHA TRADING SYSTEM - signal simulation scoring module
 */
function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function judgeSignal(signal, candles = []) {
  if (!signal || signal.status === 'win' || signal.status === 'loss' || signal.status === 'expired') return signal;
  const horizon = Math.max(1, toNumber(signal.horizon, 5));
  const createdAt = signal.createdAt ? new Date(signal.createdAt) : new Date();
  const matureAt = new Date(createdAt.getTime() + horizon * 24 * 60 * 60 * 1000);
  if (new Date() < matureAt && candles.length === 0) return { ...signal, status: 'pending' };

  const entry = toNumber(signal.entryPrice || signal.entry, 0);
  const direction = String(signal.direction || 'BUY').toUpperCase();
  if (!entry) return { ...signal, status: 'expired', pnlPct: 0, judgedAt: new Date().toISOString() };

  const relevant = candles.slice(-horizon);
  const last = relevant[relevant.length - 1] || candles[candles.length - 1];
  if (!last) return { ...signal, status: 'pending' };

  const finalPrice = toNumber(last.close || last.price, entry);
  const rawPnl = ((finalPrice - entry) / entry) * 100;
  const pnlPct = direction === 'SELL' ? -rawPnl : rawPnl;
  const status = pnlPct >= 0 ? 'win' : 'loss';
  return { ...signal, finalPrice, pnlPct: Number(pnlPct.toFixed(2)), status, judgedAt: new Date().toISOString() };
}

function judgeBatch(signals = [], candlesByCode = new Map()) {
  return signals.map(s => judgeSignal(s, candlesByCode.get(s.code) || []));
}

function computeStats(signals = []) {
  const resolved = signals.filter(s => s.status === 'win' || s.status === 'loss');
  const wins = resolved.filter(s => s.status === 'win').length;
  const losses = resolved.filter(s => s.status === 'loss').length;
  const avgPnl = resolved.length ? resolved.reduce((a, s) => a + toNumber(s.pnlPct), 0) / resolved.length : 0;

  const byFeature = {};
  for (const s of resolved) {
    const features = Array.isArray(s.features) ? s.features : [];
    for (const f of features) {
      byFeature[f] ||= { total: 0, win: 0, pnl: 0 };
      byFeature[f].total += 1;
      byFeature[f].win += s.status === 'win' ? 1 : 0;
      byFeature[f].pnl += toNumber(s.pnlPct);
    }
  }
  for (const f of Object.keys(byFeature)) {
    const v = byFeature[f];
    v.winRate = v.total ? Math.round((v.win / v.total) * 100) : 0;
    v.avgPnl = v.total ? Number((v.pnl / v.total).toFixed(2)) : 0;
  }

  return {
    overall: {
      total: signals.length,
      resolved: resolved.length,
      pending: signals.length - resolved.length,
      wins,
      losses,
      winRate: resolved.length ? Math.round((wins / resolved.length) * 100) : 0,
      avgPnl: Number(avgPnl.toFixed(2)),
    },
    byFeature,
  };
}

function computeWeights(stats = {}) {
  const weights = {};
  const byFeature = stats.byFeature || {};
  for (const [feature, v] of Object.entries(byFeature)) {
    const wr = toNumber(v.winRate, 50);
    const avg = toNumber(v.avgPnl, 0);
    weights[feature] = Number(Math.max(0.5, Math.min(1.5, 1 + (wr - 50) / 100 + avg / 50)).toFixed(2));
  }
  return weights;
}

function scoreSignal(features = [], weights = {}) {
  const base = 50;
  const featureList = Array.isArray(features) ? features : [];
  const breakdown = featureList.map(f => ({ feature: f, weight: toNumber(weights[f], 1), points: 5 * toNumber(weights[f], 1) }));
  const score = Math.max(0, Math.min(100, Math.round(base + breakdown.reduce((a, b) => a + b.points, 0))));
  return { score, confidence: score >= 75 ? 'high' : score >= 60 ? 'medium' : 'low', breakdown };
}

module.exports = { judgeBatch, computeStats, computeWeights, scoreSignal };
