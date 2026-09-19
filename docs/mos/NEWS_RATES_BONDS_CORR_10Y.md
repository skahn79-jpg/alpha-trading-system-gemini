# News / Rates / Bonds · 10y Correlations for MOS A′

**Date:** 2026-09-19 (KST)  
**Scope:** Personal alerts / scoring research only · Paper/Live OFF · **Not trading advice**  
**Window:** ~2016-01 → 2026-09 (n≈2693 US trading days)  
**User:** SK An · Formula A′ v1.1 balanced δ*/σ_V table remains **LOCKED** (proposals only below & in `MOS_FORMULA_A_PRIME.md`)

---

## 한국어 핵심 요약 (Top findings)

1. **고강도 뉴스일(n=58)** 전후(t−1…t+5) 평균 누적수익: **SPY −1.6%**, **EWY −2.7%**, **KS11 −2.6%**, **삼성전자 −2.9%**, **TLT +1.1%**, **HYG −1.3%**. 한국·신흥(EWY)이 미국보다 더 크게 반응.
2. **테마별 KR vs US:** 관세(tariff)에서 EWY가 SPY보다 **약 −3.6%p** 더 약함; COVID도 EWY가 **약 −4.4%p** 더 약함. **북한(NK)** 이벤트의 주식 충격은 의외로 작음(SPY CAR +0.6%, EWY ~0). **Fed 긴급/완화형** 이벤트는 CAR가 평균 양수(유동성 반응).
3. **금리↑·채권↓ 레짐**(63일 Δ10Y>+50bp & TLT 63일&lt;−3%, 전체의 **13.7%**): EWY의 MOS형 낙폭(d≥0.25) 빈도가 **31% → 61%**로 급증. SPY는 샘플에서 d≥0.25 자체가 드묾(0.4%).
4. **신용 스트레스**(HYG−LQD 21일 &lt; −2%): EWY MOS 빈도 **72%**; SPY 21일 평균수익 **−2.1%**.
5. **C_rates vs C_vix 중복은 낮음:** 5일 +25bp 금리 스파이크와 VIX 비트 동시 발생은 전체의 **0.6%**뿐. VIX 비트 중 금리 스파이크는 **3.6%**. → **금리 비트는 VIX와 겹치지 않는 정보**로 후보 가치 있음.
6. **뉴스 센티먼트 프록시:** 박스에서 GDELT/NewsAPI/네이버 헤드라인 10년 백필 불가(429·키 없음). 대용 = 큐레이션 위기 캘린더 + VIX z>2 + |Δ10Y| z>2.5. `sent_proxy`(−ΔVIX+SPY)는 SPY와 **기계적 고상관(~0.87)** → 공식 비트로는 **쓰면 안 됨**(VIX와 중복).
7. **인구구조(고령/성별):** 연간 매크로(World Bank). 한국 65+ **12.95%(2015) → 20.33%(2025)**. 고빈도 일간 상관은 **기대대로 약함/불안정(n≈9–10)**. 구간 프록시: 신용·금리 스트레스 시 **young−old 일평균 −3~−17bp**(성장주 상대 약세). **성별 소매 플로우 인과는 데이터 없음 — 주장 금지.**
8. **MOS 함의(제안만):** 선택 비트 `C_rates`(5일 Δ10Y ≥ +15~20bp), `C_credit`(5일 HYG−LQD ≤ −1.0%~−1.4%), `C_news` 테마 가중(tariff/COVID/KR domestic > NK). 고령화는 **KR Healthcare/F&B δ*를 당장 잠그지 말고** 섹터 태그·리뷰 우선.

---

## English executive bullets

- High-intensity news days: KR beta (EWY/KS11/005930) underperforms SPY; duration (TLT) hedges on average; HYG sells off.
- Tariff & COVID themes lead **KR worse than US**; NK headline risk is small in-sample; Fed *liquidity* events flip positive CAR.
- Rates-up/bonds-down regimes roughly **double** EWY deep-drawdown frequency — useful MOS context bit.
- Rates-spike bit barely overlaps VIX bit → optional `C_rates` / `C_credit` can add orthogonal signal.
- Demographics are slow; segment ETFs show young/growth lag in stress — **not** micro gender/age flow evidence.
- Survivorship: live ETF/index universe only; curated event list is **not** a complete news backfill.

