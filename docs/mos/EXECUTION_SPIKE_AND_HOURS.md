# Execution Spike Guards & Tradable Sessions — MOS / alpha-trading-system-gemini

**Date:** 2026-09-19 (KST)  
**Scope:** Alerts + **future** paper/auto execution policy only · **Paper/Live = FALSE** · **NO real orders**  
**User:** SK An · Companion to locked A′ v1.1 (`MOS_FORMULA_A_PRIME.md`) — **does not change δ\*/σ_V**  
**Honesty:** Not legal advice. Exchange calendars and session rules change — **re-verify against KRX / NXT / NYSE / Nasdaq** at implement time.

---

## 한국어 핵심 요약

1. **`Enter_i = true` ≠ 지금 주문.** 세션 게이트 + 급등락(스파이크) 게이트 + (후보) 유동성/실적/수급 필터를 모두 통과해야 실행 후보.
2. **알림은 24/7 가능.** **실행 창(execution window)** 은 별도. Paper/Live는 문서·설정 모두 **FALSE**.
3. **한국 (2026-09-14~ 라이브):** KRX 정규 09:00–15:30 · 장후 시간외종가 ~15:30–16:00 · **KRX 애프터마켓 16:00–20:00** (구 시간외단일가 16–18 **폐지**). 애프터는 **지정가만**, 시장가 불가, ±30%+VI, ETF/ETN 초기 제외. KRX 프리마켓은 **미개시(~2027말 목표)**. NXT는 프리·애프터로 중복 거래소.
4. **미국:** 현재 전형적 프리 04:00–09:30 ET / RTH 09:30–16:00 / 애프터 16:00–20:00. Nasdaq·NYSE Arca **23/5**(야간 21:00–04:00)은 SEC 승인·목표 **2026-12-06** — **2026-09-19 기준 미라이브**.
5. **MOS 기본 정책:** RTH(정규)만 Enter 자동 적격(Live 언젠가). **KRX 애프터 = 알림 OK / Enter 자동 OFF**(또는 반사이즈+지정가만). **US overnight(라이브 후) = 알림만**. Exit는 급락 시 제한적 허용(슬리피지 캡).

---

## 0. Hard rules (all modes)

| Flag | Value | Meaning |
|------|-------|---------|
| `paperLive` | **false** | No broker submit path enabled |
| `allowRealOrders` | **false** | Forever until separate user gate |
| Mode today | **alerts + policy doc** | Score / UI / future paper sim only |

When Live is someday enabled: still require session gate + spike gate below. This file is the draft policy — **not** an enablement.

---

## A. Spike / crash guards at fill attempt

Align with existing **PSY_CHASE** (bounce from 5d low > **+8%** → half-size or `needsReconfirm`). Add **intrabar / order-window** rules that fire at the moment of intended fill (not only on daily bar).

### A.1 Definitions

| Symbol | Meaning |
|--------|---------|
| `P_sig` | mid (or last) at signal / Enter alert time |
| `P_win0` | last at open of order window (when fill attempt starts) |
| `P_last` | last trade (or mid if no print) at decision |
| `Δ_t%` | `(P_last / P_ref − 1) · 100` vs chosen ref |
| Order window | contiguous attempt period, default **3 min** or until cancel |

### A.2 Entry abort / defer (chase & gap)

**Defaults (proposed, not locked):**

| ID | Trigger | Action | Rationale |
|----|---------|--------|-----------|
| **SPIKE_1M** | last ≤ **60s** move from `P_win0` ≥ **+2.0%** | **Abort Enter**; defer | Intrabar chase — too fast to size safely |
| **SPIKE_SIG** | `P_last` ≥ `P_sig` · (1+**0.03**) i.e. **+3%** since signal | **Abort Enter**; `needsReconfirm` | Aligns under PSY_CHASE; tighter than 5d +8% |
| **GAP_OPEN** | official open vs prior close **gap > +2.0%** and fill attempt in first **15 min** of RTH | **Defer** until after 15 min **or** next bar confirm | Opening auction noise / gap fill risk |
| **PSY_CHASE** | bounce from 5d low > **+8%** (existing) | `f ← 0.5·f` OR reconfirm | Daily-horizon chase; keep |
| **CRASH_ENTRY** | ≤ **60s** move ≤ **−3.0%** from `P_win0` while Enter pending | **Abort Enter** (do not “catch falling knife” on auto) | Crash during buy attempt |

