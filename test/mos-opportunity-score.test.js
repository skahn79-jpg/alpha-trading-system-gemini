'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  scoreMosOpportunity,
  V11,
  PAPER_LIVE,
  resolveDeltaStar,
  evaluateFactCheck,
  evaluateSessionGate,
  evaluateSpikeGate,
} = require(path.join(__dirname, '../lib/alerts'));

describe('MOS A′ v1.1 balanced + research', () => {
  it('keeps Paper/Live false', () => {
    assert.equal(PAPER_LIVE, false);
    assert.equal(V11.paperLive, false);
  });

  it('uses sector δ* map', () => {
    assert.equal(resolveDeltaStar('US_FOOD_BEV'), 0.2);
    assert.equal(resolveDeltaStar('KR_FOOD_BEV'), 0.3);
    assert.equal(resolveDeltaStar('KR_RETAIL'), null);
  });

  it('blocks KR_RETAIL auto enter', () => {
    const r = scoreMosOpportunity({
      ticker: '023530.KS',
      sectorId: 'KR_RETAIL',
      d: 0.4,
      sessionOverride: 'regular',
    });
    assert.equal(r.Enter, false);
    assert.ok((r.blockReasons || []).includes('SECTOR_NO_AUTO_ENTER'));
  });

  it('requires S_F≥3 for KR', () => {
    const weak = scoreMosOpportunity({
      ticker: '005930.KS',
      sectorId: 'KR_SEMIS_IT',
      market: 'KR',
      d: 0.35,
      r20: -0.06,
      sessionOverride: 'regular',
    });
    assert.equal(weak.S_F_mkt, 2);
    assert.equal(weak.F_mkt, 0);
    assert.equal(weak.Enter, false);

    const ok = scoreMosOpportunity({
      ticker: '005930.KS',
      sectorId: 'KR_SEMIS_IT',
      market: 'KR',
      d: 0.35,
      r20: -0.06,
      vix: 28,
      C_news: 1,
      sessionOverride: 'regular',
    });
    assert.ok(ok.S_F_mkt >= 3);
    assert.equal(ok.F_mkt, 1);
    assert.equal(ok.Enter, true);
  });

  it('applies FOMO psychology block', () => {
    const r = scoreMosOpportunity({
      ticker: 'MSFT',
      sectorId: 'US_TECH_HIGHVOL',
      d: 0.1,
      psychology: { fearGreed: 80 },
      sessionOverride: 'regular',
    });
    assert.equal(r.Enter, false);
    assert.ok(r.psychology.reasons.includes('PSY_FOMO'));
  });

  it('gates C_news via FactScore', () => {
    const bad = evaluateFactCheck({
      sourceTier: 'E',
      corroborationCount: 0,
      claimClass: 'rumor',
      ageHours: 2,
    });
    assert.equal(bad.allowCNews, false);

    const good = evaluateFactCheck({
      sourceTier: 'A',
      corroborationCount: 3,
      hasPrimaryDoc: true,
      ageHours: 3,
    });
    assert.equal(good.allowCNews, true);
  });

  it('blocks enter near close on lev rebalance day', () => {
    const r = scoreMosOpportunity({
      ticker: 'NVDA',
      sectorId: 'US_SEMIS',
      d: 0.35,
      r20: -0.08,
      vix: 30,
      research: { indexAbsRet: 0.02, levEtfVolZ: 2.5, minutesToClose: 10 },
      sessionOverride: 'regular',
    });
    assert.equal(r.research.bits.C_lev_rebal, 1);
    assert.equal(r.Enter, false);
    assert.ok(r.blockReasons.includes('C_lev_rebal_close'));
  });

  it('halves size on earnings miss', () => {
    const base = scoreMosOpportunity({
      ticker: 'AAPL',
      sectorId: 'US_TECH_HIGHVOL',
      d: 0.35,
      r20: -0.08,
      vix: 30,
      sessionOverride: 'regular',
    });
    const miss = scoreMosOpportunity({
      ticker: 'AAPL',
      sectorId: 'US_TECH_HIGHVOL',
      d: 0.35,
      r20: -0.08,
      vix: 30,
      research: { earningsMiss: true },
      sessionOverride: 'regular',
    });
    assert.equal(miss.Enter, true);
    assert.ok(miss.f < base.f - 1e-9);
    assert.ok(miss.research.notes.includes('C_earn_miss_half'));
  });

  it('session: extended denies auto enter by default', () => {
    const s = evaluateSessionGate({ market: 'KR', sessionOverride: 'extended' });
    assert.equal(s.autoEnterOk, false);
    assert.equal(s.alertOk, true);
  });

  it('spike chase aborts enter', () => {
    const g = evaluateSpikeGate({ side: 'enter', ret1m: 0.025, session: 'regular' });
    assert.equal(g.abortEnter, true);
  });

  it('never sets wouldExecEnter true while paperLive false', () => {
    const r = scoreMosOpportunity({
      ticker: 'KO',
      sectorId: 'US_FOOD_BEV',
      d: 0.22,
      r20: -0.06,
      vix: 26,
      sessionOverride: 'regular',
    });
    assert.equal(r.deltaStar, 0.2);
    assert.equal(r.wouldExecEnter, false);
    assert.equal(r.paperLive, false);
  });
});
