# Leveraged / High-Multiple ETFs → Individual Stock Impact — MOS A′ research

**Date:** 2026-09-19 (KST)  
**Scope:** Personal alerts / scoring research only · **Paper/Live = FALSE** · **Not trading advice**  
**User:** SK An · Formula A′ **v1.1 balanced δ\*/σ_V LOCKED** — this memo **does not change** locked tables  
**Companion pointer:** appended to `MOS_FORMULA_A_PRIME.md` (appendix only)  
**Session gates:** interacts with `EXECUTION_SPIKE_AND_HOURS.md` (KR after 16–20, US extended)  
**Artifacts:** `data/lev_etf/` (close/volume ~2015→2026-09, corr_resid_flow, threshold_calib*, kr_*, ssl_adv_share, intraday_*, headline.json)

---

## 한국어 핵심 요약 (Executive)

1. **메커니즘:** 2x/3x 롱·숏 ETF는 **매일** 목표 배수를 맞추기 위해 기초(바스켓·스왑·선물)를 리밸런스한다. 지수↑ → 롱 레버리지 **추가매수**, 지수↓ → **매도**(숏은 반대). 장 마감 전·장중에도 노출이 어긋나면 헤지. 결과 = **같은 방향 증폭**, 횡보·고변동 시 **경로의존 감쇠(decay)**, 옵션 딜러 감마와 유사한 **추세추종형 헤지**.
2. **미국 실증 (yfinance ~10y, 일봉 프록시):** ETF 거래량×sign(지수수익)과 메가캡 **잔차상관은 ≈0** (생성/상환·실제 스왑 플로우 없음 → 프록시 한계). 그러나 **|지수|>1.5% ∧ 레버리지 ETF 거래량 z>2** 날에는 종목 |수익|이 일반 대변동일 대비 **약 1.2–1.5배** (TQQQ 바스켓 ~1.29, SOXL ~1.42). **다음날 부호연속(continuation)은 음수** → **평균회귀** 쪽 (TQQQ 조건 평균 cont ≈ **−1.1%**, hit연속 ≈41%).
3. **단일종목 레버리지 (NVDL/TSLL):** 기초와 일수익 상관 **~0.99**. 60d ADV$ 비중 NVDL/NVDA ≈ **1.7%**, TSLL/TSLA ≈ **5.5%**. 고거래량일 |기초| 이동 **~1.9–2.2배**. 지수형보다 **직접 충격**이 큼 → 스파이크 가드 강화 후보.
4. **한국:** KODEX/TIGER **코스피200·코스닥150 레버리지·인버스2X**는 선물·스왑 중심 → 삼성·하이닉스에 **간접**. 실증: |KS11|>1.5%∧KODEX레버 z>2 시 |종목| 약 **1.07–1.19배**, 다음날 cont 음수. **단일종목 레버리지 ETF**(KODEX/TIGER 삼성·하이닉스 등)는 2024–26 소매 유입·종가 리밸런스 집중 → 업계가 **장중·장후 분산** 합의(보도). KRX 애프터(16–20)는 ETF 초기 제외이나 **기초주식**은 거래 → NXT/애프터와 정규 종가 압력 분리 필요.
5. **MOS 제안 (미잠금):** `C_lev_rebal` — 장 마감 Y분 Enter 차단/반사이즈; `C_ssl_lev` — 단일종목 레버 ADV 비중 > Z% 시 스파이크 가드 확대. **δ\*/σ_V 표 불변.** Paper/Live OFF.
6. **정직 한계:** 진짜 creation/redemption·스왑 노셔널·LP 헤지 타임스탬프 없음. 거래량 프록시. 인트라데이는 yfinance 5m **~60일**만.

---

## English executive bullets

- Daily reset of 2x/3x products → procyclical buy/sell of basket/swaps/futures; amplifies moves; path-dependent decay; gamma-like hedging.
- Crude flow proxy (ETF vol × sign(index)) ≈ **uncorrelated** with mega-cap residuals — **expected** without C/R data.
- On **|index|>1.5% & lev ETF vol z>2**: same-day |stock| ≈ **1.2–1.5×** baseline big days; **next-day signed continuation negative** (mean reversion), esp. TQQQ basket (~−1.1% avg cont, ~41% cont hit).
- Single-stock levered (NVDL/TSLL): direct; ADV$ share ~**1.7% / 5.5%**; |stock| amp ~**1.9–2.2×** on ETF vol spikes.
- KR index levered: milder amp (~1.07–1.28); single-stock KR levered products matter more for 삼성/하이닉스 at the close (news + industry rebalance dispersion).
- Propose **not locked** `C_lev_rebal` / `C_ssl_lev`; wire with sessionGate (no Enter in KR after / last-Y-min RTH caution).

