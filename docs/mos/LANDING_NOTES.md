# MOS A′ v1.1 balanced + research landing

**Date:** 2026-09-19 · **Branch:** `feat/mos-a-prime-v1.1-balanced`  
**Paper/Live:** FALSE · alerts/scoring only · no real orders

## Code
- `lib/alerts/mosConfig.js` — locked δ*/σ_V + research thresholds
- `lib/alerts/mosOpportunityScore.js` — core Enter/f + psychology
- `lib/alerts/mosResearchBits.js` — C_rates, C_credit, FactScore→C_news, C_earn_*, C_flow_out, C_liq_dry, C_lev_rebal, C_ssl_lev
- `lib/alerts/mosSessionSpikeGates.js` — KR RTH / KRX after 16–20 / NXT pre·after; US RTH/ext; spike chase/gap/halt
- `lib/alerts/index.js`
- `test/mos-opportunity-score.test.js` (11 pass)

## Research docs copied under `docs/mos/`
Formula prime, rates/bonds/news corr, factcheck, earnings/flows/liq, leveraged ETF, execution hours.

## Not done here
- Dashboard/UI wire · live feed adapters · commit/push (ask first) · R31 schema mix · Live enable
