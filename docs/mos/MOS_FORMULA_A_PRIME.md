# MOS Formula A′ + Psychology Guards
Personal-only · alpha-trading-system-gemini · 2026-09-19
Paper/Live = FALSE · Real orders = NO · Alerts/scoring/UI only

Separate from Formula B (60d regime TP/SL). Do not mix accounts/logics.

---

## 0. Sleeve (annotation only)
- Buy & Hold core: 70%
- MOS opportunistic sleeve: 30%
- No brokerage sizing enforcement in v1 — UI label + score fields only

---

## 1. Inputs (per ticker i, market m)

| Symbol | Meaning | Default / note |
|--------|---------|----------------|
| P | last price | |
| Pmax_3y | 3-year high | |
| d | 1 − P/Pmax_3y | discount |
| δ* | MOS threshold | **0.25** |
| r20 | 20d return | |
| VIX, ΔVIX_5d | level / 5d change | |
| ΔFX_5d | USD/KRW 5d % | KR names |
| ρ60 | corr(SPY,EWY) 60d | optional |
| news_* | existing Trump/Axios feed | ≤72h fresh |
| trade_* | 수출입 / trade report | fresh |
| firm tags | internal vs external | |
| σ_V | vol proxy | default **0.15** |
| ε | safety haircut | **0.10** |
| f_max | max sleeve weight | **0.12** |

---

## 2. Market checklist bits (0/1)

- **C_dd** = 1 iff d ≥ δ*
- **C_mom** = 1 iff r20 ≤ −0.05
- **C_vix** = 1 iff VIX ≥ 25 OR ΔVIX_5d ≥ +0.30
- **C_fx** = 1 iff (KR ticker) AND ΔFX_5d ≥ +0.02; else 0 / N/A skip
- **C_corr** = 1 iff ρ60 ≥ 0.75; if ρ unavailable → skip (do not force 0)
- **C_kr** = 1 iff KR vs US drawdown gap ≥ 0.05 when both available
- **C_news** = 1 iff fresh (≤72h) market crisis/tariff/war/Fed-emergency hit in news adapter
- **C_trade** = 1 iff export YoY or trade balance deterioration in trade adapter (fresh)

**S_F^mkt** = sum of available bits (skipped bits excluded from sum AND from denominator?  
**Rule:** skipped = not counted in sum; threshold still absolute **≥ 2** on sum of present bits.)

**F_mkt** = 1 iff (d ≥ δ*) AND (S_F^mkt ≥ 2)

---

## 3. Firm quality / shock

- **Internal collapse** (fraud, going-concern, sudden management crisis tags) → **Q_i = 0**
- Else **Q_i = 1**
- **External shock** (tariff/sector/geo hit to firm) → **C^firm_ext = 1** else 0

**F_i** = F_mkt ∨ (C^firm_ext ∧ d_i ≥ δ*)

**Enter_i** = (Q_i = 1) ∧ (F_i = 1) ∧ (d_i ≥ δ*)

---

## 4. Size (before psychology)

```
f0 = clip( (δ* − ε) / (2 · σ_V²) , 0, f_max )
f  = min( f_max, f0 · (0.75 + 0.15 · S_F^mkt) · (1 + 0.1 · C^firm_ext) )
```

With δ*=0.25, ε=0.10, σ_V=0.15 → f0 ≈ clip(0.15/(2·0.0225),…) ≈ clip(3.33,…) → **capped at f_max=0.12**

---

## 5. Exit / alerts (hints only)

- Soft take-profit hint when d ≤ 0.05
- Hard alert when Q → 0 (exit / no hold recommendation)
- Shallow discount exit: optional when d falls below δ*/2 after enter

---

## 6. Psychology guards (manual trader)

Applied **after** Enter_i / f. Expose reasons on scored object.