---

## 0. Locked A′ v1.1 — do not touch

Locked: δ\* by sector, σ_V map, ε, f_max, krMinSF, PSY_* defaults.  
This file only proposes **execution / checklist modifiers** for later optional lock.

---

## 1. Mechanism

### 1.1 Daily leverage reset (core)

| Step | Long L× ETF (e.g. TQQQ L=3) | Inverse −L× (e.g. SQQQ) |
|------|-----------------------------|-------------------------|
| Index up +r | Exposure under target → **buy** more exposure | Short exposure shrinks → **add shorts** (sell underlying) |
| Index down −r | Exposure over target → **sell** | Short exposure grows → **cover** (buy) |
| Timing | Mandate is **daily**; large AUM → concentrated near **close**; intraday NAV/leverage drift → opportunistic rebalance | Same |

Approximate **notional rebalance** for a long L× fund with AUM A after underlying move r:

\[
\Delta \approx A \cdot L \cdot (L-1) \cdot r
\]

(for small r; sign follows r for long products). Both long and short levered complexes can be **net sellers into declines** (longs delever; shorts may add), which is why drawdowns feel “air-pocketed.”

### 1.2 Amplification, decay, gamma-like hedging

| Concept | Meaning for single names |
|---------|--------------------------|
| **Amplification** | Same-direction flow into index **weights** (NVDA, AAPL, …) near the close on trend days. |
| **Decay / volatility drag** | Multi-day hold of levered ETF ≠ L× multi-day index; **stocks** feel this indirectly via repeated rebalance churn, not via ETF NAV math itself. |
| **Gamma-like** | Hedge ratio rises with |move| → **buy strength / sell weakness**, similar in sign to short-gamma dealer hedging, different institutional source. Literature and sell-side notes increasingly put **LET F rebalance** beside (sometimes above) options gamma for EOD volatility on large |index| days. |
| **Swaps / futures** | Many products use total-return swaps or index futures → pressure hits **futures/ETF arb complex** first, then cash basket (including mega-caps). |

### 1.3 Index-levered vs single-stock levered

| Type | Path to named stock | MOS severity |
|------|---------------------|--------------|
| **Index / sector levered** (TQQQ, SOXL, KODEX 200 Lev) | Weight × rebalance notional | Medium — diluted across basket; still material for top weights on big days |
| **Single-stock levered** (NVDL, TSLL, KODEX/TIGER 삼성·하이닉스 레버) | Direct hedge of **that** name (shares/swaps/futures) | **High** — widens spike guards; close auction sensitive |

---

## 2. US map (examples → named stock)

| Product | Multiple | Underlying | Named stocks (impact channel) |
|---------|----------|------------|--------------------------------|
| **TQQQ / SQQQ** | +3× / −3× | Nasdaq-100 (QQQ) | **AAPL, NVDA, MSFT, META, AMZN, GOOGL, TSLA** (and other NDX weights) via basket/swap |
| **SOXL / SOXS** | +3× / −3× | ICE Semiconductor index (≈ SMH proxy) | **NVDA, AMD, AVGO, TSM**, … |
| **SPXL / SPXS** | +3× / −3× | S&P 500 | Mega-caps by SPX weight (diluted vs NDX/semis) |
| **UVXY / SVIX** | ~+1.5× VIX ST futures / −1× | Vol futures | Not a stock basket; risk-off days → equity beta dump (NVDA/QQQ soft). Empiric: UVXY vol z>2 → same-day SPY ≈ **−0.9%**, NVDA ≈ **−1.6%** |
| **NVDL** | +2× | **NVDA** | Direct |
| **TSLL** | +2× | **TSLA** | Direct |

**Honesty:** Holdings weights and swap books change; TQQQ does **not** hold a clean 3× share of each name in cash.

---

## 3. Korea map

