# Earnings / Flows / Liquidity Gaps — MOS A′ research

**Date:** 2026-09-19 (KST)  
**Scope:** Personal alerts / scoring research only · Paper/Live OFF · **Not trading advice**  
**User:** SK An · Formula A′ **v1.1 balanced δ\*/σ_V table remains LOCKED**  
**Companion:** proposals also appended to `MOS_FORMULA_A_PRIME.md` (appendix only)  
**Artifacts:** `data/earn_flow_liq/` (earnings_events.csv n=913, liquidity_snapshot_v2.csv, ewy_ks11_rel20.csv, …)

---

## 한국어 핵심 요약 (Executive)

1. **실적 미스 + 깊은 MOS(d≥0.25)는 미국 메가캡에서 함정 신호.** US miss∩deepMOS (n=18): hit63 **39%**, trap126 **28%** vs beat∩deepMOS (n=41): hit63 **71%**, med_r63 **+20%**, trap **12%**. → `C_earn_miss` + 반사이즈/`Q_earn=0` 후보 가치 큼.
2. **한국 컨센서스(야후 Surprise%)는 노이즈.** KR miss율 ~51%, 중앙값 surprise **−0.5%**. miss∩deepMOS가 beat보다 hit63은 오히려 높음(62% vs 49%) — **방향 신호로는 약함**. 다만 trap은 miss **21%** vs beat **7%** → **함정 필터**로는 유효. 삼성(005930)·하이닉스(000660) 단독은 표본 작아 결론 제한.
3. **PEAD 문헌과 정렬:** 어닝 서프라이즈 방향으로 수주~수개월 드리프트(Bernard–Thomas 등). FactSet 없이 yfinance `get_earnings_dates`의 Estimate/Reported/Surprise% + 분기 Diluted EPS YoY로 프록시 가능.
4. **수급(Flows):** KRX/네이버 외인·기관·개인 순매수는 **공식 무료 장기 히스토리 없음**(스크랩·유료·키 필요). 박스 프록시 = **EWY−KS11 20일 상대수익** (p10 ≈ **−3.5%**, p05 ≈ **−4.7%**) + EWY 거래량 스파이크. US shortInterest는 yfinance `info` **401 차단** — 갭 명시.
5. **유동성:** 삼성 ADV20 ≈ **$33억**, 하이닉스 ≈ **$43억** vs 오리온/농심 ≈ **$8–10M**, 하이트진로 ≈ **$0.9M**. Amihud(bp per $1M) 메가 ~0.01–0.6 vs KR mid **10–50**. MOS 슬리브 **min ADV 필터** + `C_liq_dry`(5d/60d vol &lt; 0.5) 제안.
6. **v1.2 번들(Mac이 v1.1 balanced 착륙 후):** 먼저 **2–4비트** — `C_earn_miss`(US 우선), min-ADV/`C_liq_dry`, `C_flow_out`(EWY 프록시), (선택) `C_earn_rev` 소프트. **δ\*/σ_V 표는 건드리지 않음.**
7. **알림/스코어링 연구만.** 실주문·Paper/Live ON 금지. 기존 `C_vix`/`C_rates`/`C_news`와 중복 낮게 설계.

---

## English executive bullets

- US mega: earnings **miss at deep MOS** ≈ value-trap filter (trap 28% vs 12% on beat); half-size or block rules proposed.
- KR Yahoo consensus is **noisy** — use miss mainly as **trap caution**, not directional Enter bit; Samsung/Hynix alone underpowered.
- Free proxies: yfinance earnings Surprise%, EPS YoY; EWY−KS11 for foreign-ish flows; ADV$ + Amihud + volume dry-up for liquidity.
- Honest gaps: FactSet revisions, KRX investor-type history, US short interest via yfinance, bid–ask micro spreads.
- Ranked v1.2 after Mac lands v1.1: `C_earn_miss` → `C_liq`/min ADV → `C_flow_out` → soft `C_earn_rev`.

---

## 0. What is already in locked A′ v1.1 (do not change)

Locked checklist today: `C_dd`, `C_mom`, `C_vix`, `C_fx`, `C_corr`, `C_kr`, `C_news`, `C_trade` (+ optional draft `C_rates`/`C_credit` from rates research — also **not locked**).

**Missing price-move factors (this memo):** earnings/consensus revisions, investor flows, liquidity.

**Hard rule:** no edits to locked δ\* by sector / σ_V / ε / f_max / krMinSF table.

---

## A. Earnings / consensus revisions