---

## 1. Data & coverage honesty

| Source | Status | Use |
|--------|--------|-----|
| yfinance OHLCV 2015–2026-09 | OK (crumb 429 intermittent; closes retrieved) | Equities, bond ETFs, KR names, KR bond ETFs 148070.KS / 114260.KS |
| FRED CSV (no key) | OK | DGS2, DGS10, FEDFUNDS, VIXCLS, DEXKOUS, KR 3M / long rate monthly |
| GDELT DOC 2.0 | **Blocked / 429**; OR-query errors; not usable for 10y daily tone | Documented gap |
| NewsAPI / Naver·Daum dumps | No API key / not on box | Gap |
| FinBERT | Not installed (heavy); skipped | Gap |
| Curated crisis calendar | **46 events** 2016–2024 (COVID, Fed, tariff, war, bank, NK, KR, China, inflation) | Primary event-study |
| Intensity proxy | VIX z>2 ∪ \|Δ10Y\| z>2.5 ∪ curated flags → **58 high-news days (2.15%)** | Rolling corr / ES |
| World Bank WDI | OK annual through **2025** | Demographics |
| AAII / Gallup by age·gender | **Unavailable** free with history on box | Gap |

**Survivorship:** SPY/EWY/sector ETFs and current KR large-caps only — no delisteds. Event calendar is analyst-curated (selection bias toward famous shocks). Korean-language headline intensity **not** measured.

**Mechanical warning:** `sent_proxy = −ΔVIX/5 + 10·r_SPY` correlates ~0.87 with SPY by construction. Report rolling “sent” columns for transparency; **do not** feed into MOS bits.

---

## 2. Assets & rate panel

**Equities:** SPY, QQQ, IWM, EWY, ^KS11, XLK XLF XLE XLV XLP XLI, SMH, 005930.KS, 000660.KS  
**Bonds/credit:** TLT, IEF, HYG, LQD (+ KR 148070.KS / 114260.KS available for future)  
**Rates:** DGS2, DGS10, FEDFUNDS; KR monthly 3M / long-gov proxy  
**Demo segments:** elderly-tilt XLV/XLP/XLU/JNJ/VIG/NOBL/KO/PG; young-tilt XLK/QQQ/XLY/SMH/035420.KS/036570.KS; KR pharma 068270/207940 vs NAVER/NCsoft  

---

## 3. Full-sample correlations (daily)

| Asset | corr(news_intensity) | corr(ΔVIX) | corr(ΔDGS10) | corr(HYG−LQD ret) |
|-------|---------------------:|-----------:|-------------:|------------------:|
| SPY | −0.221 | −0.789 | +0.121 | +0.481 |
| EWY | −0.174 | −0.521 | +0.005 | +0.279 |
| ^KS11 | −0.141 | −0.095 | +0.060 | +0.074 |
| 005930 | −0.108 | −0.053 | +0.042 | +0.052 |
| TLT | +0.056 | +0.143 | **−0.900** | −0.686 |
| HYG | −0.214 | −0.572 | −0.121 | +0.449 |
| LQD | −0.068 | −0.233 | −0.697 | −0.500 |
| XLF | −0.215 | −0.667 | +0.250 | +0.519 |
| SMH | −0.151 | −0.643 | +0.084 | +0.352 |

**Reading:** News-intensity (sparse 0/1-ish) has modest negative equity corr. Equity–ΔVIX is the dominant fear channel (already in `C_vix`). ΔDGS10 is nearly orthogonal to SPY level fear but drives TLT. Credit relative return co-moves with risk-on equities.

---

## 4. Rolling correlations (60d / 126d)

Mean rolling corr of **news_intensity** vs targets:

| Window | SPY | EWY | TLT | ΔDGS10 | KS11 | HYG |
|-------:|----:|----:|----:|-------:|-----:|----:|
| 60d | −0.193 | −0.189 | +0.030 | −0.039 | −0.143 | −0.180 |
| 126d | −0.197 | −0.180 | +0.039 | −0.048 | −0.151 | −0.180 |

Mean rolling corr of **ΔVIX** (for overlap check): SPY ≈ −0.80, EWY ≈ −0.53, TLT ≈ +0.11.

→ News-intensity adds a **weaker, less redundant** equity link than VIX; still low average because intensity is zero most days.

