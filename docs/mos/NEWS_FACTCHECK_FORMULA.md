# Fact-check formula (proposed) — MOS news gate

**Date:** 2026-09-19 (KST)  
**Scope:** Alerts / scoring only · Paper/Live OFF · **Not trading advice**  
**Status:** **PROPOSAL only** — does **not** lock or alter A′ v1.1 balanced δ*/σ_V  
**Related:** `NEWS_RATES_BONDS_CORR_10Y.md` · `MOS_FORMULA_A_PRIME.md` (C_news)

---

## 0. Goal / non-goal

**Goal:** Score each news item or claim-cluster for **factual reliability** before it may set `C_news=1` or firm tags (`Q`, `C_firm_ext`). Reduce FOMO enters driven by rumor, satire, single-partisan takes, or stale recycled headlines.

**Non-goals:** Perfect historical fact-check of 10y archives (we lack full KR/US outlet backfill — see corr report gaps). Not a legal truth oracle. Not auto-trading.

```
FactScore ∈ [0, 1]
ClaimClass ∈ { verified_fact, contested, rumor, opinion, satire, outdated, unknown }

C_news = 1  iff
    FactScore ≥ θ_fact
    AND ClaimClass ∈ { verified_fact }           # contested never alone
    AND theme ∈ CrisisThemeSet
    AND age_hours ≤ 72
    AND NOT blocked_by_psychology_rumor

# Proposed default
θ_fact = 0.65     # enter-eligible
θ_fact_ui = 0.40  # show in UI as "unverified / watch" but C_news stays 0
```

**Psychology / FOMO:** If `FactScore < θ_fact`, news **must not** boost MOS Enter (`C_news` stays 0; no `C_firm_ext` from that cluster). UI may still surface the headline with badge `unverified`.

---

## 1. Claim cluster (unit of scoring)

Aggregate near-duplicate headlines into one **cluster** within a 6h window (simhash / embedding cosine / canonical entity+event key).

| Field | Example |
|-------|---------|
| `cluster_id` | `tariff_cn_2026-04-03_a` |
| `canonical_claim` | "US announces X% tariff on CN goods effective date D" |
| `theme` | tariff \| Fed \| inflation \| bank \| war \| NK \| KR \| China \| COVID \| other |
| `first_seen` / `last_seen` | timestamps |
| `items[]` | per-article: source_id, url, published_at, lang, raw_text |
| `primary_docs[]` | Fed/BOK/EDGAR/DART/customs links if found |
| `contradictions[]` | opposing claims from ≥ tier-B sources |

CrisisThemeSet (aligns with corr study): `{tariff, China, COVID, Fed, inflation, bank, war, KR}`  
**NK alone ∉ effective crisis for C_news** unless FX/equity confirm (see corr report) — still fact-scored for UI.

---

## 2. ClaimClass (discrete label)

| Class | Meaning | Can set C_news? |
|-------|---------|-----------------|
| **verified_fact** | Corroborated report of an observable event/decision; or primary-doc backed | Yes if FactScore≥θ |
| **contested** | Major outlets disagree on material numbers/actors/dates | No (UI only) |
| **rumor** | Unnamed sources only; social origin; " reportedly planning" w/o confirm | No |
| **opinion** | Analysis, op-ed, prediction, should/would | No |
| **satire** | Known satire domain or satire markers | No (+ hard block) |
| **outdated** | Event >72h or superseded by newer official update | No for C_news |
| **unknown** | Insufficient metadata | No |

Hard rules (deterministic):
- Domain ∈ satire_list → `satire`, FactScore:=0  
- `age_hours > 72` and no new primary confirm → at best `outdated` for C_news  
- Only blogs/social in cluster → max class `rumor`  
- Op-ed section / "opinion" tag → `opinion` even if reputable outlet  

---

## 3. Source tier weights

| Tier | Examples | `w_src` |
|------|----------|--------|
| **A — primary / wire / official** | Fed, BOK, White House, MOFE, customs/무역, EDGAR, DART, 한은, Reuters/AP/Yonhap *wire copy*, Bloomberg *market wire* | **1.00** |
| **B — major paper** | NYT, WSJ, WP, FT, 조선/중앙/한겨레/한국경제/매일경제 (news, not column) | **0.75** |
| **C — broadcast / cable biz** | CNN, CNBC, Fox Business, BBC, NHK, KBS/MBC/SBS news | **0.55** |
| **D — digital native / aggregator** | Axios, Politico, Naver syndication of B/C, Yahoo Finance reprint | **0.40** |
| **E — blog / Substack / social / anonymous** | Twitter/X, Telegram, cafes, unverified YouTube | **0.10** |
| **F — satire / known hoax** | Onion-class, parody handles | **0.00** |