### A.1 Literature (short)

| Concept | Takeaway for MOS alerts |
|---------|-------------------------|
| **PEAD** (Bernard & Thomas 1989+) | Prices drift in surprise direction for weeks–months; underreaction to autocorrelation of earnings. |
| **SUE** | (Actual − Expected) / σ(forecast error). Analyst-based surprises usually beat seasonal random-walk (Livnat & Mendenhall 2006). |
| **Implication** | After a **miss** into an already deep drawdown, mean-reversion “MOS bargain” is **more likely a value trap** (esp. US). After a **beat** into deep dd, PEAD + MOS can align. |

### A.2 Free data (no FactSet)

| Field | Source | Status on box 2026-09-19 |
|-------|--------|---------------------------|
| Earnings date, EPS Estimate, Reported EPS, **Surprise(%)** | `yfinance.Ticker.get_earnings_dates(limit=…)` | **Works** US mega + KR large (005930.KS, 000660.KS, …) |
| Diluted EPS (quarterly) → **EPS YoY** | `quarterly_income_stmt` | Works; history depth ~5 quarters via this path (thin for multi-year YoY streaks) |
| Analyst revision breadth / NTM EPS Δ | FactSet / Bloomberg / Refinitiv | **Unavailable** — gap |
| `Ticker.info` shortRatio, recommendationMean | Yahoo crumb | **HTTP 401** on box — gap |
| `earnings_history` attribute | yfinance | Empty cols in this env |

**Revision proxy without paid terminal (ordered by honesty):**

1. **Surprise(%)** last print (primary).  
2. **EPS YoY** from Diluted EPS (q / q−4).  
3. **Surprise streak:** last 2 prints both miss → soft `C_earn_rev`.  
4. **Secular tag overlap:** already-locked `secular_impairment` / KHC-like — earnings miss reinforces `Q=0`.

### A.3 Event study design

- Universe: US mega 12 names + KR large 8 (incl. **005930.KS**, **000660.KS**).  
- n=**913** dated earnings with usable forward path (2015→2026-09).  
- Day0 = first session on/after Yahoo earnings timestamp.  
- **deepMOS** = `d = 1 − P/Pmax_3y ≥ 0.25` on day0.  
- Trap = path ≤ −30% within 126d.  
- Bench CAR: SPY (US) / EWY (KR).  
- **Limits:** survivorship; Yahoo KR consensus quality; no overnight exact stamp; small n on miss∩deepMOS US (18).

### A.4 Results (headline)

| Slice | n | med r5 | med r21 | med r63 | hit63 | trap126 |
|-------|--:|-------:|--------:|--------:|------:|--------:|
| US miss | 74 | −0.3% | −0.8% | +1.1% | 54% | 12% |
| US beat | 477 | +0.8% | +1.2% | +4.9% | 67% | 5% |
| **US miss ∩ deepMOS** | **18** | +2.2% | +1.9% | **−2.6%** | **39%** | **28%** |
| **US beat ∩ deepMOS** | **41** | +6.2% | +9.4% | **+19.6%** | **71%** | **12%** |
| KR miss | 185 | 0% | −0.6% | +5.1% | 60% | 13% |
| KR beat | 175 | +0.4% | +0.7% | +1.6% | 53% | 6% |
| KR miss ∩ deepMOS | 82 | −0.6% | +0.2% | +7.2% | 62% | **21%** |
| KR beat ∩ deepMOS | 45 | 0% | −0.5% | −0.4% | 49% | **7%** |

**Ticker spot-checks (small n — suggestive only):**

| Ticker | Note |
|--------|------|
| 005930.KS | miss n=20 med_r63 +2.4% / beat +5.5%; deepMOS n=8 trap 0% in-sample |
| 000660.KS | miss/beat hit63 ~56%; deepMOS n=10 med_r63 +13%, trap 0% |
| NVDA | miss n=3 ugly (trap 67%); beat strong — high-vol semis, align with locked δ\*=0.30 |
| AAPL | almost always beats in sample; miss n=2 only |

**Surprise distribution:**

| Market | miss rate | p10 Surprise% | p05 | median |
|--------|----------:|--------------:|----:|-------:|
| US | 13% | −3.0 | −9.6 | +6.2 |
| KR | **51%** | −65 | −151 | **−0.5** |

→ KR thresholds must be **wider / softer** or treated as trap-only.

**Overlap with MOS calendar:** fraction of all earnings that land on deepMOS day0 ≈ **11% US / 35% KR** — KR names more often “cheap on print.”

