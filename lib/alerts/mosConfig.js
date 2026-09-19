'use strict';

/** MOS A′ v1.1 balanced LOCKED + research thresholds. Paper/Live = false. */

const PAPER_LIVE = false;

const V11 = Object.freeze({
  version: 'A_prime_v1.1_balanced',
  lockedAt: '2026-09-19',
  paperLive: PAPER_LIVE,
  deltaStarDefault: 0.25,
  deltaStarBySector: Object.freeze({
    US_FOOD_BEV: 0.2,
    US_STAPLES: 0.2,
    US_HEALTHCARE: 0.2,
    US_SEMIS: 0.3,
    US_TECH_HIGHVOL: 0.3,
    US_FINANCIALS: 0.25,
    US_ENERGY: 0.25,
    KR_FOOD_BEV: 0.3,
    KR_SEMIS_IT: 0.3,
    KR_CHEM: 0.3,
    KR_AUTO_BATT: 0.3,
    KR_FINANCIALS: 0.3,
    KR_RETAIL: null,
  }),
  sigmaVBySector: Object.freeze({
    US_FOOD_BEV: 0.22,
    US_STAPLES: 0.2,
    US_SEMIS: 0.4,
    KR_FOOD_BEV: 0.3,
    KR_SEMIS_IT: 0.4,
    KR_AUTO_BATT: 0.45,
  }),
  sigmaVDefault: 0.25,
  epsilon: 0.1,
  fMax: 0.12,
  krMinSF: 3,
  weakRequireSF: 3,
  sfMinDefault: 2,
  psychology: Object.freeze({
    fomoFg: 75,
    chaseBounce: 0.08,
    streakN: 3,
    coolDownDays: 10,
    dailyEnterCap: 3,
  }),
});

const RESEARCH = Object.freeze({
  rates: Object.freeze({ dgs10_5d_bp: 15 }),
  credit: Object.freeze({ hygMinusLqd_5d: -0.01 }),
  factScore: Object.freeze({ thetaEnter: 0.65, thetaUi: 0.4, maxAgeHours: 72 }),
  earn: Object.freeze({ missHalfSize: true }),
  flow: Object.freeze({ ewyMinusKs11_20d: -0.035 }),
  liq: Object.freeze({
    minAdvUsdUS: 50e6,
    minAdvUsdKRLarge: 20e6,
    minAdvUsdKRMid: 5e6,
    volDryRatio: 0.5,
  }),
  lev: Object.freeze({
    indexAbsRet: 0.015,
    levVolZ: 2,
    sslAdvShare: 0.03,
    sslAdvShareSoft: 0.015,
    blockMinutesBeforeClose: 30,
  }),
  session: Object.freeze({
    autoEnterExtended: false,
    krxRegular: Object.freeze({ start: '09:00', end: '15:30' }),
    krxAfter: Object.freeze({ start: '16:00', end: '20:00' }),
    nxtPre: Object.freeze({ start: '08:00', end: '08:50' }),
    nxtAfter: Object.freeze({ start: '15:40', end: '20:00' }),
    usRth: Object.freeze({ start: '09:30', end: '16:00' }),
    us23_5_enabled: false,
    us23_5_effective: '2026-12-06',
  }),
  spike: Object.freeze({
    chasePctPerMin: 0.02,
    chasePctSinceSignal: 0.03,
    gapOpenPct: 0.02,
    crashExitPctPer5m: 0.03,
    rearmMinutes: 15,
    maxSlippageBpsRth: 15,
    maxSlippageBpsExtended: 40,
  }),
});

function clip(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

function resolveDeltaStar(sectorId) {
  if (Object.prototype.hasOwnProperty.call(V11.deltaStarBySector, sectorId)) {
    return V11.deltaStarBySector[sectorId];
  }
  return V11.deltaStarDefault;
}

function resolveSigmaV(sectorId) {
  if (Object.prototype.hasOwnProperty.call(V11.sigmaVBySector, sectorId)) {
    return V11.sigmaVBySector[sectorId];
  }
  return V11.sigmaVDefault;
}

module.exports = {
  PAPER_LIVE,
  V11,
  RESEARCH,
  clip,
  resolveDeltaStar,
  resolveSigmaV,
};