`source_tier_score` = max `w_src` in cluster (primary ceiling) × soft boost from diversity:

```
tier_div = 1 + 0.1 * min(2, n_distinct_tiers_among_A_B_C - 1)
source_component = min(1.0, max_w_src * tier_div)
```

**Partisan single-source penalty:** if cluster has **only one** outlet and that outlet is on a user-maintained "high-partisan / advocacy" list (either side), multiply FactScore by **0.70** after mix. Wires/gov exempt.

---

## 4. FactScore formula (proposed)

```
# Components ∈ [0,1]
S_tier   = source_component                         # §3
S_corr   = corroboration_score                      # §5
S_prim   = 1.0 if primary_doc_link else 0.0         # §6
S_time   = time_to_confirm_score                    # §7
S_cons   = 1.0 - contradiction_penalty              # §8
S_fresh  = 1.0 if age_hours ≤ 72 else 0.0           # hard for C_news
S_retr   = retraction_multiplier                    # §9  (≤1)

# Mix (weights sum to 1.0 before retraction)
FactScore_raw =
    0.25 * S_tier
  + 0.30 * S_corr
  + 0.20 * S_prim
  + 0.10 * S_time
  + 0.15 * S_cons

FactScore = clip( FactScore_raw * S_retr * partisan_penalty , 0, 1 )

# Gate
if ClaimClass != verified_fact: FactScore usable for UI only; C_news := 0
if S_fresh == 0: C_news := 0
```

**θ_fact = 0.65** proposed for `C_news=1`.  
Rationale: needs roughly (tier B+ with 2-source corroboration) **or** (tier A primary doc) without contradictions/retractions. Single cable hit ≈ 0.55×… typically **below** θ → no Enter boost (FOMO guard).

---

## 5. Corroboration (`S_corr`)

Count **independent** sources (distinct org, not reprints of same wire):

| `n_indep` (tier≥C) | `S_corr` |
|--------------------|---------|
| 0 | 0.00 |
| 1 | 0.35 |
| 2 | 0.70 |
| ≥3 | 1.00 |

Bonus: +0.10 (cap 1.0) if ≥1 KR **and** ≥1 US outlet agree on material facts (useful for EWY/KR names — tariff study).  
Reprints of same AP/Reuters text count as **1**.

---

## 6. Primary document (`S_prim`)

`primary_doc_link = true` if cluster links or quotes identifiable:

- Fed FOMC statement / SEP / financial stability page  
- BOK 보도자료 / 기준금리 결정문  
- Company 8-K / DART 공시 / customs·산업부 trade notice  
- Court docket / official gazette  

Screenshot-only social posts ≠ primary. LLM-extracted "according to filing" without URL → `S_prim=0.5` provisional until link resolved.

---

## 7. Time-to-confirm (`S_time`)

```
t_confirm_h = hours from first_seen to (second indep tier≥B OR primary_doc)
S_time = 1.0 if t_confirm_h ≤ 2
       = 0.7 if ≤ 12
       = 0.4 if ≤ 48
       = 0.2 if ≤ 72
       = 0.0 else
```

Fast dual-wire or official drops score high; slow single-blog amplification scores low.

---

## 8. Contradiction (`S_cons`)

If ≥1 tier≥B source **materially contradicts** (different tariff %, different bank failed, opposite rate decision):

```
contradiction_penalty = 0.50   # contested
ClaimClass := contested
```

If contradiction vs **primary official** doc: penalty **0.80**, prefer official (ClaimClass may stay verified_fact on the official version; outlier item demoted).

---

## 9. Retraction / correction (`S_retr`)

| Event | `S_retr` |
|-------|---------|
| None | 1.00 |
| Correction of non-material detail | 0.90 |
| Correction of material number/actor | 0.50 |
| Full retraction | 0.00 for 7d on that cluster_id |
| Source later labeled satire | 0.00 |