### A.5 Proposed bits (NOT LOCKED)

| Bit / rule | Definition (draft) | Effect |
|------------|--------------------|--------|
| **C_earn_miss** | US: Surprise% **&lt; 0** on most recent print with `days_since_earn ∈ [0, 10]`. KR: Surprise% **&lt; −10** (noise haircut) OR skip bit if estimate count unknown. If no fresh print → **skip** (not 0). | Counts toward `S_F^mkt` like other bits **or** (preferred v1.2) **size/gate modifier only** — see below |
| **C_earn_rev** | Soft: (EPS YoY **&lt; −20%**) OR (last **2** surprises both &lt; 0 US / &lt; −10 KR). | UI flag; optional +1 severity; **not** automatic Enter |
| **Q_earn = 0** | (`C_earn_miss` with Surprise **&lt; −10** US / **&lt; −30** KR) **AND** (EPS YoY **&lt; −30%** OR `secular_impairment` tag) **AND** `d ≥ δ*`. | Same as firm Q=0: **block Enter**, hard exit alert |
| **Enter sizing** | If Enter would fire and `C_earn_miss=1` and `Q_earn=1`: **`f ← 0.5·f`** (US default). KR: half-size only if Surprise&lt;−10 **and** trap path flags; else UI caution. | After psychology block |
| **Enter block** | `Q_earn=0` → Enter false. Optional: within **5d** of big miss, require `needsReconfirm=true` even if bounce &lt; PSY_CHASE 8%. | |
| **Freshness** | Surprise window **10 trading days** post-print; then bit expires (PEAD window short for alerts). | |

**Recommended wiring (v1.2 preference):** treat `C_earn_miss` as a **modifier** first (half-size / weak severity), **not** a freeload +1 toward KR `S_F≥3` floor — until paper replay shows it isn’t gaming the floor. If later promoted to checklist bit, document explicitly.

### A.6 Miss vs value-trap after MOS drawdown

- **US:** miss@deepMOS is the clearest **trap discriminator** in this free sample → supports half-size / Q_earn path.  
- **KR large:** miss raises trap rate (21% vs 7%) but **does not** kill forward hit rates → use as **caution**, not directional short thesis.  
- Samsung/Hynix: insufficient miss∩deepMOS cells for lock-level claims; keep name-level overrides **out** of locked table.

---

## B. Flows (foreign / institution / retail / short)

### B.1 KR investor-type flows — honesty

| Source | Reality |
|--------|---------|
| **KRX Data Marketplace** “Trading by Investor” | Official; web/API marketplace; not a clean free historical dump on this box. |
| **Naver Finance** foreigner/institution/individual net buy | Widely used; ~100 session scrape windows via third-party scrapers; **ToS / rate-limit / break risk** — do not claim production-ready. |
| **data.go.kr ETF APIs** | Price/NAV — **not** investor-type stock flows. |
| **EWY creations/redemptions** | True “foreign ETF flow”; needs ETF.com / issuer / Bloomberg — **not** on box. |

**App stance:** ship **proxy bits now**; leave `adapter: krxInvestorFlow` stub for Mac later.

### B.2 Proxies implemented here

| Proxy | Construction | Empirical note |
|-------|--------------|----------------|
| **EWY − KS11 rel20** | `r20(EWY) − r20(^KS11)` | mean ~0; **p10 ≈ −3.5%**, **p05 ≈ −4.7%** (2015–2026) |
| **EWY stress volume** | `r(EWY)&lt;−2%` and volume &gt; 1.5× ADV20 | **63 days** (~2%) — rare “outflow-ish” tape |
| **C_fx overlap** | USD/KRW already in A′ | Foreign selling often co-moves with FX; don’t double-count blindly |

### B.3 US short interest

- yfinance `shortRatio` / `shortPercentOfFloat` / holders tables: **empty or 401** in this environment (2026-09-19).  
- FINRA bi-monthly short interest: not wired.  
- **Proposal when feed exists:** `shortPercentOfFloat ≥ 20%` → **caution** (half-size), not hard block; `≥ 40%` + rising 1m → UI “squeeze/crowding” tag. Until feed live → **skip**.

### B.4 Proposed bits (NOT LOCKED)

