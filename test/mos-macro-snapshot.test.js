'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  drawdownFromHigh,
  pctChange,
  pearson,
  applyMacroToScoreInput,
  rho60VsIndex,
  PAPER_LIVE,
} = require('../lib/alerts');

describe('MOS macro snapshot helpers', () => {
  it('keeps Paper/Live false', () => {
    assert.equal(PAPER_LIVE, false);
  });

  it('computes drawdown and 5d pct', () => {
    assert.equal(drawdownFromHigh([100, 120, 90]), 0.25);
    assert.ok(Math.abs(pctChange([100, 101, 102, 103, 104, 110], 5) - 0.1) < 1e-9);
  });

  it('applyMacroToScoreInput fills only missing fields', () => {
    const macro = { vix: 30, dVix5d: 0.4, dFx5d: 0.03, krUsDdGap: 0.1 };
    const filled = applyMacroToScoreInput({ vix: 12, d: 0.4 }, macro);
    assert.equal(filled.vix, 12);
    assert.equal(filled.dVix5d, 0.4);
    assert.equal(filled.dFx5d, 0.03);
    assert.equal(filled.krUsDdGap, 0.1);
  });

  it('rho60VsIndex returns null on short series', () => {
    assert.equal(rho60VsIndex([{ date: '2026-01-01', close: 1 }], [{ date: '2026-01-01', close: 1 }]), null);
  });

  it('pearson of identical series ~ 1', () => {
    const xs = [0.01, -0.02, 0.03, -0.01, 0.02, 0.0, -0.03, 0.01, 0.02, -0.02,
      0.01, -0.01, 0.02, 0.0, -0.02, 0.03, -0.01, 0.01, 0.02, -0.03, 0.01];
    const r = pearson(xs, xs);
    assert.ok(r != null && r > 0.999);
  });
});
