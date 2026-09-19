/**
 * draw.js — 차트 줄긋기(드로잉) 레이어 (TradingView식 1단계: 쉬움 6종)
 *   도구: 가로줄(hline) · 세로줄(vline) · 추세선(trend) · 화살표↑(arrowUp) · 화살표↓(arrowDown) · 십자선(cross)
 *   앵커는 데이터좌표 {t: 봉타임스탬프, p: 가격}로 저장 → 줌/팬/봉전환에도 위치 유지.
 *   편집모드(chart._drawMode=true, 툴바 열림)에서만 포인터 처리. 닫히면 차트 팬/줌, 그림은 계속 표시.
 *   NDraw.create(chart, getKey) → layer.  layer.render(ctx,inst)는 chart.draw() 끝에서 호출됨.
 */
(function (global) {
  'use strict';

  // 도구별 필요한 앵커 수 (1 = 탭 한 번, 2 = 드래그/두 점)
  const NEED = { hline: 1, vline: 1, trend: 2, arrowUp: 1, arrowDown: 1, cross: 1, channel: 3 };
  const COL = { line: '#ffffff', sel: '#58a6ff', up: '#3fb950', down: '#f85149', cross: '#58a6ff', handle: '#ffffff' };
  const HIT = 36;   // 선택 히트반경(px) — 손가락 부정확 대비 넉넉히(편집 잡기 쉽게)

  function uid() { return 'd' + Math.floor((global.performance && global.performance.now ? global.performance.now() : 0) * 1000) + '_' + Math.floor(((global.crypto && global.crypto.getRandomValues) ? global.crypto.getRandomValues(new Uint32Array(1))[0] : 0)); }

  function create(chart, getKey) {
    const L = {
      chart: chart, getKey: getKey,
      drawings: [], tool: null, pending: null, sel: null, drag: null,
      defaults: {},   // 도구별 기본 스타일(app이 setStyle/옵션패널에서 갱신) → 새 그림이 상속
    };
    function styleFor(type) { return Object.assign({}, (L.defaults && L.defaults[type]) || {}); }   // 새 그림 = 그 도구 기본 스타일 복제

    // ── ts ↔ 봉인덱스 매핑 (현재 candles 기준) ──
    function tsToIdx(t) {
      const cs = chart.candles || []; if (!cs.length) return 0;
      // 정확 일치 우선(이진탐색), 없으면 보간/외삽
      let lo = 0, hi = cs.length - 1;
      if (t <= cs[0].ts) { const bar = cs.length > 1 ? (cs[1].ts - cs[0].ts) : 1; return (t - cs[0].ts) / bar; }
      if (t >= cs[hi].ts) { const bar = cs.length > 1 ? (cs[hi].ts - cs[hi - 1].ts) : 1; return hi + (t - cs[hi].ts) / bar; }
      while (lo <= hi) { const m = (lo + hi) >> 1; if (cs[m].ts === t) return m; if (cs[m].ts < t) lo = m + 1; else hi = m - 1; }
      // lo = 첫 ts>t, hi = lo-1. 두 봉 사이 보간
      const a = cs[hi], b = cs[lo]; if (!a || !b) return hi;
      return hi + (t - a.ts) / (b.ts - a.ts);
    }
    function idxToTs(idx) {
      const cs = chart.candles || []; if (!cs.length) return 0;
      const r = Math.max(0, Math.min(Math.round(idx), cs.length - 1));
      return cs[r].ts;
    }

    // 픽셀 → 앵커{t,p}  (idx는 가까운 봉으로 스냅해 ts 저장, 가격은 원시값)
    function pxToAnchor(x, y) {
      const d = chart.pxToData(x, y); if (!d) return null;
      return { t: idxToTs(d.idx), p: d.price };
    }
    function anchorToPx(a) {
      const px = chart.dataToPx(tsToIdx(a.t), a.p); return px;
    }

    // ── 영속 ──
    L.load = function () {
      try { const raw = localStorage.getItem(getKey()); const arr = raw ? JSON.parse(raw) : []; L.drawings = Array.isArray(arr) ? arr : []; } catch (e) { L.drawings = []; }
      L.sel = null; L.pending = null; L.drag = null;
    };
    L.save = function () { try { localStorage.setItem(getKey(), JSON.stringify(L.drawings)); } catch (e) {} };

    L.setTool = function (id) { L.tool = id || null; L.pending = null; L.sel = null; redraw(); };
    L.clearAll = function () { L.drawings = []; L.sel = null; L.pending = null; L.save(); redraw(); };
    L.deleteSelected = function () { if (L.sel) { L.drawings = L.drawings.filter(function (d) { return d.id !== L.sel; }); L.sel = null; L.save(); redraw(); } };
    L.selDrawing = function () { return L.sel ? L.drawings.find(function (d) { return d.id === L.sel; }) : null; };   // 현재 선택 그림 객체
    L.setStyle = function (patch) {   // 선택 그림 스타일 패치(옵션 패널이 호출) → 즉시 반영
      const d = L.selDrawing(); if (!d) return; d.style = Object.assign({}, d.style, patch); L.save(); redraw();
    };
    L.setLocked = function (v) {   // 🔒 선택 그림 잠금(켜면 이동/편집 불가, 선택은 가능=해제용)
      const d = L.selDrawing(); if (!d) return; d.locked = !!v; L.save(); redraw();
    };
    L.undo = function () { L.drawings.pop(); L.sel = null; L.save(); redraw(); };
    L.count = function () { return L.drawings.length; };
    L.isDragging = function () { return !!L.drag; };   // 커서 모드에서 그림 잡았는지(편집 중)
    L.hitAt = function (x, y) { const t = chart._tf; if (!t) return false; return !!hitTest(x, y, t); };   // 이 픽셀에 그림이 잡히는지(차트 팬 양보 판정용)

    function redraw() { try { chart.draw(); } catch (e) {} }

    // ── 렌더 ──
    L.render = function (ctx, inst) {
      const t = inst._tf; if (!t) return;
      const clipL = t.padL, clipT = t.padT, clipW = t.plotW, clipH = t.priceH;
      ctx.save();
      ctx.beginPath(); ctx.rect(clipL, clipT, clipW, clipH + 4); ctx.clip();
      for (let i = 0; i < L.drawings.length; i++) drawOne(ctx, t, L.drawings[i], L.drawings[i].id === L.sel);
      if (L.pending) drawOne(ctx, t, L.pending, true);
      ctx.restore();
    };

    function chPar(P) {   // 평행채널 평행선 끝점 a0,a1 (본선과 평행, P2 통과)
      if (!P[0] || !P[1] || !P[2]) return null;
      const dx = P[1].x - P[0].x, dy = P[1].y - P[0].y;
      if (Math.abs(dx) < 1e-6) return { a0: { x: P[2].x, y: P[0].y }, a1: { x: P[2].x, y: P[1].y } };
      const m = dy / dx;
      return { a0: { x: P[0].x, y: P[2].y + m * (P[0].x - P[2].x) }, a1: { x: P[1].x, y: P[2].y + m * (P[1].x - P[2].x) } };
    }
    // 선분(p0-p1)을 차트 좌/우 끝까지 확장(extend) — 기울기 유지, 확장 방향만 끝점 교체
    function extSeg(p0, p1, ext, left, right) {
      if (!ext || ext === 'none') return [p0, p1];
      const dx = p1.x - p0.x; if (Math.abs(dx) < 1e-6) return [p0, p1];   // 수직선은 확장 무의미
      const m = (p1.y - p0.y) / dx, yAt = function (x) { return p0.y + m * (x - p0.x); };
      let xs = Math.min(p0.x, p1.x), xe = Math.max(p0.x, p1.x);
      if (ext === 'left' || ext === 'both') xs = left;
      if (ext === 'right' || ext === 'both') xe = right;
      return [{ x: xs, y: yAt(xs) }, { x: xe, y: yAt(xe) }];
    }
    function drawOne(ctx, t, d, selected) {
      const st = d.style || {}; const color = st.color || (d.type === 'arrowUp' ? COL.up : d.type === 'arrowDown' ? COL.down : d.type === 'cross' ? COL.cross : COL.line);
      const w = st.width || 1.6;
      ctx.lineWidth = w; ctx.strokeStyle = color; ctx.fillStyle = color; ctx.setLineDash(st.dash || []);
      const P = (d.pts || []).map(anchorToPx).filter(Boolean);
      const left = t.padL, right = t.padL + t.plotW, top = t.padT, bot = t.padT + t.priceH;
      if (d.type === 'hline' && P[0]) {
        ctx.beginPath(); ctx.moveTo(left, P[0].y); ctx.lineTo(right, P[0].y); ctx.stroke();
        if (st.tag !== false) priceTag(ctx, t, right, P[0].y, d.pts[0].p, color);   // 가격표시 토글(기본 on)
      } else if (d.type === 'vline' && P[0]) {
        ctx.beginPath(); ctx.moveTo(P[0].x, top); ctx.lineTo(P[0].x, bot); ctx.stroke();
      } else if (d.type === 'trend' && P[0] && P[1]) {
        const e = extSeg(P[0], P[1], st.extend, left, right);   // 확장(없음/왼/오/양)
        ctx.beginPath(); ctx.moveTo(e[0].x, e[0].y); ctx.lineTo(e[1].x, e[1].y); ctx.stroke();
      } else if (d.type === 'channel' && P[0] && P[1]) {
        const me = extSeg(P[0], P[1], st.extend, left, right);   // 본선(확장)
        ctx.beginPath(); ctx.moveTo(me[0].x, me[0].y); ctx.lineTo(me[1].x, me[1].y); ctx.stroke();
        const ex = chPar(P);
        if (ex) {
          const pe = extSeg(ex.a0, ex.a1, st.extend, left, right);   // 평행선(확장, 본선과 동일 x범위라 평행 유지)
          ctx.beginPath(); ctx.moveTo(pe[0].x, pe[0].y); ctx.lineTo(pe[1].x, pe[1].y); ctx.stroke();
          const c0 = { x: (me[0].x + pe[0].x) / 2, y: (me[0].y + pe[0].y) / 2 }, c1 = { x: (me[1].x + pe[1].x) / 2, y: (me[1].y + pe[1].y) / 2 };
          ctx.save(); ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(c0.x, c0.y); ctx.lineTo(c1.x, c1.y); ctx.stroke(); ctx.restore();   // 중앙선(점선)
          if (st.fill !== false) {   // 채움 토글 (기본 on): 중심선 위=빨강 / 아래=녹색
            const mainUp = (me[0].y + me[1].y) < (pe[0].y + pe[1].y);
            ctx.save(); ctx.globalAlpha = 0.15;
            ctx.fillStyle = mainUp ? COL.down : COL.up;
            ctx.beginPath(); ctx.moveTo(me[0].x, me[0].y); ctx.lineTo(me[1].x, me[1].y); ctx.lineTo(c1.x, c1.y); ctx.lineTo(c0.x, c0.y); ctx.closePath(); ctx.fill();
            ctx.fillStyle = mainUp ? COL.up : COL.down;
            ctx.beginPath(); ctx.moveTo(c0.x, c0.y); ctx.lineTo(c1.x, c1.y); ctx.lineTo(pe[1].x, pe[1].y); ctx.lineTo(pe[0].x, pe[0].y); ctx.closePath(); ctx.fill();
            ctx.restore();
          }
        }
      } else if (d.type === 'cross' && P[0]) {
        ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(left, P[0].y); ctx.lineTo(right, P[0].y); ctx.moveTo(P[0].x, top); ctx.lineTo(P[0].x, bot); ctx.stroke(); ctx.setLineDash([]);
        priceTag(ctx, t, right, P[0].y, d.pts[0].p, color);
      } else if (d.type === 'arrowUp' && P[0]) {
        const z = ARSZ[st.size] || ARSZ.m; glyph(ctx, P[0].x, P[0].y + z.o, '▲', color, z.f);
      } else if (d.type === 'arrowDown' && P[0]) {
        const z = ARSZ[st.size] || ARSZ.m; glyph(ctx, P[0].x, P[0].y - z.o, '▼', color, z.f);
      } else if (d.type === 'barpattern' && P[0] && P[1] && d.bars && d.bars.length) {
        const x0 = Math.min(P[0].x, P[1].x), x1 = Math.max(P[0].x, P[1].x), yT = Math.min(P[0].y, P[1].y), yB = Math.max(P[0].y, P[1].y);
        const n = d.bars.length, bw = (x1 - x0) / n, bodyW = Math.max(1.5, bw * 0.62);
        const yOf = v => yB - v * (yB - yT);   // v=1→고가(위)
        ctx.lineWidth = Math.max(1, Math.min(2, bw * 0.12));
        for (let i = 0; i < n; i++) {
          const b = d.bars[i], cxp = x0 + bw * (i + 0.5), col = b.c >= b.o ? COL.up : COL.down;
          ctx.strokeStyle = col; ctx.fillStyle = col;
          ctx.beginPath(); ctx.moveTo(cxp, yOf(b.h)); ctx.lineTo(cxp, yOf(b.l)); ctx.stroke();   // 심지
          const oY = yOf(b.o), cY = yOf(b.c); ctx.fillRect(cxp - bodyW / 2, Math.min(oY, cY), bodyW, Math.max(1.5, Math.abs(oY - cY)));   // 몸통
        }
        ctx.save(); ctx.setLineDash([4, 3]); ctx.globalAlpha = 0.7; ctx.lineWidth = 1; ctx.strokeStyle = COL.sel; ctx.strokeRect(x0, yT, x1 - x0, yB - yT); ctx.restore();   // 박스
      }
      if (selected) { ctx.setLineDash([]); ctx.lineWidth = 2; ctx.fillStyle = COL.handle; ctx.strokeStyle = COL.sel; for (const p of P) { ctx.beginPath(); ctx.rect(p.x - 7, p.y - 7, 14, 14); ctx.fill(); ctx.stroke(); } }
      ctx.setLineDash([]);
    }
    const ARSZ = { s: { f: 38, o: 20 }, m: { f: 54, o: 28 }, l: { f: 74, o: 38 } };   // 화살표 크기(소/중/대): 폰트px·오프셋px
    function glyph(ctx, x, y, ch, color, fontPx) { ctx.fillStyle = color; ctx.font = 'bold ' + (fontPx || 54) + 'px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(ch, x, y); }
    function priceTag(ctx, t, rx, y, price, color) { const s = price >= 1000 ? Math.round(price).toLocaleString() : price.toFixed(2); ctx.font = '10px system-ui'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; const w = ctx.measureText(s).width + 8; ctx.fillStyle = color; ctx.fillRect(rx - w, y - 7, w, 14); ctx.fillStyle = '#0d1117'; ctx.fillText(s, rx - 4, y); }

    // ── 히트테스트 (선택용) ──
    function distToSeg(px, py, x1, y1, x2, y2) { const dx = x2 - x1, dy = y2 - y1; const l2 = dx * dx + dy * dy; if (!l2) return Math.hypot(px - x1, py - y1); let tt = ((px - x1) * dx + (py - y1) * dy) / l2; tt = Math.max(0, Math.min(1, tt)); return Math.hypot(px - (x1 + tt * dx), py - (y1 + tt * dy)); }
    function hitTest(x, y, t) {
      for (let i = L.drawings.length - 1; i >= 0; i--) {
        const d = L.drawings[i]; const P = (d.pts || []).map(anchorToPx).filter(Boolean); if (!P.length) continue;
        let hit = false;
        if (d.type === 'hline' || d.type === 'cross') { if (Math.abs(y - P[0].y) < HIT) hit = true; }
        if (!hit && (d.type === 'vline' || d.type === 'cross')) { if (Math.abs(x - P[0].x) < HIT) hit = true; }
        if (!hit && (d.type === 'trend' || d.type === 'channel') && P[1]) { if (distToSeg(x, y, P[0].x, P[0].y, P[1].x, P[1].y) < HIT) hit = true; }
        if (!hit && d.type === 'channel') {   // 채널: 점/본선/평행선/중앙선 어디든 잡기(어디 눌러도 이동)
          for (let k = 0; k < P.length; k++) { if (Math.hypot(x - P[k].x, y - P[k].y) < HIT) { hit = true; break; } }
          const ex = !hit && P[1] ? chPar(P) : null;
          if (ex) {
            if (distToSeg(x, y, ex.a0.x, ex.a0.y, ex.a1.x, ex.a1.y) < HIT) hit = true;   // 평행선
            const c0 = { x: (P[0].x + ex.a0.x) / 2, y: (P[0].y + ex.a0.y) / 2 }, c1 = { x: (P[1].x + ex.a1.x) / 2, y: (P[1].y + ex.a1.y) / 2 };
            if (!hit && distToSeg(x, y, c0.x, c0.y, c1.x, c1.y) < HIT) hit = true;   // 중앙선
          }
        }
        if (!hit && (d.type === 'arrowUp' || d.type === 'arrowDown')) { if (Math.hypot(x - P[0].x, y - P[0].y) < HIT + 6) hit = true; }
        if (!hit && d.type === 'barpattern' && P[1]) {   // 모서리=스케일 / 박스 내부=이동
          for (let k = 0; k < P.length; k++) { if (Math.hypot(x - P[k].x, y - P[k].y) < HIT) { hit = true; break; } }
          if (!hit) { const bx0 = Math.min(P[0].x, P[1].x), bx1 = Math.max(P[0].x, P[1].x), by0 = Math.min(P[0].y, P[1].y), by1 = Math.max(P[0].y, P[1].y); if (x >= bx0 - HIT && x <= bx1 + HIT && y >= by0 - HIT && y <= by1 + HIT) hit = true; }
        }
        if (hit) { // 가까운 앵커 인덱스
          let ai = 0, best = 1e9; for (let k = 0; k < P.length; k++) { const dd = Math.hypot(x - P[k].x, y - P[k].y); if (dd < best) { best = dd; ai = k; } }
          return { d: d, anchorIdx: (best < HIT ? ai : -1) };
        }
      }
      return null;
    }

    // ── 포인터 (app.js가 chart._drawMode일 때만 호출) ──
    L.down = function (x, y) {
      const t = chart._tf; if (!t) return;
      if (L.tool === 'erase') {   // 지우개: 탭한 그림만 삭제
        const h = hitTest(x, y, t);
        if (h) { L.drawings = L.drawings.filter(function (d) { return d.id !== h.d.id; }); L.sel = null; L.save(); }
        if (L.onSelect) L.onSelect();
        redraw(); return;
      }
      if (L.tool === 'trend') {   // 추세선(대각선): 2번 탭 (①시작 ②끝)
        const a = pxToAnchor(x, y); if (!a) return;
        if (!L.pending || L.pending.type !== 'trend') { L.pending = { id: uid(), type: 'trend', pts: [a], style: styleFor(L.tool) }; }
        else { L.pending.pts.push(a); L.drawings.push(L.pending); L.sel = L.pending.id; L.pending = null; L.save(); if (L.onCommit) L.onCommit(); }
        redraw(); return;
      }
      if (L.tool === 'channel') {   // 평행채널: 3번 탭 (①본선시작 ②본선끝 ③평행 오프셋)
        const a = pxToAnchor(x, y); if (!a) return;
        if (!L.pending || L.pending.type !== 'channel') { L.pending = { id: uid(), type: 'channel', pts: [a], style: styleFor(L.tool) }; }
        else if (L.pending.pts.length === 1) { L.pending.pts.push(a); }
        else { L.pending.pts.push(a); L.drawings.push(L.pending); L.sel = L.pending.id; L.pending = null; L.save(); if (L.onCommit) L.onCommit(); }
        redraw(); return;
      }
      if (L.tool === 'barpattern') {   // 봉패턴 복사: 2번 탭으로 봉 구간 선택 → 고스트 봉 생성(이동·스케일 가능)
        const a = pxToAnchor(x, y); if (!a) return;
        if (!L.pending || L.pending.type !== 'barpattern') {
          L.pending = { id: uid(), type: 'barpattern', pts: [a], _i0: Math.round(tsToIdx(a.t)) };
        } else {
          const cs = chart.candles || []; const lo = Math.max(0, Math.min(L.pending._i0, Math.round(tsToIdx(a.t)))), hi = Math.min(cs.length - 1, Math.max(L.pending._i0, Math.round(tsToIdx(a.t))));
          const seg = cs.slice(lo, hi + 1).filter(Boolean);
          if (seg.length >= 2) {
            let pHi = -Infinity, pLo = Infinity; seg.forEach(function (c) { pHi = Math.max(pHi, c.high); pLo = Math.min(pLo, c.low); });
            const rng = (pHi - pLo) || 1;
            const bars = seg.map(function (c) { return { o: (c.open - pLo) / rng, h: (c.high - pLo) / rng, l: (c.low - pLo) / rng, c: (c.close - pLo) / rng }; });
            const d = { id: uid(), type: 'barpattern', bars: bars, pts: [{ t: cs[lo].ts, p: pHi }, { t: cs[hi].ts, p: pLo }], style: styleFor(L.tool) };
            L.drawings.push(d); L.sel = d.id; L.save(); if (L.onCommit) L.onCommit();
          }
          L.pending = null;
        }
        redraw(); return;
      }
      if (L.tool) {
        const a = pxToAnchor(x, y); if (!a) return;
        const need = NEED[L.tool] || 1;
        if (need === 1) { commit([a]); }
        else { L.pending = { id: uid(), type: L.tool, pts: [a, a], style: styleFor(L.tool) }; L.drag = { kind: 'new', anchorIdx: 1 }; }
        redraw();
      } else {
        const h = hitTest(x, y, t);
        if (h) { L.sel = h.d.id; L.drag = h.d.locked ? null : { kind: 'edit', d: h.d, anchorIdx: h.anchorIdx, lastA: pxToAnchor(x, y) }; }   // 🔒 잠금=선택만(드래그X)
        else { L.sel = null; L.drag = null; }
        if (L.onSelect) L.onSelect();   // 옵션 패널이 선택 그림에 맞춰 갱신되게
        redraw();
      }
    };
    L.move = function (x, y) {
      if (!L.drag) return; const a = pxToAnchor(x, y); if (!a) return;
      if (L.drag.kind === 'new' && L.pending) { L.pending.pts[L.drag.anchorIdx] = a; redraw(); }
      else if (L.drag.kind === 'edit') {
        const d = L.drag.d;
        if (L.drag.anchorIdx >= 0) { d.pts[L.drag.anchorIdx] = a; }
        else { const la = L.drag.lastA; const dt = a.t - la.t, dp = a.p - la.p; d.pts = d.pts.map(function (q) { return { t: q.t + dt, p: q.p + dp }; }); L.drag.lastA = a; }
        redraw();
      }
    };
    L.up = function (x, y) {
      if (L.drag && L.drag.kind === 'new' && L.pending) { L.drawings.push(L.pending); L.sel = L.pending.id; L.pending = null; L.save(); }
      else if (L.drag && L.drag.kind === 'edit') { L.save(); }
      L.drag = null; redraw();
    };

    function commit(pts) { const d = { id: uid(), type: L.tool, pts: pts, style: styleFor(L.tool) }; L.drawings.push(d); L.sel = d.id; L.save(); if (L.onCommit) L.onCommit(); }   // 그린 직후 커서 모드로(바로 이동·편집)

    return L;
  }

  global.NDraw = { create: create, TOOLS: ['hline', 'vline', 'trend', 'arrowUp', 'arrowDown', 'cross'] };
})(typeof window !== 'undefined' ? window : this);