**Re-arm after spike abort:** wait **M = 15 minutes** **or** next **1-bar** close confirms price ≤ signal mid · 1.01 (whichever later). Then clear SPIKE_* flags; PSY_CHASE / QCOOL still apply.

### A.3 Exit urgency vs abort

| Situation | Policy (default) |
|-----------|------------------|
| **Sell on crash** (stop / Q→0 / hard exit) | **Allow** marketable **limit** (not naked market): limit = `P_last · (1 − slip_max)`. Urgency = high. |
| **Spike-up at take-profit** | **Allow sell** (take the gift). Prefer limit at mid or better; no abort for “too high”. |
| **Spike-up at stop** (price rockets through stop the wrong way for a short, or gap-up on long stop-not-hit) | Long sleeve: stop is downside — spike-up → **cancel stop-market temptation**; leave TP logic. If stop was already marketable and price spiked **up** after signal to sell: **do not chase higher to sell** — re-check if exit still required. |
| **Soft TP only** (d ≤ 0.05 hint) | On spike-up: allow; on crash during soft TP: **accelerate** to hard exit rules. |

**Max slippage (exit):**

| Venue / session | `slip_max_bps` (default) | Notes |
|-----------------|--------------------------|-------|
| KR / US **RTH** | **25 bps** (0.25%) | Marketable limit cap |
| KR **애프터마켓** / NXT after | **40 bps** | Thinner book |
| US **pre / post** | **50 bps** | Liquidity warning |
| US **overnight** (post-2026-12-06 if Live) | **N/A — Exit alert only** default | No auto fill |

If marketable limit would exceed slip_max → **pause 30s**, refresh, one cancel-replace; if still excess → alert human, do not widen beyond **1.5 × slip_max** without flag `forceExit=true` (Q=0 / circuit reopen exit).

### A.4 Circuit breaker / trading halt

| Event | Enter | Exit |
|-------|-------|------|
| Single-stock halt / VI pause / LULD pause | **No new Enter** | May **queue** for reopen (limit only); alert immediately |
| Market-wide halt | No new Enter | Queue Exit; no market orders |
| KR 동적/정적 VI during attempt | Abort Enter; Exit → wait VI end then marketable limit | |

### A.5 Order style, cooldown, slicing

| Rule | Default |
|------|---------|
| Enter order type | **Limit only** (all sessions). No market Enter. |
| Exit order type | Marketable **limit** (RTH); **limit only** in KR after-market / US extended |
| Cancel-replace cooldown | **≥ 5 s** between replace; max **3** replaces per window |
| Size vs ADV | If notional > **2%** of ADV20 → **slice**: prefer **VWAP-style** over 5–15 min (paper sim); else **one-shot** limit |
| TWAP/VWAP | Only when size gate trips; never for tiny alerts |

### A.6 Sudden −Y% in Z minutes during sell

**Default pick: accelerate exit** (not pause).

| Param | Value | Rationale |
|-------|-------|-----------|
| Y | **−2.5%** | Material dump during exit |
| Z | **3 minutes** | Short window |
| Action | Tighten limit toward last − slip_max; allow 1 extra replace; severity=`urgent_exit` | Pausing into a crash worsens fill for protective exits |
| Exception | If halt/VI → queue (cannot accelerate through halt) | Exchange constraint |

### A.7 Guard → alert payload fields (draft)

```json
{
  "spikeGate": {
    "passed": false,
    "codes": ["SPIKE_SIG"],
    "rearmAfterKst": "2026-09-19T11:00:00+09:00",
    "pctFromSignal": 3.4,
    "pct1m": 1.1
  }
}
```

---

## B. Tradable sessions

### B.1 Korea — verified 2026-09-19 KST

**Effective:** KRX After-Market **live since 2026-09-14**. Old **시간외단일가 16:00–18:00 ABOLISHED**.

#### KRX

| Session | Hours (KST) | Mechanics (summary) | MOS Alert | MOS Enter (future auto/paper) | MOS Exit (future) |
|---------|-------------|---------------------|-----------|-------------------------------|-------------------|
| 시가 단일가 (opening auction) | **08:30–09:00** | Single-price open | OK | **Defer** — no Enter until continuous RTH + gap check | Queue / after open |
| **정규장 RTH** | **09:00–15:30** | Continuous 09:00–15:20; closing auction 15:20–15:30 | OK | **Full eligible** (default auto window) | Full eligible |
| 종가 단일가 | **15:20–15:30** | Closing auction | OK | **No new Enter** (auction) | Limit OK if already exiting |
| 장후 **시간외 종가** | **~15:30–16:00** (호가 ~15:30; 체결 ~15:40–16:00) | Trade at **day close** only | OK | **Alert only** / no auto Enter | Optional Exit at close px if broker supports |
| **KRX 애프터마켓** | **16:00–20:00** | Continuous match; **limit only** (no market); ±30% + VI; most KOSPI/KOSDAQ; **ETF/ETN initially excluded** | **OK** | **OFF by default** (or half-size + limit-only if user opt-in later) | **Limit-only**, slip_max 40 bps; prefer if Q=0 / crash |
| KRX **프리마켓** | — | **Postponed (~end-2027)** — **NOT live** | N/A | N/A | N/A |
| Weekend / holiday | Closed | — | Alert OK (score) | No | No |