| Bit | Trigger (draft) | Effect | Tie-in |
|-----|-----------------|--------|--------|
| **C_flow_out** | KR sleeve: rel20(EWY−KS11) **≤ −3.5%** (alt strict **−4.7%**). Optional OR: EWY day with r≤−2% & vol≥1.5×ADV20 within 5d. US sleeve: skip unless using sector ETF flow later. | Checklist **or** severity+1; helps KR hit `S_F≥3` **only if** user later promotes it — default **modifier**: if Enter, `f←0.75·f` when flow_out | Complements `C_fx`, low mechanical overlap with VIX |
| **C_retail_crowding** | When Naver/KRX adapter live: 5d **individual** net buy &gt; +2σ of 60d **and** price bounce from 5d low &gt; +5%. Proxy until then: KS11 5d &gt; +4% while EWY 5d &lt; 0 (domestic retail vs foreign). | Sets `needsReconfirm` / feeds **PSY_CHASE** | Explicit link to psychology |
| **short_caution** | US: short% float ≥20% (feed-dependent) | `f←0.5·f`; never alone blocks Enter | |

**PSY_CHASE extension (proposal):** if `C_retail_crowding` or `C_flow_out` while bounce &gt; +5% (loosen from 8%), apply chase rule earlier for KR names.

---

## C. Liquidity (ADV$, Amihud, dry-up)

### C.1 Measures

| Measure | Formula | Why |
|---------|---------|-----|
| **ADV20$** | mean(Close×Volume, 20); KR ÷ USDKRW | Capacity / min filter |
| **Amihud ILLIQ20** | mean(\|r\| / DollarVol, 20); report **bp per $1M** | Price impact; validated vs KR high-freq in Korean literature |
| **Dry-up** | vol5 / vol60 | Participation collapse |
| **HL range%** | median((H−L)/C) 60d | Crude spread/vol proxy (not true bid–ask) |

### C.2 Snapshot (as-of ~2026-09, yfinance)

| Ticker | ADV20 $M | Amihud bp/$1M (med) | HL range% 60d | Role |
|--------|---------:|--------------------:|--------------:|------|
| NVDA | ~29,500 | 0.04 | 2.7 | US mega |
| AAPL | ~14,100 | 0.01 | 2.2 | US mega |
| 000660.KS | ~4,300 | 0.62 | 6.4 | KR mega |
| 005930.KS | ~3,300 | 0.21 | 5.2 | KR mega |
| 051910.KS (LG Chem) | ~40 | 2.3 | 5.1 | KR large |
| 271560.KS (Orion) | ~10 | 16 | 3.5 | KR mid F&B |
| 004370.KS | ~10 | 21 | — | KR mid |
| 000080.KS (Hite) | ~0.9 | **28** | 2.5 | KR mid **thin** |

**Dry-up at MOS δ\*=0.25 cross:** US dry&lt;0.5 frequency **~0%**; KR **~4.7%** — dry-up is a **KR mid/large** problem more than US mega.

### C.3 Proposed bits / filters (NOT LOCKED)

| Rule | Draft threshold | Effect |
|------|-----------------|--------|
| **min ADV Enter filter** | US: ADV20$ ≥ **$50M**; KR large-cap universe: ≥ **$20M**; KR mid/F&B watchlist: ≥ **$5M** else **alert-only / no Enter** | Hard gate before Enter |
| **C_liq_dry** | vol5/vol60 **&lt; 0.5** OR ADV20$ &lt; 50% of ticker’s own 1y median ADV | If Enter else ok: `f←0.5·f`; if also below min ADV → block |
| **Amihud caution** | ILLIQ bp per $1M **&gt; 10** (KR mid territory) | Cap `f` at **0.5·f_max**; UI “impact risk” |
| **Samsung vs midcap** | 005930/000660 never fail min ADV in sample; 000080-type names fail often → explains why KR Retail/F&B mid need stricter gates (aligns with locked KR_RETAIL `δ*=null`) | |

True **quoted spreads** need KRX/US NBBO — not free on box; HL% is documentation-only until microstructure feed.

---

## D. Synthesis

### D.1 Ranked proposals (defaults)

| Rank | Item | Default action | Implementability (app) | Overlap risk |
|-----:|------|----------------|--------------------------|--------------|
| **1** | **C_earn_miss** (+ half-size / Q_earn) | Modifier → half-size US; Q_earn=0 on big miss+YoY crash | **High** — yfinance earnings dates already | Low vs VIX/rates; some vs news-on-print |
| **2** | **min ADV + C_liq_dry** | Hard min ADV; dry → half-size | **High** — OHLCV only | Low |
| **3** | **C_flow_out** (EWY−KS11) | Modifier f×0.75; optional checklist later | **Medium** — needs EWY+KS11 daily | Mild vs C_fx / C_kr |
| **4** | **C_earn_rev** soft | UI + severity | Medium — thin quarterly history | With secular_impairment |
| **5** | C_retail_crowding / short_caution | Wait for adapters | **Low** until Naver/KRX/FINRA | PSY_CHASE |