---

## 5. Event study — high-intensity days (n=58)

**Definition:** curated theme day and/or VIX z>2 and/or \|Δ10Y\| z>2.5.  
**CAR:** sum of returns from **t−1 through t+5** (7 sessions).

| Asset | n | Mean CAR % | Med CAR % | Hit (CAR>0) | t=0 mean bp |
|-------|--:|----------:|----------:|------------:|------------:|
| SPY | 58 | −1.59 | −0.54 | 48% | −113 |
| QQQ | 58 | −1.09 | −0.01 | 50% | −95 |
| EWY | 58 | **−2.74** | −1.79 | 33% | **−177** |
| ^KS11 | 58 | −2.57 | −1.45 | 40% | −98 |
| 005930.KS | 58 | −2.89 | −0.41 | 48% | −110 |
| 000660.KS | 58 | −1.78 | −1.77 | 38% | −125 |
| XLF | 58 | −2.34 | −2.07 | 33% | −152 |
| SMH | 58 | −1.38 | −0.58 | 43% | −128 |
| TLT | 58 | **+1.10** | +0.43 | 55% | +39 |
| IEF | 58 | +0.41 | +0.20 | 55% | +17 |
| HYG | 58 | −1.26 | −0.28 | 38% | −61 |
| LQD | 58 | −0.33 | +0.14 | 53% | −18 |
| ΔDGS10 (bp, t0) | 58 | — | — | — | **−1.8 bp** (flight-to-quality mix) |

### Path shape (mean bp)

| t | SPY | EWY | TLT |
|--:|----:|----:|----:|
| −1 | −49 | −46 | +41 |
| 0 | −113 | −177 | +39 |
| +1 | +11 | −13 | −20 |
| +2 | −25 | −47 | +14 |
| +3 | −15 | −9 | +2 |
| +4 | +22 | +10 | +15 |
| +5 | +9 | +8 | +19 |

EWY sells more on day 0 and stays weaker through t+2; TLT bid starts t−1.

---

## 6. Theme comparison — what leads KR vs US

Mean CAR% (t−1…t+5); **EWY−SPY** = KR underperformance gap.

| Theme | n | SPY | EWY | KS11 | 005930 | TLT | EWY−SPY | Δ10Y t0 bp |
|-------|--:|----:|----:|-----:|-------:|----:|--------:|-----------:|
| COVID | 5 | −10.3 | −14.7 | −14.8 | −13.2 | +1.1 | **−4.4** | −9 |
| tariff | 8 | −0.2 | −3.8 | −2.4 | −3.8 | 0.0 | **−3.6** | −1 |
| KR domestic | 9 | +0.1 | −1.7 | −0.6 | −1.2 | −0.9 | −1.8 | +5 |
| inflation | 3 | −3.5 | −5.0 | −3.6 | −3.3 | −1.5 | −1.5 | **+12** |
| China | 3 | −0.9 | −1.9 | −1.5 | −1.0 | +5.1 | −1.0 | −11 |
| NK | 6 | +0.6 | −0.0 | +0.2 | −0.1 | +0.8 | −0.6 | +1 |
| war | 4 | +0.1 | −0.3 | −0.2 | −1.7 | +1.4 | −0.4 | −5 |
| bank | 2 | +0.2 | −0.2 | −0.6 | +1.8 | +2.8 | −0.4 | −18 |
| Fed | 6 | +1.3 | +3.2 | +1.9 | +0.2 | +1.9 | **+1.9** | −4 |

**Qualitative:**
- **Tariff / Trump trade / China:** clearest KR-relative hit (EWY, Samsung, Hynix). Aligns with existing `C_news` tariff tags — **keep & weight higher for KR**.
- **COVID / pandemic crash:** global, but KR beta worse; rare but catastrophic — crisis tag remains justified.
- **NK:** markets largely shrug in this sample — don’t overweight NK headlines alone for MOS Enter.
- **Fed:** day-0 often ugly, but week CAR positive when event is *liquidity* (Mar 2020 QE, post-SVB). Distinguish “hike/CPI shock” vs “emergency ease” in adapter if possible.
- **Inflation surprises:** rates up, bonds and equities down together — classic need for `C_rates`.
- **KR domestic political:** mild EWY drag; useful for `C_kr` / local news adapter, not US sleeve.