| ID | Rule | Effect |
|----|------|--------|
| PSY_FOMO | Fear&Greed ≥ 75 AND F_mkt=0 | **block** new MOS enter |
| PSY_CHASE | bounce from 5d low > +8% after signal | f ← 0.5·f OR `needsReconfirm=true` |
| PSY_STREAK | last N MOS sleeve outcomes losses (N≥3 default) | coolDownDays += N; f ← 0.5·f |
| PSY_WEAK | Enter with S_F^mkt == 2 exactly | severity=`weak` (UI); optional require +1 bit |
| PSY_ANCHOR | — | size **never** from “was higher last year”; only d+checklist |
| PSY_FATIGUE | new Enter alerts today ≥ 3 | drop lower-priority; sort **급락 > MOS enter > 뉴스** |
| PSY_QCOOL | after Q=0 exit alert on ticker | no re-enter same ticker for **M=10** days |

Defaults: N=3, M=10, F&G greed threshold=75, chase=8%, daily Enter cap=3.

---

## 7. Scored object (API shape draft)

```json
{
  "ticker": "005930.KS",
  "d": 0.31,
  "deltaStar": 0.25,
  "bits": {"C_dd":1,"C_mom":1,"C_vix":0,"C_fx":1,"C_corr":null,"C_kr":1,"C_news":1,"C_trade":0},
  "S_F_mkt": 4,
  "F_mkt": 1,
  "Q": 1,
  "C_firm_ext": 0,
  "F_i": 1,
  "Enter": true,
  "f_raw": 0.12,
  "f": 0.06,
  "psychology": {
    "blocked": false,
    "reasons": ["PSY_CHASE"],
    "severity": "weak|normal|strong",
    "coolDownUntil": null,
    "needsReconfirm": true
  },
  "sleeveHint": "BH70/MOS30",
  "paperLive": false
}
```

---

## 8. Formula B (do not merge)
60d μ̂/σ̂ regime TP/SL (bull long / bear short / flat). Separate personal account/logic from MOS sleeve.

---

## 9. Local landing plan (Mac reconnect)

Repo: `alpha-trading-system-gemini`  
Typical path: `/Users/aiden.an/Desktop/alpha-trading-system-gemini` (verify)

1. Confirm branch / HEAD (avoid mixing with staged R31 commit unless user asks)
2. Add `lib/alerts/mosOpportunityScore.js` (+ psychology helpers)
3. Add `test/...mos...test.js`
4. Thin adapters: news → C_news, trade → C_trade, firm tags → Q / C_firm_ext
5. Wire dashboard/alerts read-only; keep Paper/Live false
6. Copy this spec to `docs/MOS_FORMULA_A_PRIME.md`
7. Run focused tests only; no push unless asked
8. R31 staged schema commit stays **separate** (user must ask)

**Do not:** enable Live, real KB orders, DB migrate R31, touch 갯길안/Windows.

---

## v1.1 Balanced parameters — LOCKED 2026-09-19

User chose **균형 초안**. A′ body above stays the baseline algebra; these overrides apply for app landing (alerts/scoring only · Paper/Live OFF).

Research basis: `INDIVIDUAL_STOCK_REVIEW.md` · n≈977 proxy events · survivorship / no news-trade backfill · not trading advice.

### Locked δ* by sector

| Bucket | δ* | Notes |
|--------|-----|------|
| US Food & Beverage / quality staples | **0.20** | Not 0.18 (more signals, slightly weaker); not 0.25 (too rare for KO/PEP/PG) |
| US Healthcare defensives | **0.20** | e.g. JNJ; high-vol biotech stays 0.25 until tagged |
| US Financials / Energy / broad | **0.25** | Unchanged from A′ |
| US Semis / high-vol Tech | **0.30** | Cuts trap-y flood vs 0.25 |
| KR Food & Beverage | **0.30** | Do **not** copy US lower δ* (KR F&B ~30% ann vol) |
| KR Semis/IT, Chem, Auto/Battery | **0.30** | High vol |
| KR Financials | **0.30** | Align with KR cyclicals for alert fatigue |
| KR Retail / Consumer | **null** | No auto-Enter (alert-only / Q review); hit126 ~37% / med −4% |
| Fallback | **0.25** | Unknown sector |

App: `deltaStarBySector[sectorId]`; `null` = no Enter scoring.

### Locked checklist / gates

- Market = KR → **S_F ≥ 3** (was ≥2). Addresses C_kr ~91% freeload bit.
- PSY_WEAK (`{C_dd, C_mom}` only) → treat as weak; require S_F≥3 or confirm flag (same as KR floor when applicable).
- New sector enum **`FOOD_BEV`** separate from `STAPLES`; UI always shows F&B row.
- `secular_impairment` tag → Q=0 or block MOS Enter (KHC-like).
- Live **C_news** + **C_trade** adapters: ship when wiring; no historical lock claim.