| Product (examples) | Ticker (Yahoo) | Underlying | Channel to 삼성/하이닉스 |
|--------------------|----------------|------------|-------------------------|
| KODEX 레버리지 | 122630.KS | KOSPI200 (~2×) | Futures/swap → **간접** (005930 high K200 weight) |
| KODEX 200선물인버스2X | 252670.KS | −2× K200 futures | Inverse rebalance |
| KODEX 코스닥150 레버리지 | 233740.KS | KQ150 2× | Weaker Samsung beta; still risk-on spillover |
| TIGER / RISE / KIWOOM 동류 | various | same | Parallel AUM |
| **반도체 섹터 ETF·레버** (KODEX/TIGER 반도체 등) | — | KRX Semiconductor | **Cap rebalance** (20% weight) can force large **삼성·하이닉스** sells near close on reconstitution (2025–26 press: ~₩1.4–1.7T estimates — **index reconstitution**, not only daily leverage) |
| **단일종목 레버리지** (KODEX/TIGER 삼성전자·SK하이닉스 레버 등) | various | Single name 2× | **Direct**; 2025–26 retail surge; industry agreement to **disperse** rebalance through the day **and after close** to cut close volatility |

### NXT / KRX after-hours (interaction)

- **KRX After-Market 16:00–20:00** (live since 2026-09-14): continuous, limit-only; **ETF/ETN initially excluded** — so levered **ETF shares** may not trade after, but **underlying stocks** do → residual hedging / LP / retail can still hit 삼성·하이닉스 after the regular close.
- **NXT** pre/after overlaps: thin book → treat like after: **Enter auto OFF** (see `EXECUTION_SPIKE_AND_HOURS.md`).
- Daily leverage reset for KR products historically clustered near **regular close (15:20–15:30 auction)**; dispersion into after reduces auction impact but **extends** pressure into 16–20.

---

## 4. Empirical design (yfinance)

### 4.1 What we can / cannot measure

| Have | Do not have |
|------|-------------|
| Daily OHLCV ~2015-01 → 2026-09-18 for US lev ETFs + mega-caps; KR KODEX lev/inv + 005930/000660 | True creation/redemption, authorized participant flow |
| Crude **flow proxy** = `ETF_volume × sign(index_return)` and volume z-score (60d) | Swap notional, futures lot timestamps |
| Stock **residual** = \(r_i - \hat\beta_{60} r_{\text{index}}\) | Clean causal ID of LETF-only flow |
| 5-minute bars ~**60 sessions** (intraday last-30/60m) | Multi-year EOD auction microstructure |

### 4.2 Same-day residual vs flow proxy

**Result:** corr(residual, flow_z) ≈ **0** for TQQQ/SOXL/SPXL baskets (range roughly −0.04…+0.02).  

→ Volume×sign is a **weak residual predictor**. Still useful as a **regime flag** when combined with |index| (section 4.3).

Single-stock: corr(NVDA, NVDL flow_z) / TSLA–TSLL elevated because the ETF **is** the stock’s leveraged twin (corr of raw returns ~0.99).

### 4.3 High |index| ∧ levered volume spike → amplification + next day

Definition: **both** = `|r_index| > 1.5%` AND `vol_z(ETF) > 2`.

| ETF | Stocks (mean) | n_both (mean) | amp_ratio \|r_stock\| | next-day cont (sign(idx)×r_stock) | cont hit |
|-----|---------------|---------------|----------------------|-----------------------------------|----------|
| TQQQ | NDX mega 7 | 110 | **1.29** | **−1.06%** | ~41% |
| SOXL | NVDA AMD AVGO TSM | 146 | **1.42** | **−0.62%** | ~46% |
| SPXL | AAPL MSFT AMZN NVDA | 78 | **1.25** | **−0.95%** | — |
| SQQQ | mega 4 | 125 | **1.19** | **−0.75%** | — |
| NVDL | NVDA | 54 | **1.68** | **−1.19%** | — |
| TSLL | TSLA | 78 | **1.71** | ~0 | — |

Per-name TQQQ examples (n_both=110): NVDA cont_both **−2.11%**, AAPL **−0.84%**, MSFT **−0.91%**, TSLA **−1.03%**.

**Interpretation for MOS:** On these days, **do not treat late-day washouts as clean MOS bargains** — flow-amplified; next session leans **mean reversion**, not continuation. Prefer wait / size cut / block Enter in last Y minutes.