#### NXT (Nextrade) — dual venue note

| Session | Hours (KST, typical) | MOS note |
|---------|----------------------|----------|
| Pre | **~08:00–08:50** | Thin liquidity → **alerts OK; Enter auto OFF** |
| Main | **~09:00:30–15:20** | Overlaps KRX RTH; SOR may route — treat as RTH-class if depth OK |
| After | **~15:40–20:00** | Overlaps KRX after; ~600 names historically vs KRX broader after — **same policy as KRX after: Enter OFF default** |

**Policy:** MOS does not prefer NXT vs KRX for auto Enter. When Live someday, **default venue class = KRX RTH**. Dual quotes may diverge — spike gates use consolidated last if available, else selected venue last.

### B.2 United States — verified 2026-09-19

#### Current (LIVE now)

| Session | Hours (ET) | Liquidity | MOS Alert | MOS Enter (future) | MOS Exit (future) |
|---------|------------|-----------|-----------|--------------------|-------------------|
| **Premarket** | **04:00–09:30** | Thin; wide spreads | OK + **liq warning** | **OFF** (prefer RTH only) | Limit-only, slip 50 bps, only if `forceExit` |
| **RTH** | **09:30–16:00** | Primary | OK | **Full eligible** (default) | Full eligible |
| **After-hours** | **16:00–20:00** | Thin | OK + liq warning | **OFF** | Limit-only / forceExit |
| Weekend / holiday | Closed (broker overnight products vary) | — | Alert OK | No | No |

#### Planned 23/5 (NOT live as of 2026-09-19)

| Item | Detail |
|------|--------|
| Venues | Nasdaq / NYSE Arca (industry move) |
| Target effective | **2026-12-06** (SEC path approved; confirm at implement) |
| Day continuum | **04:00–20:00 ET** (early + RTH + late) |
| **Night / overnight** | **21:00–04:00 ET** |
| Pause | **20:00–21:00 ET** (clearing / date roll) |
| **MOS default when that goes live** | Overnight = **alerts only**; Enter auto **OFF**; Exit = alert queue unless `forceExit` + explicit opt-in |

### B.3 Cross-list / ADR

| Case | Policy |
|------|--------|
| KR name (e.g. 005930.KS) during **US** hours | Primary execution calendar = **KRX/NXT KST sessions**. US-hour moves → **alert only** unless user holds ADR/OTC separately. |
| ADR / US-listed KR (e.g. LGEOY) | Calendar = **US sessions**; MOS Enter still **RTH-only** default. |
| Same issuer both lines | Do **not** auto-arb; score both; Enter gate per **traded** ticker’s venue. |
| KR after-market reacting to US RTH | Alert storm OK; **no Enter** in KR after solely because US moved. |

---

## C. Interaction with MOS A′

```
Enter_i (A′ algebra)
  → psychology guards (PSY_*)
  → liq / earn / flow candidates (if wired; not locked)
  → sessionGate.passed
  → spikeGate.passed
  → executionCandidate (paper/Live still FALSE → emit alert + candidate flag only)
```

| Rule | Detail |
|------|--------|
| Enter_i true | **Necessary, not sufficient** for order |
| Alert | May fire **24/7** (news, score refresh, after-hours prints) |
| Execution window | Separate: default **KR RTH** / **US RTH** only for Enter |
| Paper/Live | Stay **FALSE** in config and docs |
| Locked A′ v1.1 | **δ\*, σ_V, ε, f_max, krMinSF unchanged** by this memo |

---

## D. Defaults summary JSON (app config snippet)