### Locked sizing

| Param | Value |
|-------|-------|
| ε | **0.10** (unchanged) |
| f_max | **0.12** (unchanged) |
| σ_V fallback | **0.25** (was global 0.15 — that always pinned f_max) |
| σ_V US_FOOD_BEV / US_STAPLES | **0.22** / **0.20** |
| σ_V US_SEMIS | **0.40** |
| σ_V KR_FOOD_BEV | **0.30** |
| σ_V KR_SEMIS_IT / KR_AUTO_BATT | **0.40** / **0.45** |

```
σ_V := sectorVolMap[sector] ?? 0.25
f0  = clip( (δ*_i − ε) / (2 · σ_V²) , 0, f_max )
f0 *= clip( 0.8 + 0.8 * (d − δ*_i) / 0.25 , 0.8, 1.4 )   # depth boost
f0  = min(f0, f_max)
```

### Locked config snippet (canonical)

```json
{
  "version": "A_prime_v1.1_balanced",
  "lockedAt": "2026-09-19",
  "deltaStarDefault": 0.25,
  "deltaStarBySector": {
    "US_FOOD_BEV": 0.20,
    "US_STAPLES": 0.20,
    "US_HEALTHCARE": 0.20,
    "US_SEMIS": 0.30,
    "US_TECH_HIGHVOL": 0.30,
    "US_FINANCIALS": 0.25,
    "US_ENERGY": 0.25,
    "KR_FOOD_BEV": 0.30,
    "KR_SEMIS_IT": 0.30,
    "KR_CHEM": 0.30,
    "KR_AUTO_BATT": 0.30,
    "KR_FINANCIALS": 0.30,
    "KR_RETAIL": null
  },
  "sigmaVBySector": {
    "US_FOOD_BEV": 0.22,
    "US_STAPLES": 0.20,
    "US_SEMIS": 0.40,
    "KR_FOOD_BEV": 0.30,
    "KR_SEMIS_IT": 0.40,
    "KR_AUTO_BATT": 0.45
  },
  "sigmaVDefault": 0.25,
  "epsilon": 0.10,
  "fMax": 0.12,
  "krMinSF": 3,
  "weakRequireSF": 3,
  "paperLive": false
}
```

### Still open (not in this lock)

- Exact ticker→sectorId mapping table in app
- C_credit for US banks (future)
- Paper/Live enablement (forbidden until separate gate)
- Mixing with Formula B 60d TP/SL

### Mac landing note

When Mac reconnects: land `lib/alerts/mosOpportunityScore.js` (+ tests) using **this v1.1 balanced config**, not raw A′ single δ*=0.25. Keep R31 schema commit separate unless user asks.

---

## Rates / bonds / news bit proposals for A′ v1.1+ (NOT LOCKED)

Research: `NEWS_RATES_BONDS_CORR_10Y.md` · 2026-09-19 KST · ~10y panel · curated events + FRED/yfinance · GDELT/NewsAPI backfill unavailable · Paper/Live OFF · **does not change locked δ*/σ_V table above**.

### Optional checklist bits (draft)

| Bit | Trigger (draft) | Notes |
|-----|-----------------|-------|
| **C_rates** | 5d ΔDGS10 ≥ **+0.15** pp (**+15 bp**); alt strict **+20 bp** (≈p95) | Low overlap with `C_vix` (joint days ~0.6%). Fires in 2022-style inflation/hike windows. Skip if DGS10 feed down. |
| **C_credit** | 5d return(HYG) − return(LQD) ≤ **−1.0%** (alt **−1.4%** ≈p05) | Marks credit-stress; EWY deep-dd freq elevated in sample. US primary; optional for KR sleeve. |
| **C_news (refine)** | Keep ≤72h freshness; **theme weights**: tariff/China/COVID/KR-political = full 1; Fed-*emergency ease* = 1; Fed-*CPI/hike shock* = 1; **NK alone = 0** unless with FX/equity confirm; war = 1 if equity− or VIX confirm | Tariff CAR: EWY≪SPY. NK CAR ≈0 in-sample — avoid NK freeload. |
| **C_demo** | — | **Do not add** as 0/1 bit. Aging is slow; UI context tag only if desired. |