### 4.4 Threshold calibration (Enter-block candidates)

Mean across holdings:

| ETF | \|r_idx\| X | vol z Z | n | cont | cont hit | same-day \|r\| |
|-----|-------------|---------|---|------|----------|----------------|
| TQQQ | 1.5% | 2.0 | 110 | −1.06% | 40.8% | 4.04% |
| TQQQ | 2.0% | 2.5 | 52 | −1.06% | 40.4% | 4.59% |
| SOXL | 1.5% | 2.0 | 146 | −0.62% | 46.4% | 4.41% |
| SOXL | 2.0% | 2.5 | 76 | −0.70% | 49.7% | 4.81% |

**Draft default:** X=**1.5%**, Z=**2.0** (enough n; clear negative cont for TQQQ). Stricter X=2%/Z=2.5 if alert fatigue.

### 4.5 Intraday (60d, 5m) — limited

| Metric | Value |
|--------|-------|
| Days | 60 |
| Days \|QQQ\|>1.5% | **4** (underpowered) |
| Mean TQQQ volume share in last 60m | ~13%; on \|QQQ\|>1.5% days ~**15.5%** |
| corr(NVDA last60, QQQ last60) | **0.80** |
| Mean fraction of QQQ day move in last 60m on big days | noisy (mean ~0.17, med negative) |

→ Use intraday only as **soft confirm** until longer tape available; daily **both** flag is primary.

### 4.6 Korea empirics

| ETF | Stock | n | amp_ratio both | cont_both |
|-----|-------|---|----------------|-----------|
| 122630.KS (Lev) | 005930 | 2803 | 1.08 | −0.52% |
| 122630.KS | 000660 | 2803 | 1.07 | −0.75% |
| 252670.KS (Inv2X) | 005930 | 2379 | 1.19 | −0.51% |
| 252670.KS | 000660 | 2379 | 1.13 | −0.99% |
| 233740.KS (KQ150 Lev) | 000660 | 2564 | 1.28 | −1.12% |

Milder than US 3× semis/NDX — consistent with **2×** and futures-based implementation. Still: **negative next-day cont** under the same flag.

### 4.7 Single-stock levered ADV share (60d $)

| ETF | Stock | ETF ADV$ | Stock ADV$ | Share | \|r\| amp on ETF volz>2 |
|-----|-------|----------|------------|-------|-------------------------|
| NVDL | NVDA | ~$0.46B | ~$26.9B | **1.7%** | **1.89×** vs all-days |
| TSLL | TSLA | ~$0.78B | ~$14.1B | **5.5%** | **2.24×** |

Draft **C_ssl_lev** when share > **3%** (TSLL territory) or when share > **1.5%** AND volz>2 (NVDL).

---

## 5. MOS implications

### 5.1 When to avoid Enter near close

| Situation | Action (proposed) |
|-----------|-------------------|
| `C_lev_rebal` fires (below) | **Block new Enter** in last **Y=30 min** RTH (US); KR last **20 min** before 15:20 auction + auction itself |
| Soft alternative | `f ← 0.5·f` + `needsReconfirm` if user wants alerts-only block |
| Next day after fire | Prefer wait for open+15m / spikeGate clear (mean-reversion drift) before sizing full f |

### 5.2 Session gate interaction

Already in `EXECUTION_SPIKE_AND_HOURS.md`:

- KR **애프터 16–20**: Enter OFF default — **reinforced** on days when daytime lev products printed huge volume (after-hours stock prints can be LP/hedge leftovers).
- US extended / future overnight: alerts OK; Enter OFF — levered ETF NAV games overnight are worse.
- `Enter_i` ≠ order-now: must pass **sessionGate ∧ spikeGate ∧ (optional) levGate**.

### 5.3 Index-levered vs single-stock levered

| | Index / sector lev | Single-stock lev |
|--|--------------------|------------------|
| Primary bit | `C_lev_rebal` | `C_ssl_lev` |
| Spike guards | Standard + optional last-Y-min block | **Widen** SPIKE_1M / SPIKE_SIG (e.g. 2.0%→**1.5%**, 3%→**2%**) when ssl share high |
| Names | All top holdings of that index | **Only** the underlying ticker |

---

## 6. Proposed bits (NOT LOCKED)