---

## 7. Rates↑ / bonds↓ regimes vs MOS drawdown frequency

**Regime R:** 63d ΔDGS10 > +50bp **and** TLT 63d return < −3%.  
Share of days: **13.7%** (369 days). Mean VIX in R: 20.2 vs 18.2 out.

| Metric | All days | In regime R |
|--------|---------:|------------:|
| SPY d≥0.25 frequency | 0.45% | 0.0%* |
| EWY d≥0.25 frequency | **31.0%** | **61.0%** |
| KS11 d≥0.25 frequency | 12.1% | 24.1% |
| Mean SPY 3y-dd | — | 7.9% |
| Mean EWY 3y-dd | — | **26.0%** |

\*SPY almost never hits −25% from 3y high in this bullish decade — known MOS rarity for US megacaps.

**Credit stress C:** HYG−LQD 21d < −2% (7.4% of days): EWY d≥0.25 freq **72%**; mean SPY 21d return **−2.1%**.

**Overlap with existing `C_vix`:**

| | Pct of days |
|--|----------:|
| VIX bit (VIX≥25 or ΔVIX_5d≥+30%) | 16.5% |
| Rates spike (5d ΔDGS10 > +25bp) | 1.6% |
| Both | **0.59%** |
| P(rates \| VIX) | 3.6% |
| P(VIX \| rates) | 37% |
| corr(VIX, ΔDGS10) | −0.02 |
| corr(ΔVIX, ΔDGS10) | −0.13 |

→ **Rates spikes often occur without VIX≥25.** Optional `C_rates` is **not** a VIX clone.

### Empirical threshold candidates (in-sample)

| Series | p90 | p95 | note |
|--------|----:|----:|------|
| 5d ΔDGS10 | **+14 bp** | **+19 bp** | propose trigger ≈ +15–20 bp |
| 5d (HYG−LQD) | — | — | p10 = **−0.95%**, p05 = **−1.41%** → trigger ≈ −1.0% to −1.4% |

---

## 8. Demographics (gender / age)

### 8.1 Macro levels (World Bank WDI)

| | KOR 2015 | KOR 2025 | USA 2015 | USA 2025 |
|--|--------:|--------:|--------:|--------:|
| Pop 65+ % | 12.95 | **20.33** | 14.31 | 18.39 |
| Old-age dependency | ~17.7* | **29.27** | ~21.5* | **28.50** |
| Female % of pop | 49.87* | 50.11 | 49.85* | 49.75 |
| Pop 0–14 % | 13.7* | 10.20 | 19.2* | 17.10 |

\*2015 exact from series where shown; table emphasizes 10y **direction**: Korea aging **faster** than US (65+ +7.4pp vs +4.1pp).

Annual panel 2016–2025 also shows KOR_pop65 YoY acceleration (~+0.5pp/y early → **~+1.06pp in 2025**).

### 8.2 High-frequency honesty

Population structure is **annual / slow-moving**. Correlations of levels or YoY demo changes vs annual equity/bond returns use **n≈9–10** — easy to overfit. Largest |corr| in sample (e.g. KOR female YoY vs XLV ~0.74) are **not reliable** and are **not** causal gender-flow evidence.

**AAII / Gallup investor sentiment by age or gender:** not available as free historical series on this box → **unavailable**.

### 8.3 Segment proxies (not microdata)

| Regime | n | Elderly basket bp/day | Young basket bp/day | Young−Old bp | XLY−XLP bp | KR pharma bp | KR internet/game bp |
|--------|--:|----------------------:|--------------------:|-------------:|-----------:|-------------:|--------------------:|
| high_news | 58 | −88.1 | −89.7 | −1.6 | −33.3 | −10.4 | −44.4 |
| calm | 2635 | +6.6 | +9.8 | +3.2 | +2.7 | +9.1 | +5.3 |
| rates↑ bonds↓ | 369 | +0.8 | −2.5 | **−3.3** | −7.5 | +4.5 | −4.0 |
| credit stress | 199 | +4.6 | −12.1 | **−16.7** | −20.8 | +22.4 | −3.7 |

**Reading:** In rates/credit stress, **growth/young proxies lag defensives/elderly-tilt**. KR gaming/internet weaker than KR pharma under stress. This is **sector style**, not proof that elderly/women buy defensives day-to-day.

