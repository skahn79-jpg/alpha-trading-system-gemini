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

## 2026-09-20 addendum — slice-band alert (research)
- Spec only: `docs/mos/INSTITUTIONAL_SLICE_ACCUMULATION.md`
- Flag id `ALERT_SLICE_BAND` / bit `C_slice_band` — **not** wired to Enter
- Origin: Shorts OO5hq0f4Sho claim dissected; follow-the-slice ≠ easy money
- Paper/Live remain FALSE

## 2026-09-20 — SF3 / slice / δ* research batch
- Note: `docs/mos/RESEARCH_NOTE_SF3_SLICE_DELTA_2026-09-20.md`
- JSON: `docs/mos/RESEARCH_SF3_SLICE_DELTA_2026-09-20.json`
- Macro fill: Enter 0→20/24 on Shorts hits; retail still blocked
- Slice TierB +20d ~+3%/win60% → remain PARKED alert-only
- AUTO_BATT dominates; retail δ* null kept

## 2026-09-20 — macro snapshot wired (alerts only)
- `lib/alerts/mosMacroSnapshot.js` — Yahoo VIX / KRW=X / KS11 / SPY → C_vix,C_fx,C_kr (+ ρ60 on board)
- `GET /api/alerts/mos/macro`, board+score auto-fill missing macro fields
- Paper/Live remain FALSE; no orders
