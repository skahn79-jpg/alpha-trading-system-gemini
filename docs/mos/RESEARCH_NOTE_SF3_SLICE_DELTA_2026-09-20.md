# Research note — SF≥3 macros, slice-band H1, δ* sector stress

**Date:** 2026-09-20 KST · **Paper/Live:** FALSE · **Orders:** none  
**Artifact:** `docs/mos/RESEARCH_SF3_SLICE_DELTA_2026-09-20.json`

## 1) SF≥3 macro fill (priority #2)

Universe: prior Shorts −30%+sideways **24 hits**.

| Mode | Enter |
|------|-------|
| Thin (d + r20 only) | **0 / 24** |
| + macros (vix, dFx5d, krUsDdGap, ρ60) | **20 / 24** |

Macro as-of 2026-09-18:
- VIX ≈ 14.8 → **C_vix = 0**
- USD/KRW 5d ≈ +3.0% → **C_fx = 1**
- KOSPI dd − SPY dd ≈ +24pp → **C_kr = 1**

Still blocked (4): **KR_RETAIL** (`SECTOR_NO_AUTO_ENTER`, δ*=null) — 경방·이마트·호텔신라·광주신세계.

**Implication:** Enter=0 was mostly **missing macro inputs**, not “no opportunity”. Board/score paths must feed FX·KR gap·(optional VIX)·ρ or SF stays capped at 1–2.

## 2) Slice-band H1 (priority #1, Tier B proxy)

Rule: 5d band ≤4%, ≥3 up-closes, ADV5/ADV60 ≥ 1.2. No institutional tape (Tier A not available).

Non-overlap forward returns (~150 KOSPI names, ~2y):

| Horizon | n | mean | median | win |
|---------|---|------|--------|-----|
| +5d | 137 | +0.73% | +0.64% | 59% |
| +10d | 119 | +1.36% | +0.56% | 55% |
| +20d | 95 | **+3.01%** | +1.87% | **60%** |

**Decision:** keep **PARKED** as `ALERT_SLICE_BAND` only — mild edge, not Enter-bit material. Tier A (investor flow) still required before any promotion talk.

## 3) δ* sector stress (priority #3)

On macro-filled hits:
- **KR_AUTO_BATT** 8/8 Enter (mean d≈41%) — rule floods autos in this regime
- **KR_CHEM / SEMIS_IT / FIN** Enter when SF≥3
- **KR_RETAIL** 0/4 by design

What-if retail δ*=0.30 (chem proxy): all 4 would Enter with SF≥3.  
**Do not unlock retail** without explicit product lock — null is doing its job.

## Next engineering (still research→alert, no Live)
1. Wire macro snapshot into `/api/alerts/mos/board` + score inputs  
2. Log `ALERT_SLICE_BAND` candidates when Tier B fires (no Enter)  
3. Optional: tighten AUTO_BATT δ* or require extra bit — product decision