### Suggested wiring (still optional)

```
# present bits may include C_rates, C_credit when feeds live
# KR floor stays S_F ≥ 3 (locked); new bits help reach floor without weakening it
# S_F sum rule unchanged: skipped feeds excluded from sum; absolute threshold on present sum
```

### Overlap / sizing

- Do **not** replace `C_vix`; add beside it.
- No change to locked `δ*`, `σ_V`, `ε`, `f_max`, or sector table in this proposal.
- If both `C_rates` and `C_credit` fire with `C_vix`, UI severity can upgrade weak→normal; sizing formula unchanged unless a later gate revisits.

### Demographics note (age / gender)

- KOR 65+ 12.95%→20.33% (2015→2025). Segment proxies: young/growth lag in rates/credit stress.
- **No gender retail-flow bit** (no AAII/Gallup age·gender history on box; XLY−XLP is a weak consumption proxy only).
- Any future F&B/healthcare δ* tilt must come from hit/trap tables, not from annual population corr (n≈10).

### Open before any lock

1. Paper replay with stub→live `C_rates`/`C_credit` on the individual-stock event set  
2. Confirm FRED/yfinance latency for alert SLA (≤72h like news)  
3. Theme classifier tests on Axios/Trump feed adapter  
4. Explicit user choose to lock v1.2 bits — until then **proposals only**

### Fact-check gate for C_news (pointer — NOT LOCKED)

See **`NEWS_FACTCHECK_FORMULA.md`**. Draft: `C_news` only if `FactScore ≥ 0.65` and `claimClass=verified_fact` (plus existing theme + ≤72h). Unverified rumor must not boost Enter. Does **not** modify locked δ*/σ_V.

---

## Earnings / flows / liquidity bit proposals (NOT LOCKED)

Research: `EARNINGS_FLOWS_LIQUIDITY_GAPS.md` · 2026-09-19 KST · yfinance earnings n=913 + ADV/Amihud/EWY−KS11 · Paper/Live OFF · **does not change locked δ\*/σ_V table above**.

### Proposed bits (not locked): C_earn / C_flow / C_liq

| Bit / rule | Draft trigger | Default effect |
|------------|---------------|----------------|
| **C_earn_miss** | US: Surprise% &lt; **0** within **10d** of print; KR: Surprise% &lt; **−10** (else skip — Yahoo KR consensus noisy) | Prefer **modifier** first: Enter → **`f ← 0.5·f`** (US); KR caution/half-size if &lt;−10. Do **not** freeload KR `S_F≥3` until replay. |
| **C_earn_rev** | EPS YoY &lt; **−20%** OR last **2** prints miss | UI / severity only |
| **Q_earn = 0** | Big miss (US &lt;−10 / KR &lt;−30) **and** (EPS YoY &lt;−30% or `secular_impairment`) **and** `d≥δ*` | Same as Q=0 → **block Enter** |
| **C_flow_out** | `r20(EWY)−r20(KS11) ≤ −3.5%` (alt **−4.7%** ≈p05) | Modifier **`f ← 0.75·f`**; optional checklist later |
| **C_retail_crowding** | Stub until Naver/KRX: retail +2σ & bounce&gt;5%; ties to **PSY_CHASE** (may use 5% chase threshold) | `needsReconfirm` |
| **short_caution** | US short% float ≥20% when feed exists (yfinance info **401 gap** now) | `f ← 0.5·f` |
| **C_liq_dry** | vol5/vol60 &lt; **0.5** OR ADV20 &lt; 50% of 1y median ADV | `f ← 0.5·f`; with min-ADV fail → block |
| **min ADV filter** | US ≥ **$50M**; KR large ≥ **$20M**; KR mid ≥ **$5M** | Below → **alert-only / no Enter** |
| **Amihud caution** | ILLIQ bp per $1M &gt; **10** (KR mid territory) | Cap `f ≤ 0.5·f_max` |

### Empirics (one-liners)