```json
{
  "version": "execution_spike_hours_draft_2026-09-19",
  "paperLive": false,
  "allowRealOrders": false,
  "sessionGate": {
    "kr": {
      "enterSessions": ["KRX_RTH"],
      "exitSessions": ["KRX_RTH", "KRX_AFTER", "NXT_AFTER"],
      "alertSessions": ["ANY"],
      "krxRth": { "start": "09:00", "end": "15:30", "tz": "Asia/Seoul" },
      "krxClosingAuction": { "start": "15:20", "end": "15:30" },
      "krxAfterCloseCross": { "start": "15:30", "end": "16:00", "label": "시간외종가" },
      "krxAfterMarket": {
        "start": "16:00",
        "end": "20:00",
        "effectiveFrom": "2026-09-14",
        "replaces": "시간외단일가_16_18_ABOLISHED",
        "limitOnly": true,
        "marketOrders": false,
        "priceBandPct": 30,
        "vi": true,
        "etfEtnIncluded": false,
        "enterAuto": "OFF",
        "enterAutoAlt": "HALF_SIZE_LIMIT_ONLY_OPT_IN"
      },
      "krxPreMarket": { "status": "POSTPONED", "target": "~end-2027", "live": false },
      "nxt": {
        "pre": { "start": "08:00", "end": "08:50", "enterAuto": "OFF" },
        "main": { "start": "09:00:30", "end": "15:20" },
        "after": { "start": "15:40", "end": "20:00", "enterAuto": "OFF" },
        "note": "dual_venue_overlap_with_KRX"
      }
    },
    "us": {
      "enterSessions": ["US_RTH"],
      "exitSessions": ["US_RTH", "US_PRE", "US_POST"],
      "alertSessions": ["ANY"],
      "pre": { "start": "04:00", "end": "09:30", "tz": "America/New_York", "enterAuto": "OFF" },
      "rth": { "start": "09:30", "end": "16:00", "enterAuto": "ON_WHEN_LIVE" },
      "post": { "start": "16:00", "end": "20:00", "enterAuto": "OFF" },
      "overnight23x5": {
        "live": false,
        "targetEffective": "2026-12-06",
        "night": { "start": "21:00", "end": "04:00" },
        "pause": { "start": "20:00", "end": "21:00" },
        "enterAuto": "OFF",
        "mode": "ALERTS_ONLY"
      }
    },
    "crossList": {
      "krPrimaryCalendar": "KST_KRX_NXT",
      "adrCalendar": "US",
      "noAutoArb": true
    }
  },
  "spikeGate": {
    "entryAbort1mPct": 2.0,
    "entryAbortSinceSignalPct": 3.0,
    "gapOpenDeferPct": 2.0,
    "gapOpenDeferMinutes": 15,
    "entryAbortCrash1mPct": -3.0,
    "psyChase5dPct": 8.0,
    "rearmMinutes": 15,
    "exitCrashAcceleratePct": -2.5,
    "exitCrashAccelerateMinutes": 3,
    "exitCrashAction": "ACCELERATE",
    "slipMaxBps": {
      "rth": 25,
      "krAfter": 40,
      "usExtended": 50
    },
    "cancelReplaceCooldownSec": 5,
    "maxReplacesPerWindow": 3,
    "enterOrderType": "LIMIT_ONLY",
    "exitOrderType": "MARKETABLE_LIMIT",
    "sliceIfNotionalPctOfAdv20": 2.0,
    "haltPolicy": { "enter": "BLOCK", "exit": "QUEUE_REOPEN" }
  }
}
```

---

## E. Implement checklist (Mac / app)

1. Keep `paperLive: false` in env + config.  
2. Wire `sessionGate` clocks with **DST-safe** `America/New_York` and `Asia/Seoul`.  
3. Holiday calendars: KRX + NYSE/Nasdaq — fetch or embed annual file; **do not hardcode only weekdays**.  
4. After 2026-12-06: feature-flag `us.overnight23x5.live` only after venue confirm.  
5. KR after-market: enforce limit-only in any future paper simulator.  
6. Unit-test spike: +2% / 1m abort; +3% since signal; gap +2% defer; −2.5% / 3m accelerate exit.  
7. Copy to `docs/EXECUTION_SPIKE_AND_HOURS.md` when landing.

---

## F. Open before any lock

1. User opt-in for KR after-market half-size Enter (default OFF).  
2. Broker-specific session support (which APIs allow 시간외종가 / after).  
3. Consolidated last vs venue last for spike %.  
4. Explicit lock gate — until then **proposal only**; A′ v1.1 balanced δ\*/σ_V untouched.

---

*Alerts + future paper/auto policy draft. Not investment or legal advice. Paper/Live remain FALSE. Verify KRX/NXT/NYSE/Nasdaq calendars at implement time.*