Does **not** change locked δ\*/σ_V. Paper/Live OFF. Modifiers first; checklist membership only after paper replay.

### 6.1 `C_lev_rebal` (index / sector levered pressure)

```
# Per market m, watchlist of levered ETFs L_m
# US examples: TQQQ, SOXL (optional SPXL); KR: 122630.KS, 233740.KS (+ inverse for volume z only)
vol_z_L = zscore_60(volume[L])
r_idx   = daily return of mapped index (QQQ / SMH / KS11 / KQ11)

C_lev_rebal = 1 iff
    max_L vol_z_L >= 2.0
    AND |r_idx| >= 0.015
```

| Param | Draft | Alt |
|-------|-------|-----|
| \|r_idx\| | **1.5%** | 2.0% |
| vol z | **2.0** | 2.5 |
| Last-Y-min Enter block | US **30 min**; KR **20 min** pre-auction | 60 / 30 |
| Effect | **Block Enter** in window; else `f←0.5·f` | UI severity only |
| Inverse ETFs | Count toward **volume z** (activity), same \|r_idx\| gate | — |

### 6.2 `C_ssl_lev` (single-stock levered)

```
share = ADV$'_60(ssl_etf) / ADV$'_60(stock)
C_ssl_lev = 1 iff share >= 0.03
            OR (share >= 0.015 AND vol_z(ssl_etf) >= 2)
```

| Param | Draft |
|-------|-------|
| Z share hard | **3%** (TSLL-like) |
| Soft share + volz | **1.5%** + z≥2 (NVDL-like) |
| Effect | Widen spike: SPIKE_1M **1.5%**, SPIKE_SIG **2.0%**; optional last-Y-min block on underlying |
| KR | Apply when single-stock lev AUM/ADV feeds exist (Naver/KRX) — yfinance coverage uneven |

### 6.3 Bundle name `C_lev_etf` / flow from leveraged products

Parent pointer label: **Proposed (not locked): C_lev_etf / flow from leveraged products**  
= `{ C_lev_rebal, C_ssl_lev }` as a package for v1.2+ wiring after Mac lands v1.1 balanced.

### 6.4 Scored object fields (draft)

```json
{
  "levGate": {
    "C_lev_rebal": 1,
    "C_ssl_lev": 0,
    "etf": "TQQQ",
    "volZ": 2.4,
    "indexRet": -0.018,
    "enterBlockedUntilKst": "2026-09-19T16:00:00+09:00",
    "sizeMult": 0.5
  }
}
```

---

## 7. Data limits (honesty)

1. **No true AP creation/redemption** — volume proxy mixes noise traders, HFT arb, and real hedge.
2. **Swaps/futures** may hit cash stocks with lag / via arb — residual corr≈0 is expected.
3. **Intraday sample 60d** — last-30/60m conclusions underpowered (only 4 big QQQ days).
4. **KR single-stock lev tickers** — AUM and exact Yahoo symbols change rapidly; treat news + exchange disclosures as primary for 2025–26 microstructure.
5. **Sector index reconstitution** (KRX Semiconductor 20% cap) ≠ daily leverage — separate calendar event risk.
6. Not investment advice; Paper/Live remain **FALSE**.

---

## 8. Open before any lock

1. Paper replay on MOS individual-stock event set with stub `C_lev_rebal` / `C_ssl_lev`.  
2. Longer intraday (broker/Polygon) for last-30m fraction on both-flag days.  
3. Optional paid flow (ETF.com create/redeem, KRX investor types).  
4. User explicit choose to promote modifiers → checklist (KR S_F floor interaction).  
5. Wire UI only after Mac `mosOpportunityScore.js` v1.1 balanced lands.

---

## 9. Artifact index

| File | Content |
|------|---------|
| `data/lev_etf/close.csv`, `volume.csv` | Panel |
| `data/lev_etf/corr_resid_flow.csv` | US pair stats |
| `data/lev_etf/kr_corr_resid_flow.csv` | KR pair stats |
| `data/lev_etf/threshold_calib.csv`, `threshold_calib_agg.csv` | X/Z grid |
| `data/lev_etf/ssl_adv_share.csv` | NVDL/TSLL ADV share |
| `data/lev_etf/intraday_summary.json` | 60d 5m |
| `data/lev_etf/headline.json` | Rollup |
