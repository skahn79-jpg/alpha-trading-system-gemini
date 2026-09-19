'use strict';

const { RESEARCH, clip } = require('./mosConfig');

function bitRates(input = {}) {
  if (input.dgs10Change5d == null && input.dgs10Change5dBp == null) return null;
  const bp =
    input.dgs10Change5dBp != null
      ? input.dgs10Change5dBp
      : Number(input.dgs10Change5d) * 10000;
  return bp >= RESEARCH.rates.dgs10_5d_bp ? 1 : 0;
}

function bitCredit(input = {}) {
  if (input.hygMinusLqd5d == null) return null;
  return input.hygMinusLqd5d <= RESEARCH.credit.hygMinusLqd_5d ? 1 : 0;
}

function evaluateFactCheck(input = {}) {
  const reasons = [];
  let score = input.factScore;
  if (score == null) {
    const tier = input.sourceTier;
    const tierScore =
      tier === 'A' ? 1
        : tier === 'B' ? 0.85
          : tier === 'C' ? 0.65
            : tier === 'D' ? 0.45
              : tier === 'E' ? 0.25
                : tier === 'F' ? 0.1
                  : null;
    if (tierScore == null && input.claimClass == null) {
      return { factScore: null, allowCNews: false, claimClass: 'unknown', reasons: ['no_fact_inputs'] };
    }
    const corr = input.corroborationCount != null ? clip(input.corroborationCount / 3, 0, 1) : 0.3;
    const primary = input.hasPrimaryDoc ? 0.15 : 0;
    const ageH = input.ageHours != null ? input.ageHours : 0;
    const fresh = ageH <= RESEARCH.factScore.maxAgeHours ? 0.1 : -0.2;
    const retract = input.retracted ? -0.5 : 0;
    const singlePartisan = input.singlePartisan ? -0.2 : 0;
    score = clip((tierScore ?? 0.5) * 0.5 + corr * 0.25 + primary + fresh + retract + singlePartisan, 0, 1);
  }
  const claimClass =
    input.claimClass ||
    (score >= RESEARCH.factScore.thetaEnter
      ? 'verified_fact'
      : score >= RESEARCH.factScore.thetaUi
        ? 'contested'
        : 'rumor');
  const allowCNews =
    score >= RESEARCH.factScore.thetaEnter &&
    claimClass === 'verified_fact' &&
    (input.ageHours == null || input.ageHours <= RESEARCH.factScore.maxAgeHours) &&
    !input.blockedByPsychologyRumor;
  if (!allowCNews) reasons.push('FACT_GATE_BLOCK');
  if (input.blockedByPsychologyRumor) reasons.push('PSY_RUMOR');
  return { factScore: score, allowCNews, claimClass, reasons };
}

function bitEarnMiss(input = {}) {
  if (input.earningsMiss == null) return null;
  return input.earningsMiss ? 1 : 0;
}

function bitEarnRev(input = {}) {
  if (input.consensusRevisionPct == null) return null;
  return input.consensusRevisionPct <= -0.05 ? 1 : 0;
}

function bitFlowOut(input = {}) {
  if (input.ewyMinusKs11_20d == null && input.foreignNetSellDays == null) return null;
  if (input.foreignNetSellDays != null) return input.foreignNetSellDays >= 5 ? 1 : 0;
  return input.ewyMinusKs11_20d <= RESEARCH.flow.ewyMinusKs11_20d ? 1 : 0;
}

function bitLiqDry(input = {}) {
  const { minAdvUsdUS, minAdvUsdKRLarge, minAdvUsdKRMid, volDryRatio } = RESEARCH.liq;
  const market = input.market || 'US';
  const size = input.sizeClass || 'large';
  const minAdv =
    market === 'KR' ? (size === 'mid' ? minAdvUsdKRMid : minAdvUsdKRLarge) : minAdvUsdUS;
  const reasons = [];
  let dry = 0;
  if (input.advUsd != null && input.advUsd < minAdv) {
    dry = 1;
    reasons.push('ADV_BELOW_MIN');
  }
  if (input.vol5Over60 != null && input.vol5Over60 < volDryRatio) {
    dry = 1;
    reasons.push('VOL_DRY');
  }
  if (input.advUsd == null && input.vol5Over60 == null) {
    return { bit: null, reasons: ['no_liq_inputs'], minAdv };
  }
  return { bit: dry, reasons, minAdv };
}