### D.2 Overlap with existing / draft bits

| New | vs C_vix | vs C_rates/C_credit | vs C_news | vs PSY_* |
|-----|----------|---------------------|-----------|----------|
| C_earn_miss | Low (idiosyncratic) | Low | Medium if “earnings” headlines — prefer **numeric surprise** over news text | Miss + bounce → PSY_CHASE |
| C_flow_out | Low–med (risk-off days) | Med (global $ strength) | Low | Retail crowding → CHASE |
| C_liq_dry | Low | Low | Low | Fatigue irrelevant |

### D.3 Recommended **v1.2 bundle** (after Mac lands v1.1 balanced)

Ship **2–4 bits/rules first**, still **NOT locking δ\*/σ_V**:

1. `minAdvUsdByMarket` gate + `C_liq_dry` half-size  
2. `C_earn_miss` half-size (US); KR trap caution UI  
3. `C_flow_out` via EWY−KS11 ≤ −3.5% (modifier)  
4. Optional: `Q_earn=0` rule wired to existing Q path  

**Defer:** FactSet revisions, live KRX investor splits, short interest, true spreads.

**Paper replay checklist before any lock:** re-score `INDIVIDUAL_STOCK_REVIEW` event set with stub earnings/flow/liq bits; report Δ hit126 / trap / alert count; user choose lock.

### D.4 Data gaps (must stay visible in UI/docs)

- No paid consensus revision breadth  
- KR Surprise% noisy / biased miss rate  
- yfinance short & holders 401  
- No robust free KRX foreign history on box  
- Amihud ≠ bid–ask; KR mid ADV unstable  
- Survivorship mega/large only  

---

## E. Concrete thresholds cheat-sheet (copy-paste for app)

```
# PROPOSALS ONLY — not part of A_prime_v1.1_balanced lock

C_earn_miss_US:  surprise_pct < 0 AND days_since_earn <= 10
C_earn_miss_KR:  surprise_pct < -10 AND days_since_earn <= 10   # else skip
C_earn_rev:      eps_yoy < -0.20 OR last_two_misses
Q_earn_0:        big_miss (US<-10 / KR<-30) AND (eps_yoy < -0.30 OR secular_impairment) AND d >= deltaStar
                 → Enter=false, same as Q=0

on Enter && C_earn_miss && !Q_earn_0:  f *= 0.5   # US default; KR if surprise<-10

C_flow_out:      (r20_EWY - r20_KS11) <= -0.035    # alt -0.047
                 → f *= 0.75 (modifier default)

C_retail_crowding (stub): individual_net_5d > +2σ AND bounce_from_5d_low > 0.05
                 → needsReconfirm; PSY_CHASE threshold may use 5% when this fires

min_adv_usd:     US 50e6 | KR_large 20e6 | KR_mid 5e6   # else no Enter
C_liq_dry:       (vol5/vol60 < 0.5) OR (adv20 < 0.5 * adv20_1y_median)
                 → f *= 0.5; if below min_adv → block
amihud_caution:  amihud_bp_per_1M > 10 → f = min(f, 0.5*f_max)
```

---

## F. File paths

| Path | Role |
|------|------|
| `/workspace/mos-spec/EARNINGS_FLOWS_LIQUIDITY_GAPS.md` | This research |
| `/workspace/mos-spec/MOS_FORMULA_A_PRIME.md` | Locked v1.1 + appendix proposals |
| `/workspace/mos-spec/data/earn_flow_liq/earnings_events.csv` | 913 earnings events |
| `/workspace/mos-spec/data/earn_flow_liq/earnings_summary.csv` | Slice aggregates |
| `/workspace/mos-spec/data/earn_flow_liq/liquidity_snapshot_v2.csv` | ADV/Amihud/dry |
| `/workspace/mos-spec/data/earn_flow_liq/ewy_ks11_rel20.csv` | Flow proxy series |
| `/workspace/mos-spec/data/earn_flow_liq/dry_at_mos_cross.csv` | Dry-up at δ\* crosses |

---

*Alerts/scoring research only. Not investment advice. Paper/Live remain OFF.*
