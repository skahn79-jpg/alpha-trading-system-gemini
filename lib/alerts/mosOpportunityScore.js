'use strict';

const { V11, PAPER_LIVE, resolveDeltaStar, resolveSigmaV, clip } = require('./mosConfig');
const { applyResearchOverlays } = require('./mosResearchBits');
const { evaluateSessionGate, evaluateSpikeGate } = require('./mosSessionSpikeGates');

function sumPresentBits(bits) {
  let sum = 0;
  for (const v of Object.values(bits)) {
    if (v === null || v === undefined) continue;
    sum += v ? 1 : 0;
  }
  return sum;
}

function onlyWeakPair(bits) {
  const present = Object.entries(bits).filter(([, v]) => v !== null && v !== undefined);
  if (present.length !== 2) return false;
  const keys = present.map(([k]) => k).sort();
  return keys[0] === 'C_dd' && keys[1] === 'C_mom' && present.every(([, v]) => v === 1);
}

function scoreMosOpportunity(input = {}) {
  const cfg = V11;
  const ticker = input.ticker || '';
  const market =
    input.market ||
    (ticker.includes('.KS') || String(input.sectorId || '').startsWith('KR_') ? 'KR' : 'US');
  const sectorId = input.sectorId || 'UNKNOWN';
  const deltaStar = resolveDeltaStar(sectorId);
  const sigmaV = input.sigmaV != null ? input.sigmaV : resolveSigmaV(sectorId);
  const d = input.d;

  const base = {
    ticker,
    sectorId,
    market,
    version: cfg.version,
    paperLive: PAPER_LIVE,
    sleeveHint: 'BH70/MOS30',
    deltaStar,
    sigmaV,
  };

  if (deltaStar == null) {
    return {
      ...base,
      d,
      Enter: false,
      blocked: true,
      blockReasons: ['SECTOR_NO_AUTO_ENTER'],
    };
  }
  if (d == null || Number.isNaN(Number(d))) {
    return { ...base, Enter: false, blocked: true, blockReasons: ['MISSING_D'] };
  }
  if (input.secularImpairment) {
    return {
      ...base,
      d,
      Enter: false,
      Q: 0,
      blocked: true,
      blockReasons: ['SECULAR_IMPAIRMENT'],
    };
  }

  const C_dd = d >= deltaStar ? 1 : 0;
  const C_mom = input.r20 != null ? (input.r20 <= -0.05 ? 1 : 0) : null;
  const C_vix =
    input.vix != null || input.dVix5d != null
      ? (input.vix != null && input.vix >= 25) || (input.dVix5d != null && input.dVix5d >= 0.3)
        ? 1
        : 0
      : null;
  const C_fx =
    market === 'KR' ? (input.dFx5d != null ? (input.dFx5d >= 0.02 ? 1 : 0) : null) : null;
  const C_corr = input.rho60 == null ? null : input.rho60 >= 0.75 ? 1 : 0;
  const C_kr =
    market === 'KR'
      ? input.krUsDdGap != null
        ? input.krUsDdGap >= 0.05
          ? 1
          : 0
        : null
      : null;
  const C_news = input.C_news != null ? (input.C_news ? 1 : 0) : null;
  const C_trade = input.C_trade != null ? (input.C_trade ? 1 : 0) : null;

  const bits = { C_dd, C_mom, C_vix, C_fx, C_corr, C_kr, C_news, C_trade };
  const S_F_mkt = sumPresentBits(bits);
  const minSF = market === 'KR' ? cfg.krMinSF : cfg.sfMinDefault;

  let F_mkt = C_dd === 1 && S_F_mkt >= minSF ? 1 : 0;
  if (onlyWeakPair(bits) && S_F_mkt < cfg.weakRequireSF) F_mkt = 0;

  let Q = input.Q != null ? (input.Q ? 1 : 0) : 1;
  const C_firm_ext = input.C_firm_ext ? 1 : 0;
  const F_i = F_mkt === 1 || (C_firm_ext === 1 && d >= deltaStar) ? 1 : 0;
  let Enter = Q === 1 && F_i === 1 && d >= deltaStar;

  let f0 = clip((deltaStar - cfg.epsilon) / (2 * sigmaV * sigmaV), 0, cfg.fMax);
  f0 *= clip(0.8 + (0.8 * (d - deltaStar)) / 0.25, 0.8, 1.4);
  f0 = Math.min(f0, cfg.fMax);
  let f = Math.min(cfg.fMax, f0 * (0.75 + 0.15 * S_F_mkt) * (1 + 0.1 * C_firm_ext));

  const psy = input.psychology || {};
  const psyReasons = [];
  let severity = S_F_mkt === 2 ? 'weak' : S_F_mkt >= 5 ? 'strong' : 'normal';
  let needsReconfirm = false;

  if (psy.fearGreed != null && psy.fearGreed >= cfg.psychology.fomoFg && F_mkt === 0) {
    Enter = false;
    psyReasons.push('PSY_FOMO');
  }
  if (psy.bounceFrom5dLow != null && psy.bounceFrom5dLow > cfg.psychology.chaseBounce) {
    f *= 0.5;
    needsReconfirm = true;
    psyReasons.push('PSY_CHASE');
  }
  if (psy.lossStreak != null && psy.lossStreak >= cfg.psychology.streakN) {
    f *= 0.5;
    psyReasons.push('PSY_STREAK');
  }
  if (psy.coolDownActive) {
    Enter = false;
    psyReasons.push('PSY_QCOOL');
  }
  if (psy.entersToday != null && psy.entersToday >= cfg.psychology.dailyEnterCap) {
    Enter = false;
    psyReasons.push('PSY_FATIGUE');
  }

  const researchIn = {
    ...(input.research || {}),
    C_news,
    market,
    fact: input.fact || (input.research && input.research.fact),
  };
  const overlay = applyResearchOverlays(
    { Enter, f, fMax: cfg.fMax, psychology: { severity } },
    researchIn
  );
  Enter = overlay.Enter;
  f = overlay.f;
  severity = overlay.severity;

  const session = evaluateSessionGate({
    market,
    now: input.now,
    sessionOverride: input.sessionOverride || (input.session && input.session.override),
  });
  const spike = evaluateSpikeGate({
    side: 'enter',
    session: session.session,
    ...(input.spike || {}),
  });

  const blockReasons = [...(overlay.blocks || [])];
  if (!session.autoEnterOk) blockReasons.push('SESSION_NO_AUTO_ENTER');
  if (spike.abortEnter) {
    Enter = false;
    blockReasons.push(...spike.reasons);
  }
  if (spike.needsReconfirm) needsReconfirm = true;

  return {
    ...base,
    d,
    bits,
    S_F_mkt,
    minSF,
    F_mkt,
    Q,
    C_firm_ext,
    F_i,
    Enter,
    wouldAlertEnter: Enter,
    wouldExecEnter: false,
    paperLive: PAPER_LIVE,
    f_raw: f0,
    f,
    psychology: {
      reasons: psyReasons,
      severity,
      needsReconfirm: needsReconfirm || spike.needsReconfirm,
    },
    research: {
      bits: overlay.researchBits,
      notes: overlay.notes,
      fact: overlay.fact,
    },
    session,
    spike,
    blockReasons,
  };
}

module.exports = { scoreMosOpportunity, sumPresentBits, onlyWeakPair };