function bitLevRebal(input = {}) {
  const r = RESEARCH.lev;
  if (input.indexAbsRet == null || input.levEtfVolZ == null) return null;
  return input.indexAbsRet >= r.indexAbsRet && input.levEtfVolZ >= r.levVolZ ? 1 : 0;
}

function bitSslLev(input = {}) {
  const r = RESEARCH.lev;
  if (input.sslAdvShare == null) return null;
  if (input.sslAdvShare >= r.sslAdvShare) return 1;
  if (
    input.sslAdvShare >= r.sslAdvShareSoft &&
    input.levEtfVolZ != null &&
    input.levEtfVolZ >= r.levVolZ
  ) {
    return 1;
  }
  return 0;
}

function applyResearchOverlays(core, input = {}) {
  const notes = [];
  const blocks = [];
  let f = core.f;
  let enter = core.Enter;
  let severity = (core.psychology && core.psychology.severity) || 'normal';

  const C_rates = bitRates(input);
  const C_credit = bitCredit(input);
  const fact = evaluateFactCheck(input.fact || {});
  let C_news = input.C_news;
  const hasFact =
    input.fact &&
    (input.fact.factScore != null ||
      input.fact.sourceTier ||
      input.fact.claimClass ||
      input.fact.corroborationCount != null);
  if (hasFact) {
    if (!fact.allowCNews) {
      C_news = 0;
      notes.push('C_news_blocked_by_FactScore');
    } else if (C_news == null) {
      C_news = 1;
    }
  }

  const C_earn_miss = bitEarnMiss(input);
  const C_earn_rev = bitEarnRev(input);
  const C_flow_out = bitFlowOut(input);
  const liq = bitLiqDry(input);
  const C_liq_dry = liq.bit;
  const C_lev_rebal = bitLevRebal(input);
  const C_ssl_lev = bitSslLev(input);

  if (C_earn_miss === 1 && RESEARCH.earn.missHalfSize) {
    f *= 0.5;
    notes.push('C_earn_miss_half');
    if (severity === 'strong') severity = 'normal';
    else if (severity === 'normal') severity = 'weak';
  }
  if (input.consecutiveMisses != null && input.consecutiveMisses >= 2) {
    enter = false;
    blocks.push('Q_earn');
    notes.push('consecutive_earnings_miss_Q');
  }
  if (C_flow_out === 1) {
    f *= 0.75;
    notes.push('C_flow_out_size_cut');
  }
  if (C_liq_dry === 1) {
    enter = false;
    blocks.push('C_liq_dry');
    notes.push(...(liq.reasons || []));
  }
  if (C_lev_rebal === 1) {
    if (
      input.minutesToClose != null &&
      input.minutesToClose <= RESEARCH.lev.blockMinutesBeforeClose
    ) {
      enter = false;
      blocks.push('C_lev_rebal_close');
    } else {
      f *= 0.5;
      notes.push('C_lev_rebal_half');
    }
  }
  if (C_ssl_lev === 1) notes.push('C_ssl_lev_widen_spike_guards');

  return {
    f: clip(f, 0, core.fMax != null ? core.fMax : 0.12),
    Enter: enter,
    severity,
    blocks,
    notes,
    researchBits: {
      C_rates,
      C_credit,
      C_news_fact_gated: C_news,
      C_earn_miss,
      C_earn_rev,
      C_flow_out,
      C_liq_dry,
      C_lev_rebal,
      C_ssl_lev,
    },
    fact,
  };
}

module.exports = {
  bitRates,
  bitCredit,
  evaluateFactCheck,
  bitEarnMiss,
  bitEarnRev,
  bitFlowOut,
  bitLiqDry,
  bitLevRebal,
  bitSslLev,
  applyResearchOverlays,
};