---

## 10. Worked examples (illustrative)

| Scenario | Approx FactScore | C_news? |
|----------|----------------:|---------|
| Reuters + WSJ + Fed statement, tariff theme, 3h old | ~0.90 | **Yes** |
| Single CNBC tease, "sources say Fed emergency", no second source | ~0.35–0.45 | No (UI watch) |
| NK missile rumor on Telegram only | ≤0.15, class rumor | No |
| Op-ed "market should crash" in major paper | class opinion | No |
| Two papers disagree on tariff rate | contested, S_cons low | No |
| Correct story but 5 days old | outdated for gate | No |
| SVB failure day: AP + WSJ + FDIC note | ~0.85+ | **Yes** |

---

## 11. Automation vs human / LLM review

| Step | In-app automated | LLM-assisted | Human required |
|------|------------------|--------------|----------------|
| Ingest RSS / adapter items, dedupe cluster | **Yes** | — | — |
| Source tier lookup (domain allowlist) | **Yes** | — | Maintain lists |
| age_hours, satire domain block | **Yes** | — | — |
| Count distinct domains / wire fingerprint | **Yes** | — | — |
| Detect primary URL patterns (fed.org, bok.or.kr, sec.gov, dart) | **Yes** | — | — |
| Theme classify (keyword + small model) | Partial | **Yes** refine | Spot-check |
| ClaimClass opinion vs fact | Weak heuristics | **Yes** | Edge cases |
| Material contradiction detection | Hard | **Yes** pairwise | Escalate contested |
| Partisan-list / advocacy labeling | Config | — | **Yes** curate |
| Firm fraud / going-concern → Q=0 | Tags from filings | LLM on 8-K/DART | Confirm before hard Q=0 |
| Historical 10y re-score | **No** (archives incomplete) | — | N/A |

**Honest limit:** Without paid news archives and KR headline dumps, we **cannot** perfectly fact-check past decades for backtest. Live forward scoring is the design target; paper replay uses stub FactScore=1 on curated calendar events only.

---

## 12. API shape (draft)

```json
{
  "clusterId": "tariff_cn_2026-04-03_a",
  "canonicalClaim": "…",
  "theme": "tariff",
  "claimClass": "verified_fact",
  "factScore": 0.82,
  "thetaFact": 0.65,
  "components": {
    "S_tier": 0.85, "S_corr": 0.70, "S_prim": 1.0,
    "S_time": 1.0, "S_cons": 1.0, "S_retr": 1.0,
    "partisanPenalty": 1.0
  },
  "corroborationCount": 2,
  "primaryDocLink": "https://…",
  "ageHours": 4.2,
  "cNewsEligible": true,
  "uiBadge": "verified|watch|rumor|opinion|contested|outdated",
  "paperLive": false
}
```

---

## 13. Wiring into MOS A′ (proposal)

```
# existing
C_news_raw = theme∈Crisis ∧ age≤72h

# proposed gate
C_news = C_news_raw ∧ (FactScore ≥ θ_fact) ∧ (claimClass == verified_fact)

# firm tags
C_firm_ext requires FactScore ≥ θ_fact (same θ) on firm-specific cluster
Q := 0 on fraud/going-concern only if claimClass==verified_fact ∧ (S_prim==1 ∨ corroborationCount≥2)
     else flag needsHumanReview (do not auto Q=0 on rumor)

# psychology
PSY_FOMO already blocks when F&G≥75 ∧ F_mkt=0
ADD: PSY_RUMOR — if user would have received C_news from FactScore∈[θ_fact_ui, θ_fact),
     suppress Enter boost; show "미검증 뉴스" badge (KR) / "unverified" (EN)
```

No change to locked δ*, σ_V, ε, f_max, KR S_F≥3.

---

## 14. Open before any lock

1. Finalize domain→tier tables (US + KR) in config JSON  
2. Wire fingerprint rules (AP/Reuters/Yonhap)  
3. θ_fact sensitivity on paper alerts (0.55 vs 0.65 vs 0.75)  
4. LLM vendor choice + PII/policy for headline text  
5. User explicit lock → v1.2 news gate  

**Disclaimer:** Proposal for personal alert hygiene. Not a guarantee against falsehoods. Paper/Live remain OFF.