**Gender:** only weak consumption proxy = discretionary (XLY) vs staples (XLP). No beauty/apparel ETF with clean 10y KR+US overlap used as primary. **Do not claim retail-flow by gender.**

### 8.4 MOS implications (proposals — not locked)

- Korea’s aging is a **multi-year** backdrop favoring healthcare / quality staples **demand narratives**, but MOS is a **drawdown opportunistic** sleeve: do **not** auto-lower KR F&B δ* solely because of aging (v1.1 already sets KR_FOOD_BEV δ*=0.30 for vol reasons).
- Optional future: tag `demo_sensitive=elderly_demand` for alert **context** (UI), not a checklist bit.
- If adding sector tilt later: prefer evidence from **hit rates / trap rates** (`INDIVIDUAL_STOCK_REVIEW.md`) over demo correlations.
- Gender: **no bit**. Insufficient data.

---

## 9. Korea news coverage note

Public English event dates (impeachment, Japan export curbs, elections, martial-law Dec 2024) were included under theme **KR**. Native Naver/Daum/BoK press-release intensity was **not** scraped at scale. BoK / rate path enters via FRED monthly KR rates only. Treat KR news results as **lower confidence** than US tariff/Fed/COVID.

US outlet-level (NYT/WSJ/CNN…) volume was **not** separately measured; themes stand in for multi-outlet shocks.

---

## 10. Does it improve MOS without overlapping VIX?

| Candidate bit | Orthogonal to VIX? | KR relevance | Recommendation |
|---------------|--------------------|--------------|----------------|
| **C_rates** (5d Δ10Y ≥ +15–20bp) | **Yes** (overlap ~0.6% days) | Medium (global) | **Propose for A′ v1.1+** optional |
| **C_credit** (5d HYG−LQD ≤ −1.0%) | Partial (credit often with VIX, but not identical) | High for EWY deep-dd | **Propose** optional US/KR |
| **C_news theme weights** (tariff/COVID/KR > NK) | Extends existing C_news | **High for KR** | **Propose** adapter refinement |
| Raw sent_proxy / FinBERT (absent) | Would overlap VIX | — | **Reject** until independent news tone |
| Demographics bit | N/A (too slow) | Context only | **No checklist bit** |

Expected MOS effect (qualitative, not locked backtest): more true positives in **2022-style** rates bear / **2018–19 tariff** windows where VIX was only intermittently ≥25; slight alert-frequency increase — keep KR `S_F≥3` floor.

---

## 11. Files / reproducibility

- Script: `/workspace/mos-spec/scripts/corr_10y_analysis.py`
- Data: `/workspace/mos-spec/data/yf/`, `fred/`, `demo/`, `analysis_summary.json`, `theme_cmp.csv`, `es_*.csv`
- Related: `INDIVIDUAL_STOCK_REVIEW.md`, `MOS_FORMULA_A_PRIME.md` (proposals appended)

**Disclaimer:** Research for personal alert scoring. Survivorship and incomplete news backfill bias results. Not investment advice. Paper/Live remain OFF.

---

## 12. Fact-check formula (proposed)

Full spec: **`/workspace/mos-spec/NEWS_FACTCHECK_FORMULA.md`**

Summary gate (alerts only · Paper/Live OFF · **not locked**):

```
FactScore ∈ [0,1]  = clip( (0.25 S_tier + 0.30 S_corr + 0.20 S_prim
                         + 0.10 S_time + 0.15 S_cons) * S_retr * partisan_penalty , 0, 1 )

C_news = 1 iff FactScore ≥ θ_fact(=0.65) ∧ claimClass=verified_fact
              ∧ theme ∈ crisis set ∧ age ≤ 72h
```

- Tiers: gov/wire **A** > major paper **B** > cable **C** > digital **D** > social **E** > satire **F**=0  
- Corroboration count, primary Fed/BOK/DART/EDGAR link, contradiction→contested, retraction penalty  
- FactScore < θ → **no** MOS Enter boost (PSY_RUMOR / FOMO guard); UI may show `unverified`  
- Automated: domain tier, age, dedupe, primary URL patterns. LLM/human: claim class, contradictions, Q=0 fraud  
- Cannot perfectly backfill-fact-check 10y without archives (GDELT/NewsAPI gaps in this study)