- US **miss∩deepMOS** (n=18): hit63 **39%**, trap **28%** vs beat∩deepMOS hit63 **71%**, trap **12%**.
- KR Surprise% miss rate ~**51%** (noisy) — trap still higher on miss (**21%** vs **7%**); not a clean directional bit.
- ADV: 005930/000660 ~**$3–4B**/d vs HiteJinro ~**$1M** — capacity gate matters for KR mid.
- EWY−KS11 rel20 p10 ≈ **−3.5%** as foreign-ish outflow proxy; KRX investor-type history **not** free on box.

### v1.2 bundle (after Mac lands v1.1 balanced)

1. min ADV + `C_liq_dry`  
2. `C_earn_miss` half-size (+ `Q_earn=0` path)  
3. `C_flow_out` modifier  
4. Soft `C_earn_rev` UI  

Still open before any lock: paper replay on individual-stock events; promote modifiers → checklist only with user OK; Naver/KRX/short feeds.

### Open before any lock

1. Replay trap/hit deltas with stub earnings+liq+flow on the v1.1 event set  
2. Decide modifier-only vs checklist membership (esp. KR floor)  
3. Explicit user choose to lock v1.2 bits — until then **proposals only**

---

## Proposed (not locked): Execution hours + spike guards

See `EXECUTION_SPIKE_AND_HOURS.md` (as of 2026-09-19).  
Reflects **KRX After-Market 16:00–20:00 since 2026-09-14**, NXT 08:00–20:00, US 23/5 target **2026-12-06**.  
Does **not** change A′ v1.1 balanced δ*/σ_V. Paper/Live OFF.

---

## Execution spike / session gates (NOT LOCKED)

Pointer only — **does not change locked A′ v1.1 balanced δ\*/σ_V**.

See **`EXECUTION_SPIKE_AND_HOURS.md`** (2026-09-19 KST):

- `Enter_i` ≠ order-now: must pass **sessionGate** + **spikeGate** (+ optional liq/earn/flow).
- Alerts 24/7; execution window separate (default **KR/US RTH only** for Enter).
- KR: KRX After-Market **16:00–20:00** live since **2026-09-14** (시간외단일가 abolished); Enter auto **OFF** in after by default.
- US overnight 23/5 target **2026-12-06** — not live yet; alerts-only default when live.
- **Paper/Live = FALSE** · no real orders.

---

## Proposed (not locked): C_lev_etf / flow from leveraged products

Research: **`LEVERAGED_ETF_SINGLE_STOCK_IMPACT.md`** · 2026-09-19 KST · yfinance ~10y daily + 60d 5m · Paper/Live OFF · **does not change locked δ\*/σ_V table above**.

| Bit / package | Draft trigger | Default effect |
|---------------|---------------|----------------|
| **C_lev_etf** (bundle) | Index/sector levered flow pressure **or** single-stock levered share | Parent label for `{C_lev_rebal, C_ssl_lev}` |
| **C_lev_rebal** | `|r_index| ≥ 1.5%` **AND** watchlist lev ETF volume z60 ≥ **2** (US: TQQQ/SOXL; KR: 122630/233740 + inverse for vol) | **Block Enter** last **30m** US / **20m** pre-KR auction; alt `f←0.5·f` |
| **C_ssl_lev** | Single-stock 2× ADV$ / stock ADV$ ≥ **3%** OR (≥**1.5%** ∧ ETF vol z≥2) | Widen spike guards (SPIKE_1M **1.5%**, SPIKE_SIG **2%**); optional last-Y-min block on **underlying only** |

**Empiric one-liners (proxy — no true C/R):** TQQQ both-flag → holdings |r| amp **~1.30×**, next-day signed cont **−1.1%** (hit~41%); SOXL amp **~1.42×**, cont **−0.6%**; NVDL/TSLL ADV share **~1.7% / 5.5%**, |r| amp on ETF volz>2 **~1.9× / 2.2×**; KR KODEX lev milder amp **~1.07–1.28**, cont still negative. Residual↔volume×sign corr ≈ **0**.

**Session:** Reinforces `EXECUTION_SPIKE_AND_HOURS.md` — KR after 16–20 Enter OFF; US extended alerts-only. Index-levered = basket pressure; SSL = direct.

Still open before any lock: paper replay; longer intraday; user choose promote modifiers → checklist.
