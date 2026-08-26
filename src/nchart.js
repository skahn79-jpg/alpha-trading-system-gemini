/**
 * chart.js — 캔들 + SMA + 고점/저점 구간 + 매수/매도 마커 렌더러 (Canvas 2D)
 *
 *  NChart.create(canvas) → 인스턴스
 *    .setData({ candles, ind, signals })
 *    .draw()
 *    내부적으로 핀치/팬 없이 뷰포트(start,count) 기반. 좌우 스와이프로 이동.
 */
(function (global) {
  'use strict';

  const COL = {
    bg: '#0d1117', grid: '#1c2128', text: '#8b949e',
    up: '#3fb950', down: '#f85149',
    sma50: '#3fb950', sma100: '#ffffff', sma200: '#ffffff',
    zoneLow: 'rgba(63,185,80,0.13)', zoneLowBorder: 'rgba(63,185,80,0.5)',
    zoneHigh: 'rgba(248,81,73,0.13)', zoneHighBorder: 'rgba(248,81,73,0.5)',
    buy: '#3fb950', sell: '#f85149', strong: '#ffd33d'
  };

  function dpr() { return Math.min(global.devicePixelRatio || 1, 3); }
  function fmtPrice(v) { return v >= 1000 ? Math.round(v).toLocaleString() : v >= 100 ? v.toFixed(1) : v.toFixed(2); }

  function create(canvas) {
    const inst = {
      canvas,
      candles: [], ind: null, signals: [],
      view: { start: 0, count: 120 },
      yZoom: 1,                          // 가격축(수직) 배율 — 1=자동, >1 확대 / <1 축소 (수치축 드래그/Shift+휠)
      yOff: 0,                           // 가격축(수직) 이동 — 보이는 범위 대비 비율 오프셋 (본문 세로 드래그=자유 패닝)
      _ctx: null, _w: 0, _h: 0,
    };

    inst.setData = function (d) {
      inst.candles = d.candles || [];
      inst.ind = d.ind || null;
      inst.signals = d.signals || [];
      // 기본 뷰: 최신 구간
      const n = inst.candles.length;
      inst.view.count = Math.min(inst.view.count, n);
      inst.view.start = Math.max(0, n - inst.view.count);
      inst.yZoom = 1; inst.yOff = 0;     // 데이터 교체 시 수직 배율·이동 리셋
      return inst;
    };

    // 오실레이터 서브패널 설정 (메인 차트와 x축 동기). 단일(호환) / 멀티 둘 다 지원.
    inst.setOsc = function (cfg) { inst._oscs = (cfg && cfg.canvas) ? [cfg] : []; return inst; };
    inst.setOscs = function (cfgs) { inst._oscs = (cfgs || []).filter(function (c) { return c && c.canvas; }); return inst; };
    // 시그널 시점 세로 마커선
    inst.setMark = function (ts) { inst._markTs = ts; return inst; };
    // 크로스헤어 (길게 눌러 그 봉의 값 확인). 봉 인덱스 또는 null.
    inst.setCrosshair = function (i, y) { inst._cross = (i == null ? null : i); inst._crossY = (i == null || y == null) ? null : y; return inst; };
    // 드로잉 좌표 변환 (draw.js용) — 픽셀↔(봉인덱스,가격). _tf 스냅샷은 draw()에서 갱신.
    inst.pxToData = function (x, y) { const t = inst._tf; if (!t) return null; return { idx: t.start + (x - t.padL - t.cw / 2) / t.cw, price: t.lo + (t.padT + t.priceH - y) / t.priceH * (t.hi - t.lo) }; };
    inst.dataToPx = function (idx, price) { const t = inst._tf; if (!t) return null; return { x: t.padL + (idx - t.start) * t.cw + t.cw / 2, y: t.padT + t.priceH - ((price - t.lo) / (t.hi - t.lo)) * t.priceH }; };
    inst.setDrawLayer = function (layer) { inst._drawLayer = layer; return inst; };
    // 비교 오버레이 — 캔들 위 2차 스케일 라인(각 시리즈 자체 min/max로 높이 채움). Bitfinex 롱/숏·종목비교 공용.
    //   arr = [{ label, color, data:[{ts,v}], cur }]. 비트코인 캔들과 방향 비교용(롱은 역방향).
    inst.setCompare = function (arr) { inst._cmp = (arr || []).filter(function (c) { return c && c.data && c.data.length; }); return inst; };

    inst.setView = function (start, count) {
      const n = inst.candles.length;
      if (count) inst.view.count = Math.max(20, Math.min(count, n));
      inst.view.start = Math.max(0, Math.min(start, n - inst.view.count));
      return inst;
    };

    inst.pan = function (deltaBars) {
      inst.setView(inst.view.start + deltaBars, inst.view.count);
      inst.draw();
    };

    // 확대/축소 — 오른쪽 끝(최신 봉=현재가) 고정. 줌해도 현재가가 계속 보이게.
    inst.zoom = function (factor) {
      const n = inst.candles.length;
      const end = inst.view.start + inst.view.count;            // 현재 오른쪽 끝(보통 최신)
      const newCount = Math.max(20, Math.min(Math.round(inst.view.count * factor), n));
      inst.setView(end - newCount, newCount);                   // 끝 고정 → 현재가 유지
      inst.draw();
    };
    // 가격축(수직) 줌 — factor>1 확대 / <1 축소. 0.25~8 클램프.
    inst.yZoomBy = function (factor) {
      inst.yZoom = Math.max(0.25, Math.min(8, (inst.yZoom || 1) * factor));
      inst.draw();
    };
    // 가격축(수직) 이동 — frac: 보이는 범위 대비 비율(위로 끌면 콘텐츠 위로)
    inst.yPanBy = function (frac) {
      inst.yOff = Math.max(-4, Math.min(4, (inst.yOff || 0) + frac));
      inst.draw();
    };
    inst.resetY = function () { inst.yZoom = 1; inst.yOff = 0; inst.draw(); };

    inst.draw = function () {
      const c = inst.canvas;
      const rect = c.getBoundingClientRect();
      const w = rect.width || c.clientWidth || 360;
      const h = rect.height || c.clientHeight || 320;
      const d = dpr();
      if (c.width !== Math.round(w * d) || c.height !== Math.round(h * d)) {
        c.width = Math.round(w * d); c.height = Math.round(h * d);
      }
      const ctx = c.getContext('2d');
      ctx.setTransform(d, 0, 0, d, 0, 0);
      inst._ctx = ctx; inst._w = w; inst._h = h;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, w, h);

      const candles = inst.candles, ind = inst.ind;
      if (!candles.length) { _msg(ctx, w, h, '데이터 없음'); return; }

      const padR = 52, padB = 22, padT = 8, padL = 4;
      const plotW = w - padR - padL, plotH = h - padB - padT;
      const { start, count } = inst.view;
      const end = Math.min(candles.length, start + count);
      const vis = candles.slice(start, end);
      if (!vis.length) { _msg(ctx, w, h, '데이터 없음'); return; }

      // 가격 범위 (캔들 + 보이는 SMA)
      let lo = Infinity, hi = -Infinity;
      for (const k of vis) { if (k.low < lo) lo = k.low; if (k.high > hi) hi = k.high; }
      if (ind) {
        for (let i = start; i < end; i++) {
          [ind.s50, ind.s100, ind.s200].forEach(arr => {
            const v = arr && arr[i];
            if (v != null && !isNaN(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
          });
        }
      }
      // 파괴지수(CVDD) 오버레이: 천장/바닥 라인을 가격 범위에 포함
      const cvdd = (inst._cvddOn && ind) ? ind.cvdd : null;
      if (cvdd) {
        for (let i = start; i < end; i++) {
          [cvdd.cvddTop, cvdd.cvddBottom, cvdd.cvddTeal].forEach(arr => {
            const v = arr && arr[i];
            if (v != null && !isNaN(v) && isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
          });
        }
      }
      // 파워로(Power Law) 오버레이: 하단·중앙 밴드를 가격 범위에 포함(상단은 너무 높아 클립)
      const pl = (inst._plOn && ind) ? ind.powerlaw : null;
      if (pl) {
        for (let i = start; i < end; i++) {
          [pl.lower1m[i], pl.lower1[i], pl.middle[i]].forEach(v => {
            if (v != null && isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
          });
        }
      }
      // 생산비용(Production Cost) 오버레이: 청록 밴드(하단/상단)를 가격 범위에 포함
      const prod = (inst._prodOn && ind) ? ind.prodcost : null;
      if (prod) {
        for (let i = start; i < end; i++) {
          [prod.lower[i], prod.upper[i], prod.cost[i]].forEach(v => {
            if (v != null && !isNaN(v) && isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
          });
        }
      }
      // 파이사이클(통합 3라인): mid(SMA111 노랑)·floor(SMA471×0.745 녹색)을 가격범위 포함. ceil(SMA350×2 빨강)은 높아 클립(천장 부근만 진입).
      const pic = (inst._piOn && ind) ? ind.picycle : null;
      if (pic) {
        for (let i = start; i < end; i++) { [pic.mid[i], pic.floor[i]].forEach(function (v) { if (v != null && !isNaN(v) && isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }); }
      }
      // 수퍼트렌드 오버레이: 활성 추세선을 가격 범위에 포함
      const st = (inst._stOn && ind) ? ind.st : null;
      if (st && st.line) {
        for (let i = start; i < end; i++) { const v = st.line[i]; if (v != null && !isNaN(v) && isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
      }
      // 볼린저밴드: 상단/하단 밴드를 가격 범위에 포함
      const bb = (inst._bbOn && ind) ? ind : null;
      if (bb && bb.bbUpper) {
        for (let i = start; i < end; i++) { [bb.bbUpper[i], bb.bbLower[i]].forEach(function (v) { if (v != null && !isNaN(v) && isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }); }
      }
      // 구름대(Ichimoku): 구름(선행A/선행B)만 가격 범위에 포함(라인 제거, 선행스팬은 +shift 미래 변위라 화면 진입분까지 스캔)
      const ich = (inst._ichOn && ind) ? ind.ichimoku : null;
      if (ich) {
        for (let i = Math.max(0, start - (ich.shift || 25)); i < end; i++) { [ich.leadA[i], ich.leadB[i]].forEach(function (v) { if (v != null && !isNaN(v) && isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }); }
      }
      const pad = (hi - lo) * 0.06 || hi * 0.05;
      lo -= pad; hi += pad;
      // 수직(가격축) 줌 — 중심 고정으로 범위 확대/축소
      const yz = inst.yZoom || 1;
      if (yz !== 1) { const mid = (lo + hi) / 2, half = (hi - lo) / 2 / yz; lo = mid - half; hi = mid + half; }
      { const yo = inst.yOff || 0; if (yo) { const r = hi - lo; lo += yo * r; hi += yo * r; } }   // 수직 이동(자유 패닝) — 위로 끌면 콘텐츠 위로
      // 거래량 하단 패널(기본 표시) 영역 분리 — 거래량 데이터 있을 때만(FX/매크로는 vol 없음→패널 없음)
      let _hasVol = false; if (ind && ind.vol) { for (let i = start; i < end; i++) { if (ind.vol[i] > 0) { _hasVol = true; break; } } }
      const volH = _hasVol ? Math.round(plotH * 0.18) : 0, priceH = plotH - volH;
      const yOf = p => padT + priceH - ((p - lo) / (hi - lo)) * priceH;
      const _fut = ich ? (ich.shift || 25) : 0;   // 구름대 ON 시 미래 변위만큼 우측 빈 슬롯 예약(선행스팬=미래 구름)
      const cw = plotW / (count + _fut);           // 캔들 슬롯 폭 (미래 공간 포함, 평소 _fut=0이라 기존과 동일)
      const xOf = i => padL + (i - start) * cw + cw / 2;
      const bodyW = Math.max(1, Math.min(cw * 0.62, 14));

      // ── 가로 그리드 + 가격 라벨 ──
      ctx.font = '10px -apple-system,system-ui,sans-serif';
      ctx.textBaseline = 'middle';
      const ticks = 5;
      for (let t = 0; t <= ticks; t++) {
        const p = lo + (hi - lo) * (t / ticks);
        const y = yOf(p);
        ctx.strokeStyle = COL.grid; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
        ctx.fillStyle = COL.text; ctx.textAlign = 'left';
        ctx.fillText(fmtPrice(p), padL + plotW + 4, y);
      }

      // ── 매물대 (Volume Profile) — 최근 lookback봉의 가격대별 거래량 가로 히스토그램. 우측 앵커·캔들 뒤 반투명·POC(최대거래량 가격대) 노랑선. ──
      if (inst._vpOn) {
        const N = Math.min(candles.length, Math.max(10, inst._vpLookback || 2000));
        const win = candles.slice(candles.length - N);
        const ROWS = 48, rng = hi - lo;
        if (rng > 0 && win.length) {
          const binBuy = new Array(ROWS).fill(0), binSell = new Array(ROWS).fill(0);
          for (const k of win) {
            const v = +k.volume || 0; if (v <= 0) continue;
            const up = k.close >= k.open;
            const klo = Math.min(k.low, k.high), khi = Math.max(k.low, k.high);
            let b0 = Math.floor(((klo - lo) / rng) * ROWS), b1 = Math.floor(((khi - lo) / rng) * ROWS);
            b0 = Math.max(0, Math.min(ROWS - 1, b0)); b1 = Math.max(0, Math.min(ROWS - 1, b1));
            const span = (b1 - b0 + 1) || 1, share = v / span;
            for (let b = b0; b <= b1; b++) { if (up) binBuy[b] += share; else binSell[b] += share; }
          }
          let maxV = 0, pocIdx = -1;
          for (let b = 0; b < ROWS; b++) { const t = binBuy[b] + binSell[b]; if (t > maxV) { maxV = t; pocIdx = b; } }
          if (maxV > 0) {
            const maxBarW = plotW * 0.36, rightX = padL + plotW;
            for (let b = 0; b < ROWS; b++) {
              const tot = binBuy[b] + binSell[b]; if (tot <= 0) continue;
              const yTop = yOf(lo + rng * ((b + 1) / ROWS)), yBot = yOf(lo + rng * (b / ROWS));
              const bh = Math.max(1, yBot - yTop - 1), barW = (tot / maxV) * maxBarW;
              const sellW = (binSell[b] / tot) * barW, buyW = barW - sellW;
              ctx.fillStyle = 'rgba(255,59,48,0.55)'; ctx.fillRect(rightX - sellW, yTop, sellW, bh);
              ctx.fillStyle = 'rgba(48,209,88,0.55)'; ctx.fillRect(rightX - sellW - buyW, yTop, buyW, bh);
            }
            if (pocIdx >= 0) {
              const y = yOf(lo + rng * ((pocIdx + 0.5) / ROWS));
              ctx.strokeStyle = 'rgba(255,214,10,0.9)'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
              ctx.beginPath(); ctx.moveTo(rightX - maxBarW, y); ctx.lineTo(rightX, y); ctx.stroke();
            }
          }
        }
      }

      // ── 장기보유공급(LTH Supply) 2차 스케일 파란 면적 — 캔들 뒤(배경). 가격과 다른 스케일(BTC 단위, 자체 min/max). ──
      const lth = (inst._lthOn && ind) ? ind.lth : null;
      if (lth && lth.data) {
        let llo = Infinity, lhi = -Infinity;
        for (let i = start; i < end; i++) { const v = lth.data[i]; if (v != null && isFinite(v)) { if (v < llo) llo = v; if (v > lhi) lhi = v; } }
        if (isFinite(llo) && lhi > llo) {
          const lr = lhi - llo; llo -= lr * 0.28; lhi += lr * 0.12;   // 면적이 아래쪽 채우도록 하단 여유
          const lYof = v => padT + priceH - (v - llo) / (lhi - llo) * priceH;
          ctx.save(); ctx.beginPath(); ctx.rect(padL, padT, plotW, priceH); ctx.clip();
          ctx.beginPath(); let started = false, lastX = padL;
          for (let i = start; i < end; i++) { const v = lth.data[i]; if (v == null || !isFinite(v)) continue; const x = xOf(i), y = lYof(v); if (!started) { ctx.moveTo(x, padT + priceH); ctx.lineTo(x, y); started = true; } else ctx.lineTo(x, y); lastX = x; }
          if (started) { ctx.lineTo(lastX, padT + priceH); ctx.closePath(); ctx.fillStyle = 'rgba(56,135,190,0.30)'; ctx.fill(); }
          _line(ctx, lth.data, start, end, xOf, lYof, '#4aa8e0', 2.5);   // LTH 라인(파랑)
          ctx.restore();
          ctx.fillStyle = '#5b9bd5'; ctx.font = '9px -apple-system,system-ui,sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
          for (let t = 1; t <= 3; t++) { const v = llo + (lhi - llo) * (t / 4); ctx.fillText((v / 1e6).toFixed(1) + 'M', padL + 2, lYof(v)); }   // 좌측 공급 축 라벨
        }
      }
      // ── 구간 배경 ──
      // 저점구간(isAccum) 자동 음영 제거(2026-06 사용자 요청 — 지표 미선택 시에도 떠서 혼란).
      //   isAccum 판정 자체는 종합판단/구간카드에서 계속 사용, 차트 음영만 제거.
      // 파괴지수(CVDD): 천장=빨강 음영 / 바닥=녹색 음영 (강한 단일 레벨만)
      if (cvdd) {
        _drawZones(ctx, cvdd.atTop, start, end, xOf, cw, padT, priceH, 'rgba(248,81,73,0.24)', 'rgba(248,81,73,0.65)', '');
        _drawZones(ctx, cvdd.atBottom, start, end, xOf, cw, padT, priceH, 'rgba(63,185,80,0.24)', 'rgba(63,185,80,0.65)', '');
      }
      // 다이버전스2 (UO Div Detector): 강세 다이버전스 구간 = 녹색 세로음영 (_uoDivOn 선택 시)
      if (ind && inst._uoDivOn && ind.uodiv) {
        _drawZones(ctx, ind.uodiv.bullDiv, start, end, xOf, cw, padT, priceH, 'rgba(63,185,80,0.22)', 'rgba(63,185,80,0.55)', '');
      }
      // 파이사이클(통합): 고점 교차(mid↑ceil) = 빨간 세로음영 / 저점 교차(mid↓floor) = 녹색 세로음영. _piOn 게이트.
      //   ⚠️이전 isLocalTop 빨간띠와 무관(혼동·삭제 금지).
      if (pic) {
        _drawZones(ctx, pic.topBand, start, end, xOf, cw, padT, priceH, 'rgba(248,81,73,0.26)', 'rgba(248,81,73,0.8)', '');
        _drawZones(ctx, pic.botBand, start, end, xOf, cw, padT, priceH, 'rgba(63,185,80,0.22)', 'rgba(63,185,80,0.6)', '');
      }
      // 4년주기 사이클(반감기 익절): 녹색 5단계 매도 음영 + DCA 매집존 + Profit START/END 수직선 + 반감기선/말풍선. _cycleOn 게이트(BTC·일/주/월 공통, 절대 날짜 기반이라 tf 무관 동일 시점).
      if (ind && inst._cycleOn && ind.cycle) {
        const cyc = ind.cycle;
        // 빨간 매도 그라데이션(단계별 알파) — 경계 seam 방지 위해 border=fill
        (cyc.zones || []).forEach(function (z) { const f = 'rgba(248,81,73,' + z.alpha + ')'; _drawZones(ctx, z.bars, start, end, xOf, cw, padT, priceH, f, f, ''); });
        // DCA 매집존(연노랑)
        if (cyc.dcaBars) _drawZones(ctx, cyc.dcaBars, start, end, xOf, cw, padT, priceH, 'rgba(226,246,0,0.12)', 'rgba(226,246,0,0.35)', '');
        // 수직선 + 말풍선 라벨
        _drawCycleMarks(ctx, cyc.marks, start, end, xOf, padT, priceH);
      }

      // ── 이평선종합(SMA) 라인 — '이평선종합' 지표 선택(_maOn) 시에만 표시. 기본 차트는 캔들+거래량만. ──
      if (ind && inst._maOn) {
        _line(ctx, ind.s200, start, end, xOf, yOf, COL.sma200, 4);              // 200일 흰색 굵기4
        _line(ctx, ind.s100, start, end, xOf, yOf, COL.sma100, 2, [4, 3]);      // 100일 흰색 점선 굵기2
        _line(ctx, ind.s50, start, end, xOf, yOf, COL.sma50, 3);                // 50일 녹색 굵기3
      }
      // 파괴지수(CVDD) 라인 3종 (보라=천장 / 파랑=지지 / 청록=CVDD)
      if (cvdd) {
        _line(ctx, cvdd.cvddTop, start, end, xOf, yOf, '#c727e3', 2);
        _line(ctx, cvdd.cvddBottom, start, end, xOf, yOf, '#4920ff', 2);
        _line(ctx, cvdd.cvddTeal, start, end, xOf, yOf, '#27e3c0', 2);
      }
      // 파워로(Power Law) 오버레이 — 녹색 저평가밴드/적색 고평가밴드 + 중앙선. 플롯영역으로 클립.
      if (pl) {
        ctx.save(); ctx.beginPath(); ctx.rect(padL, padT, plotW, priceH); ctx.clip();
        _plBand(ctx, pl.lower1m, pl.lower1, start, end, xOf, yOf, 'rgba(63,185,80,0.16)');   // 저평가(녹)
        _plBand(ctx, pl.upper1, pl.upper1m, start, end, xOf, yOf, 'rgba(248,81,73,0.16)');    // 고평가(적)
        _line(ctx, pl.lower1m, start, end, xOf, yOf, '#3fb950', 2);
        _line(ctx, pl.lower1, start, end, xOf, yOf, '#3fb950', 1);
        _line(ctx, pl.upper1, start, end, xOf, yOf, '#f85149', 1);
        _line(ctx, pl.upper1m, start, end, xOf, yOf, '#f85149', 2);
        _line(ctx, pl.middle, start, end, xOf, yOf, '#e6edf3', 1);
        ctx.restore();
      }
      // 생산비용(Production Cost) — 청록 밴드 채움 + 두꺼운 생산비용선 + 빨간 터치 원(원가 지지 테스트). 플롯영역 클립.
      if (prod) {
        ctx.save(); ctx.beginPath(); ctx.rect(padL, padT, plotW, priceH); ctx.clip();
        _plBand(ctx, prod.lower, prod.upper, start, end, xOf, yOf, 'rgba(255,214,10,0.16)');   // 노란 밴드 채움
        _line(ctx, prod.cost, start, end, xOf, yOf, '#ffd60a', 5);                              // 생산비용선 (두꺼운 노랑)
        for (let i = start; i < end; i++) {
          if (prod.touch[i]) {
            const x = xOf(i), y = yOf(candles[i].low);
            ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fillStyle = 'rgba(248,81,73,0.82)'; ctx.fill();
            ctx.strokeStyle = '#0d1117'; ctx.lineWidth = 1.5; ctx.stroke();
          }
        }
        ctx.restore();
      }
      // 볼린저밴드 오버레이 — 상단 빨강 w4 / 하단 녹색 w4 / 중심선(SMA20) 파랑 점선(커스텀) + 밴드 연파랑 채움. 플롯영역 클립.
      if (bb && bb.bbUpper) {
        const basis = bb.bbUpper.map((u, i) => { const l = bb.bbLower[i]; return (u == null || isNaN(u) || l == null || isNaN(l)) ? NaN : (u + l) / 2; });
        ctx.save(); ctx.beginPath(); ctx.rect(padL, padT, plotW, priceH); ctx.clip();
        _plBand(ctx, bb.bbLower, bb.bbUpper, start, end, xOf, yOf, 'rgba(33,150,243,0.10)');   // 밴드 사이 연파랑 채움
        _line(ctx, bb.bbUpper, start, end, xOf, yOf, '#F23645', 4);          // 상단 빨강 w4
        _line(ctx, bb.bbLower, start, end, xOf, yOf, '#089981', 4);          // 하단 녹색 w4
        _line(ctx, basis, start, end, xOf, yOf, '#ffd60a', 2, [5, 4]);       // 중심선 노랑 점선(커스텀)
        ctx.restore();
      }
      // 파이사이클 통합 3라인: 천장 SMA350×2=빨강 w4(위) · 중간 SMA111=노랑 점선 w2 · 바닥 SMA471×0.745=녹색 w4(아래). 플롯영역 클립.
      //   고점 교차봉='고점' 라벨(봉 위) / 저점 교차봉=녹색 ○ + '저점' 라벨(봉 아래). 중간선이 천장 닿으면 고점·바닥 닿으면 저점.
      if (pic) {
        ctx.save(); ctx.beginPath(); ctx.rect(padL, padT, plotW, priceH); ctx.clip();
        _line(ctx, pic.ceil, start, end, xOf, yOf, '#f85149', 4);          // 천장 SMA350×2 (빨강 w4)
        _line(ctx, pic.floor, start, end, xOf, yOf, '#3fb950', 4);         // 바닥 SMA471×0.745 (녹색 w4)
        _line(ctx, pic.mid, start, end, xOf, yOf, '#ffd60a', 2, [5, 4]);   // 중간 SMA111 (노랑 점선 w2)
        ctx.restore();
        ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center';
        for (let i = start; i < end; i++) {
          if (pic.top[i]) { const x = xOf(i), y = yOf(candles[i].high) - 10; ctx.fillStyle = '#f85149'; ctx.textBaseline = 'bottom'; ctx.fillText('고점', x, y); }
          if (pic.bot[i]) {
            const x = xOf(i), y = yOf(candles[i].low) + 16;
            ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fillStyle = '#3fb950'; ctx.fill();
            ctx.strokeStyle = '#0d1117'; ctx.lineWidth = 1.5; ctx.stroke();
            ctx.fillStyle = '#3fb950'; ctx.textBaseline = 'top'; ctx.fillText('저점', x, y + 9);
          }
        }
      }

      // ── 캔들 ──
      for (let i = start; i < end; i++) {
        const k = candles[i];
        const x = xOf(i);
        const up = k.close >= k.open;
        const col = up ? COL.up : COL.down;
        ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
        // 심지
        ctx.beginPath(); ctx.moveTo(x, yOf(k.high)); ctx.lineTo(x, yOf(k.low)); ctx.stroke();
        // 몸통
        const yO = yOf(k.open), yC = yOf(k.close);
        const top = Math.min(yO, yC), bh = Math.max(1, Math.abs(yC - yO));
        ctx.fillRect(x - bodyW / 2, top, bodyW, bh);
      }

      // ── 거래량 하단 패널 (기본 표시 — 캔들+거래량) ──
      if (ind && ind.vol) {
        const volTop = padT + priceH + 3, volBot = padT + plotH;
        let vmax = 0;
        for (let i = start; i < end; i++) { const v = ind.vol[i]; if (v != null && !isNaN(v) && v > vmax) vmax = v; }
        if (vmax > 0) {
          for (let i = start; i < end; i++) {
            const v = ind.vol[i]; if (v == null || isNaN(v)) continue;
            const bh = Math.max(0.5, (v / vmax) * (volBot - volTop));
            const up = (ind.volUp && ind.volUp[i] != null) ? ind.volUp[i] : (candles[i].close >= candles[i].open);
            ctx.fillStyle = up ? 'rgba(63,185,80,0.5)' : 'rgba(248,81,73,0.5)';
            ctx.fillRect(xOf(i) - bodyW / 2, volBot - bh, bodyW, bh);
          }
        }
      }

      // ── 구름대(Ichimoku) 오버레이 (구름 fill + 5라인, 선행스팬 미래 변위) ──
      if (ich) _drawIchimoku(ctx, ich, candles, start, end, padL, padT, plotW, priceH, xOf, yOf);

      // ── 수퍼트렌드 오버레이 (추세선 녹/적 + Buy/Sell + 하이라이트) ──
      if (st) _drawSupertrend(ctx, st, candles, start, end, xOf, yOf);

      // ── 다이버전스 오버레이 (가격차트 라인 + 라벨, 11개 지표) ──
      if (ind && inst._divOn) _drawDivergence(ctx, ind, candles, start, end, padL, padT, plotW, priceH, xOf, yOf);

      // ── 매수/매도 마커 (지표 선택 시에만 — 순수 보기는 캔들+거래량만) ──
      if (inst._showSig) for (const sig of inst.signals) {
        const idx = _findIdx(candles, sig.ts, start, end);
        if (idx < 0) continue;
        const k = candles[idx];
        const x = xOf(idx);
        if (sig.type === 'buy') {
          const y = yOf(k.low) + 9;
          _tri(ctx, x, y, 5, true, sig.badge === 'strong' ? COL.strong : COL.buy);
        } else {
          const y = yOf(k.high) - 9;
          _tri(ctx, x, y, 5, false, COL.sell);
        }
      }

      // ── 골든/데드크로스 화살표+텍스트 (모멘텀 지표 선택 시 — SMA50×200, 이평선 라인은 숨김) ──
      if (inst._gcOn && ind && ind.goldCross) {
        ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center';
        const GR = 14;   // 화살표 크기(크게)
        for (let i = start; i < end; i++) {
          if (ind.goldCross[i]) {
            const x = xOf(i), y = yOf(candles[i].low) + GR + 4;
            _tri(ctx, x, y, GR, true, '#ffd60a');                                          // 골든 ▲ 노랑 · 봉아래
            ctx.fillStyle = '#ffd60a'; ctx.textBaseline = 'top'; ctx.fillText('50/200 골든', x, y + GR + 2);
          }
          if (ind.deadCross && ind.deadCross[i]) {
            const x = xOf(i), y = yOf(candles[i].high) - GR - 4;
            _tri(ctx, x, y, GR, false, '#ff5db1');                                         // 데드 ▼ 분홍 · 봉위
            ctx.fillStyle = '#ff5db1'; ctx.textBaseline = 'bottom'; ctx.fillText('50/200 데드', x, y - GR - 2);
          }
        }
      }

      // ── X축 날짜 라벨 (3~4개) ──
      ctx.fillStyle = COL.text; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      const labelN = 4;
      for (let t = 0; t <= labelN; t++) {
        const i = start + Math.round((count - 1) * (t / labelN));
        if (i < 0 || i >= candles.length) continue;
        const dt = new Date(candles[i].ts);
        const lbl = (dt.getFullYear() + '').slice(2) + '.' + (dt.getMonth() + 1) + '.' + dt.getDate();
        ctx.fillText(lbl, Math.min(Math.max(xOf(i), 18), padL + plotW - 18), padT + plotH + 5);
      }

      // ── 현재가 라인 ──
      const lastC = candles[end - 1];
      if (lastC) {
        const y = yOf(lastC.close);
        ctx.strokeStyle = lastC.close >= lastC.open ? COL.up : COL.down;
        ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
        ctx.setLineDash([]);
        // 가격 박스 (현재가 + 변동% — 트레이딩뷰식, 현재 봉 일/주/월 기준)
        const prevC = (end >= 2) ? candles[end - 2].close : lastC.open;
        const chgPct = prevC ? (lastC.close - prevC) / prevC * 100 : 0;
        const _pu = chgPct >= 0;
        ctx.fillStyle = _pu ? COL.up : COL.down;
        ctx.fillRect(padL + plotW, y - 13, padR, 27);
        ctx.fillStyle = '#0d1117'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.font = 'bold 10px system-ui'; ctx.fillText(fmtPrice(lastC.close), padL + plotW + 4, y - 5);
        ctx.font = 'bold 9px system-ui'; ctx.fillText((_pu ? '+' : '') + chgPct.toFixed(2) + '%', padL + plotW + 4, y + 6);
      }

      // ── 시그널 시점 세로 마커선 ──
      if (inst._markTs != null) {
        const mi = candles.findIndex(k => k.ts === inst._markTs);
        if (mi >= start && mi < end) {
          ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
          ctx.beginPath(); ctx.moveTo(xOf(mi), padT); ctx.lineTo(xOf(mi), padT + plotH); ctx.stroke(); ctx.setLineDash([]);
        }
      }

      // ── 크로스헤어 (길게 눌러 그 봉의 날짜/가격 확인) ──
      if (inst._cross != null && inst._cross >= start && inst._cross < end) {
        const ci = inst._cross, k = candles[ci], xc = xOf(ci);
        ctx.strokeStyle = 'rgba(230,237,243,0.55)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(xc, padT); ctx.lineTo(xc, padT + plotH); ctx.stroke();
        let yc, pCross;
        if (inst._crossY != null) { yc = Math.max(padT, Math.min(inst._crossY, padT + priceH)); pCross = lo + (padT + priceH - yc) / priceH * (hi - lo); }
        else { yc = yOf(k.close); pCross = k.close; }
        ctx.beginPath(); ctx.moveTo(padL, yc); ctx.lineTo(padL + plotW, yc); ctx.stroke(); ctx.setLineDash([]);
        // 우측 가격축 노란 라벨 (TradingView식 — 터치/호버 지점의 가격을 실시간 표시)
        ctx.fillStyle = '#ffd60a'; ctx.fillRect(padL + plotW, yc - 8, padR, 16);
        ctx.fillStyle = '#0d1117'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = 'bold 11px system-ui';
        ctx.fillText(fmtPrice(pCross), padL + plotW + 4, yc);
        const dt = new Date(k.ts);
        const prev = ci > 0 ? candles[ci - 1].close : k.close;
        const chg = prev ? (k.close - prev) / prev * 100 : 0;
        const label = (dt.getFullYear() + '').slice(2) + '.' + (dt.getMonth() + 1) + '.' + dt.getDate() + '  $' + fmtPrice(k.close) + '  ' + (chg >= 0 ? '+' : '') + chg.toFixed(1) + '%';
        ctx.font = 'bold 10px system-ui'; ctx.textBaseline = 'middle';
        const tw = ctx.measureText(label).width + 12;
        const tx = Math.min(Math.max(xc - tw / 2, padL), padL + plotW - tw);
        ctx.fillStyle = 'rgba(13,17,23,0.92)'; ctx.fillRect(tx, padT, tw, 16);
        ctx.strokeStyle = 'rgba(230,237,243,0.3)'; ctx.lineWidth = 1; ctx.strokeRect(tx, padT, tw, 16);
        ctx.fillStyle = chg >= 0 ? COL.up : COL.down; ctx.textAlign = 'left'; ctx.fillText(label, tx + 6, padT + 8);
      }

      // ── 드로잉(줄긋기) 레이어 — 좌표 변환 스냅샷 저장 + 사용자 그림 렌더 (draw.js) ──
      // ── 비교 오버레이 (Bitfinex 롱/숏, 종목 비교) — 캔들 위 2차 스케일 라인 ──
      if (inst._cmp && inst._cmp.length) _drawCompare(ctx, inst._cmp, candles, start, end, padL, padT, plotW, priceH, xOf);

      inst._tf = { lo: lo, hi: hi, start: start, count: count, cw: cw, padL: padL, padT: padT, priceH: priceH, plotW: plotW };
      if (inst._drawLayer && inst._drawLayer.render) { try { inst._drawLayer.render(ctx, inst); } catch (e) {} }

      // ── 오실레이터 서브패널들 (메인과 동일 뷰포트, 멀티 패널) ──
      (inst._oscs || []).forEach(function (cfg) { if (cfg.canvas) _drawOscillator(cfg, inst.candles, inst.view, padL, padR, inst._cross); });

      return inst;
    };

    return inst;
  }

  // 범용 오실레이터 패널.
  //  cfg: { canvas, fixed:[min,max]|null, zero:bool, obShade:{ob,os}|null,
  //         bands:[{v,color,dash}], series:[{data,color,w,kind:'line'|'hist'}] }
  // 비교 오버레이 — 각 시리즈를 자체 min/max로 가격영역 높이에 맞춰 라인 + 좌상단 범례. ts→x는 캔들 인덱스 매핑.
  function _drawCompare(ctx, cmps, candles, start, end, padL, padT, plotW, priceH, xOf) {
    if (!candles.length) return;
    const last = Math.min(end, candles.length) - 1; if (last < start) return;
    const t0 = candles[start].ts, t1 = candles[last].ts;
    function tsToX(ts) {
      if (ts <= candles[start].ts) return xOf(start);
      if (ts >= candles[last].ts) return xOf(last);
      let lo = start, hi = last;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (candles[m].ts === ts) return xOf(m); if (candles[m].ts < ts) lo = m + 1; else hi = m - 1; }
      const a = candles[hi], b = candles[lo]; if (!a || !b || b.ts === a.ts) return xOf(hi);
      return xOf(hi) + (xOf(lo) - xOf(hi)) * (ts - a.ts) / (b.ts - a.ts);
    }
    ctx.save(); ctx.beginPath(); ctx.rect(padL, padT, plotW, priceH); ctx.clip();
    let legendY = padT + 4;
    for (const c of cmps) {
      const pts = c.data.filter(function (p) { return p.ts >= t0 && p.ts <= t1 && p.v != null && !isNaN(p.v); });
      if (!pts.length) continue;
      let lo = Infinity, hi = -Infinity; for (const p of pts) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; }
      if (hi <= lo) hi = lo + 1;
      const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
      const yOf = v => padT + priceH - (v - lo) / (hi - lo) * priceH;
      ctx.lineWidth = 2; ctx.strokeStyle = c.color; ctx.setLineDash([]); ctx.beginPath();
      let started = false;
      for (const p of pts) { const x = tsToX(p.ts), y = yOf(p.v); if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y); }
      if (pts.length === 1) { ctx.arc(tsToX(pts[0].ts), yOf(pts[0].v), 2.5, 0, 7); ctx.fill(); } else ctx.stroke();
      const curV = c.cur != null ? c.cur : pts[pts.length - 1].v;
      const lbl = (c.label || '') + ' ' + (curV >= 1000 ? Math.round(curV).toLocaleString() : (+curV).toFixed(1));
      ctx.font = '10px -apple-system,system-ui,sans-serif'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
      ctx.fillStyle = c.color; ctx.fillText('● ' + lbl, padL + 4, legendY); legendY += 13;
    }
    ctx.restore();
  }

  function _drawOscillator(cfg, candles, view, padL, padR, crossI) {
    const c = cfg.canvas;
    const rect = c.getBoundingClientRect();
    const w = rect.width || c.clientWidth || 360;
    const h = rect.height || c.clientHeight || 90;
    const d = dpr();
    if (c.width !== Math.round(w * d) || c.height !== Math.round(h * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); }
    const ctx = c.getContext('2d');
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, w, h);
    if (!candles.length) return;
    const padT = 8, padB = 4;
    const plotW = w - padR - padL, plotH = h - padT - padB;
    const { start, count } = view;
    const end = Math.min(candles.length, start + count);
    const cw = plotW / count;
    const xOf = i => padL + (i - start) * cw + cw / 2;
    // 통합지표(BTI) — 개별 지표 레인: 고점 징후 시 파란 가로줄(Top=빨강) + 지표명/현재값 (원본 'Plot individual Indicators')
    if (cfg.btiLanes) { _drawBtiLanes(ctx, cfg.btiLanes, start, end, padL, padT, plotW, plotH, cw, xOf); return; }
    if (cfg.shm) { _drawStochHeatmap(ctx, cfg.shm, candles, start, end, padL, padT, plotW, plotH, xOf); return; }
    const series = cfg.series || [];

    // 스케일 결정
    let min, max;
    if (cfg.fixed) { min = cfg.fixed[0]; max = cfg.fixed[1]; }
    else {
      min = Infinity; max = -Infinity;
      series.forEach(s => { if (!s.data) return; for (let i = start; i < end; i++) { const v = s.data[i]; if (v == null || isNaN(v)) continue; if (v < min) min = v; if (v > max) max = v; } });
      if (!isFinite(min)) { min = 0; max = 1; }
      if (cfg.zero) { min = Math.min(min, 0); max = Math.max(max, 0); }
      const pad = (max - min) * 0.12 || Math.abs(max) * 0.1 || 1;
      min -= pad; max += pad;
    }
    // 🔒 확정 사양(2026-06-09): 수직 줌 + 고점빨강/저점녹색 음영. app.js IND_PANELS 주석 참조 — 임의 변경 금지.
    // 수직(수치축) 줌 — 중심 기준 확대/축소 (그래프도 함께 커짐)
    { const yz = cfg.yZoom || 1; if (yz !== 1) { const mid = (min + max) / 2, half = (max - min) / 2 / yz; min = mid - half; max = mid + half; } }
    { const yo = cfg.yOff || 0; if (yo) { const r = max - min; min += yo * r; max += yo * r; } }   // 수직 이동(자유 패닝)
    const yOf = v => padT + plotH - ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * plotH;

    // OB/OS 음영 — 80↑(과매수/고점) 빨강 · 20↓(과매도/저점) 녹색
    if (cfg.obShade) {
      ctx.fillStyle = 'rgba(248,81,73,0.13)'; ctx.fillRect(padL, padT, plotW, yOf(cfg.obShade.ob) - padT);                               // ob(80) 위 = 빨강
      ctx.fillStyle = 'rgba(63,185,80,0.13)'; ctx.fillRect(padL, yOf(cfg.obShade.os), plotW, padT + plotH - yOf(cfg.obShade.os));        // os(20) 아래 = 녹색
    }
    // 기준선 + 우측 라벨
    ctx.font = '9px system-ui'; ctx.textBaseline = 'middle';
    const bands = cfg.bands || [];
    if (cfg.zero && !bands.some(b => b.v === 0)) bands.push({ v: 0, color: COL.grid, dash: [2, 3] });
    bands.forEach(b => {
      if (b.v < min || b.v > max) return;
      const y = yOf(b.v);
      ctx.strokeStyle = b.color || COL.grid; ctx.lineWidth = 1; ctx.setLineDash(b.dash || []);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = COL.text; ctx.textAlign = 'left'; ctx.fillText(b.label != null ? b.label : (Math.abs(b.v) < 1 ? b.v.toFixed(2) : Math.round(b.v)), padL + plotW + 4, y);
    });

    // 황금 다이버전스 세로 배경 (cfg.vmark[i] === true인 봉) — 인간지표용
    if (cfg.vmark) {
      ctx.fillStyle = 'rgba(255,215,0,0.22)';
      for (let i = start; i < end; i++) { if (cfg.vmark[i]) ctx.fillRect(xOf(i) - cw / 2, padT, cw, plotH); }
    }
    // 다색 세로 시간대 음영 (cfg.vshade=[{bars:bool[], color, w}]) — Puell 과/저평가·반감기 등
    if (cfg.vshade) {
      for (const vs of cfg.vshade) {
        if (!vs || !vs.bars) continue;
        ctx.fillStyle = vs.color;
        const w = vs.w ? vs.w : cw;
        for (let i = start; i < end; i++) { if (vs.bars[i]) ctx.fillRect(xOf(i) - w / 2, padT, w, plotH); }
      }
    }
    // 시리즈
    const bodyW = Math.max(1, Math.min(cw * 0.6, 10));
    series.forEach(s => {
      if (!s.data) return;
      if (s.kind === 'hist') {
        const y0 = yOf(0);
        for (let i = start; i < end; i++) {
          const v = s.data[i]; if (v == null || isNaN(v)) continue;
          const y = yOf(v); const x = xOf(i);
          ctx.fillStyle = (s.colors && s.colors[i]) ? s.colors[i] : (v >= 0 ? 'rgba(63,185,80,0.7)' : 'rgba(248,81,73,0.7)');
          ctx.fillRect(x - bodyW / 2, Math.min(y, y0), bodyW, Math.max(1, Math.abs(y - y0)));
        }
      } else if (s.gradArea) {
        // 거품지수 — 원본 fill(riskPlot, basePlot=0, gradient_color) 재현: 0기준 연속 채움 영역 + 봉별 가로 그라데이션
        const pts = [];
        for (let i = start; i < end; i++) { const v = s.data[i]; if (v == null || isNaN(v)) continue; pts.push({ x: xOf(i), y: yOf(v), c: (s.colors && s.colors[i]) || s.color || COL.text }); }
        if (pts.length >= 2) {
          const gx0 = pts[0].x, gx1 = pts[pts.length - 1].x, span = (gx1 - gx0) || 1;
          const grad = ctx.createLinearGradient(gx0, 0, gx1, 0);
          let pt = -1;
          pts.forEach(p => { let t = (p.x - gx0) / span; t = t < 0 ? 0 : t > 1 ? 1 : t; if (t <= pt) t = Math.min(1, pt + 1e-6); pt = t; grad.addColorStop(t, p.c); });
          const y0 = yOf(s.base != null ? s.base : 0);   // 채움 기준선(기본 0, 불앤베어는 -2 수평선 기준 → 위 빨강/아래 녹색)
          ctx.fillStyle = grad; ctx.beginPath(); ctx.moveTo(pts[0].x, y0);
          pts.forEach(p => ctx.lineTo(p.x, p.y));
          ctx.lineTo(pts[pts.length - 1].x, y0); ctx.closePath(); ctx.fill();
          // 상단 윤곽선 (같은 그라데이션)
          ctx.strokeStyle = grad; ctx.lineWidth = s.w || 1.4; ctx.beginPath();
          pts.forEach((p, k) => k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
          ctx.stroke();
        }
      } else {
        // 영역 채우기 (s.fill = [topColor, botColor]) — 인간지표 그라데이션
        if (s.fill) {
          const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
          grad.addColorStop(0, s.fill[0]); grad.addColorStop(1, s.fill[1]);
          ctx.fillStyle = grad; ctx.beginPath();
          let fst = true, fx = 0, lx = 0;
          for (let i = start; i < end; i++) {
            const v = s.data[i]; if (v == null || isNaN(v)) continue;
            const x = xOf(i), y = yOf(v);
            if (fst) { ctx.moveTo(x, padT + plotH); ctx.lineTo(x, y); fx = x; fst = false; } else ctx.lineTo(x, y);
            lx = x;
          }
          if (!fst) { ctx.lineTo(lx, padT + plotH); ctx.closePath(); ctx.fill(); }
        }
        if (s.segColors) {
          // 구간별 색상 라인 (각도기2 등) — 각 세그먼트를 그 봉의 색으로
          ctx.lineWidth = s.w || 1.2; ctx.setLineDash(s.dash || []);
          let px = null, py = null;
          for (let i = start; i < end; i++) {
            const v = s.data[i];
            if (v == null || isNaN(v)) { px = null; continue; }
            const x = xOf(i), y = yOf(v);
            if (px != null) { ctx.strokeStyle = s.segColors[i] || s.color || COL.text; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke(); }
            px = x; py = y;
          }
          ctx.setLineDash([]);
        } else {
          ctx.strokeStyle = s.color; ctx.lineWidth = s.w || 1.2; ctx.setLineDash(s.dash || []); ctx.beginPath();
          let started = false;
          for (let i = start; i < end; i++) {
            const v = s.data[i];
            if (v == null || isNaN(v)) { started = false; continue; }
            const x = xOf(i), y = yOf(v);
            if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
          }
          ctx.stroke(); ctx.setLineDash([]);
        }
      }
    });

    // 황금 다이버전스 🐕 마커 (cfg.vmarkEmoji) — 첫 시리즈 값 위에
    if (cfg.vmark && cfg.vmarkEmoji) {
      ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      let shown = 0;
      for (let i = start; i < end && shown < 8; i++) {
        if (!cfg.vmark[i]) continue;
        const v0 = series[0] && series[0].data ? series[0].data[i] : null;
        const y = (v0 == null || isNaN(v0)) ? padT + plotH / 2 : yOf(v0);
        ctx.fillText(cfg.vmarkEmoji, xOf(i), Math.max(padT + 8, y - 14));
        shown++;
      }
    }
    // 🔻🔺 모멘텀 시그널 화살표 (cfg.sigMark[i] = 'sell'(과매수 반전 ▼빨강, 값 위)/'buy'(과매도 반전 ▲녹색, 값 아래))
    if (cfg.sigMark) {
      ctx.textAlign = 'center'; ctx.font = 'bold 15px system-ui';
      for (let i = start; i < end; i++) {
        const m = cfg.sigMark[i]; if (!m) continue;
        const v0 = series[0] && series[0].data ? series[0].data[i] : null;
        const y = (v0 == null || isNaN(v0)) ? padT + plotH / 2 : yOf(v0);
        if (m === 'sell') { ctx.fillStyle = '#f85149'; ctx.textBaseline = 'bottom'; ctx.fillText('▼', xOf(i), Math.max(padT + 14, y - 7)); }
        else { ctx.fillStyle = '#3fb950'; ctx.textBaseline = 'top'; ctx.fillText('▲', xOf(i), Math.min(padT + plotH - 14, y + 7)); }
      }
    }

    // ── 최신 지표값 우측 고정 태그 (가격차트 현재가 박스처럼) ──
    const lastI = Math.min(end, candles.length) - 1;
    if (lastI >= 0) {
      const drawnY = [];
      series.forEach(s => {
        if (!s.data || s.kind === 'hist') return;
        const v = s.data[lastI];
        if (v == null || isNaN(v)) return;
        let yy = yOf(v);
        while (drawnY.some(d => Math.abs(d - yy) < 13)) yy += 13;        // 겹치면 아래로 살짝 이동
        yy = Math.max(padT + 7, Math.min(yy, padT + plotH - 7));
        drawnY.push(yy);
        ctx.fillStyle = s.color || COL.text;
        ctx.fillRect(padL + plotW, yy - 7, padR, 13);
        ctx.fillStyle = '#0d1117'; ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(cfg.fixed ? Math.round(v).toString() : (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2)), padL + plotW + 3, yy);
      });
    }

    // 시그널 시점 세로선
    if (cfg.markTs != null) {
      const mi = candles.findIndex(k => k.ts === cfg.markTs);
      if (mi >= start && mi < end) {
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(xOf(mi), padT); ctx.lineTo(xOf(mi), padT + plotH); ctx.stroke(); ctx.setLineDash([]);
      }
    }

    // 크로스헤어 (메인 차트와 동기) + 그 봉의 지표값
    if (crossI != null && crossI >= start && crossI < end) {
      const xc = xOf(crossI);
      ctx.strokeStyle = 'rgba(230,237,243,0.55)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(xc, padT); ctx.lineTo(xc, padT + plotH); ctx.stroke();
      // 보조지표 자체 십자선 — 누른 지점 Y에 가로선 + 우측 노란 값 라벨 (캔들과 동일하게 osc에도 표시)
      if (cfg.crossY != null) {
        const yc = Math.max(padT, Math.min(cfg.crossY, padT + plotH));
        const vAtY = min + (padT + plotH - yc) / plotH * (max - min);
        ctx.beginPath(); ctx.moveTo(padL, yc); ctx.lineTo(padL + plotW, yc); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#ffd60a'; ctx.fillRect(padL + plotW, yc - 8, padR, 16);
        ctx.fillStyle = '#0d1117'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = 'bold 10px system-ui';
        ctx.fillText(cfg.fixed ? Math.round(vAtY).toString() : (Math.abs(vAtY) >= 10 ? vAtY.toFixed(0) : vAtY.toFixed(2)), padL + plotW + 4, yc);
      } else { ctx.setLineDash([]); }
      let vx = padL + 4;
      ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      series.forEach(s => {
        if (!s.data) return;
        const v = s.data[crossI];
        if (v == null || isNaN(v)) return;
        const txt = cfg.fixed ? Math.round(v).toString() : (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2));
        ctx.fillStyle = s.kind === 'hist' ? (v >= 0 ? COL.up : COL.down) : (s.color || COL.text);
        ctx.fillText(txt, vx, padT + 2);
        vx += ctx.measureText(txt).width + 8;
      });
    }
  }

  // 통합지표(BTI) 개별 지표 레인 렌더 — 각 지표 1행, 고점 징후(near) 시 파란 가로줄(Top=빨강) + 이름·현재값
  // 스토캐스틱 히트맵 (© Violent) — 2D 히트맵: 행=길이별 스토캐스틱, 셀 색=그 시점 값(저점 파랑→고점 빨강) + 강세 개수 흰/주황선.
  function _drawStochHeatmap(ctx, shm, candles, start, end, padL, padT, plotW, plotH, xOf) {
    const pn = shm.plotNumber || 0, lines = shm.lines || [], n = lines.length;
    if (!n || !shm.fast || !shm.fast.length) { ctx.fillStyle = COL.text; ctx.font = '11px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText('데이터 부족', padL + 6, padT + plotH / 2); return; }
    const cw = (end > start + 1) ? (xOf(start + 1) - xOf(start)) : 6, cellW = Math.max(1, cw);
    const heat = v => { v = Math.max(0, Math.min(100, v)); const d = Math.abs(v - 50) / 50, hue = 240 * (1 - v / 100); return 'hsl(' + hue + ',' + (55 + 33 * d) + '%,' + (30 + 22 * d) + '%)'; };   // 저점=파랑·고점=빨강 선명, 중간(녹·노랑)은 차분하지만 식별 가능(형광만 제거)
    const rowH = plotH / n, lineH = Math.max(1, rowH * 0.55);   // 행마다 얇은 띠 + 사이 어두운 간격(원본의 뚜렷한 가로선)
    // 2D 히트맵: 행 k(아래=짧은 길이, 위=긴 길이) 가로선, 시점마다 값으로 색 변화(세로 색변화)
    for (let k = 0; k < n; k++) {
      const arr = lines[k], yc = padT + plotH - (k + 0.5) * rowH - lineH / 2;
      for (let t = start; t < end; t++) { const v = arr[t]; if (v == null || isNaN(v)) continue; ctx.fillStyle = heat(v); ctx.fillRect(xOf(t) - cw / 2, yc, cellW, lineH); }
    }
    // 강세 개수 오실레이터(0~n): 주황(slow) + 흰색(fast)
    const yOf = v => padT + plotH - (Math.max(0, Math.min(n, v)) / n) * plotH;
    const drawLine = (arr, col, w) => { if (!arr) return; ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); let started = false; for (let i = start; i < end; i++) { const v = arr[i]; if (v == null || isNaN(v)) { started = false; continue; } const x = xOf(i), y = yOf(v); if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y); } ctx.stroke(); };
    drawLine(shm.slow, '#ff8c1a', 1.8);    // 주황 = 느린 카운트
    drawLine(shm.fast, '#ffffff', 1.4);    // 흰색 = 빠른 카운트
    // 헤더
    const last = end - 1, cv = shm.fast[last];
    ctx.fillStyle = '#e6edf3'; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('스토캐스틱 히트맵 · 강세 ' + ((cv != null && !isNaN(cv)) ? cv.toFixed(1) : '-') + '/' + pn, padL + 3, padT + 1);
  }

  // 수퍼트렌드 오버레이 — 추세선(상승 녹/하락 적, 전환 시 끊김) + ohlc4 사이 반투명 하이라이트 + Buy/Sell.
  function _drawSupertrend(ctx, st, candles, start, end, xOf, yOf) {
    const trend = st.trend || [], line = st.line || [], buy = st.buy || [], sell = st.sell || [];
    const cw = end > start + 1 ? (xOf(start + 1) - xOf(start)) : 6, bw = Math.max(1, cw);
    // 하이라이트 밴드 (추세선 ~ ohlc4)
    for (let i = start; i < end; i++) {
      const lv = line[i]; if (lv == null || isNaN(lv)) continue;
      const k = candles[i], o4 = (k.open + k.high + k.low + k.close) / 4, y1 = yOf(lv), y2 = yOf(o4);
      ctx.fillStyle = trend[i] === 1 ? 'rgba(38,166,91,0.10)' : 'rgba(245,82,74,0.10)';
      ctx.fillRect(xOf(i) - bw / 2, Math.min(y1, y2), bw, Math.abs(y2 - y1));
    }
    // 추세선 (추세 전환 시 path 끊김 = linebr)
    ctx.lineWidth = 2; ctx.setLineDash([]);
    let started = false, prevT = null;
    for (let i = start; i < end; i++) {
      const lv = line[i], t = trend[i];
      if (lv == null || isNaN(lv)) { if (started) { ctx.stroke(); started = false; } continue; }
      if (!started || t !== prevT) { if (started) ctx.stroke(); ctx.beginPath(); ctx.strokeStyle = t === 1 ? '#26a65b' : '#f5524a'; ctx.moveTo(xOf(i), yOf(lv)); started = true; }
      else ctx.lineTo(xOf(i), yOf(lv));
      prevT = t;
    }
    if (started) ctx.stroke();
    // Buy/Sell 마커 + 라벨
    ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'center';
    for (let i = start; i < end; i++) {
      if (buy[i] && line[i] != null && !isNaN(line[i])) { const y = yOf(line[i]); ctx.fillStyle = '#26a65b'; ctx.beginPath(); ctx.arc(xOf(i), y, 3, 0, 7); ctx.fill(); ctx.textBaseline = 'top'; ctx.fillText('Buy', xOf(i), y + 5); }
      if (sell[i] && line[i] != null && !isNaN(line[i])) { const y = yOf(line[i]); ctx.fillStyle = '#f5524a'; ctx.beginPath(); ctx.arc(xOf(i), y, 3, 0, 7); ctx.fill(); ctx.textBaseline = 'bottom'; ctx.fillText('Sell', xOf(i), y - 5); }
    }
  }

  // 구름대 (Ichimoku Cloud) — 구름(Kumo) 음영만 표시(라인 전부 제거, 사용자 요청 2026-06-18).
  //   선행A/선행B 사이를 +shift 미래로 변위해 채움. 선행A≥선행B 녹색 / 선행A<선행B 적색(반투명, 봉 단위 사다리꼴로 교차 색전환).
  function _drawIchimoku(ctx, ich, candles, start, end, padL, padT, plotW, priceH, xOf, yOf) {
    const sh = ich.shift || 25;
    const leadA = ich.leadA, leadB = ich.leadB;
    ctx.save(); ctx.beginPath(); ctx.rect(padL, padT, plotW, priceH); ctx.clip();
    const from = Math.max(0, start - sh - 1);
    for (let i = from; i < end - 1; i++) {
      const a0 = leadA[i], b0 = leadB[i], a1 = leadA[i + 1], b1 = leadB[i + 1];
      if (a0 == null || isNaN(a0) || b0 == null || isNaN(b0) || a1 == null || isNaN(a1) || b1 == null || isNaN(b1)) continue;
      const x0 = xOf(i + sh), x1 = xOf(i + 1 + sh);
      const up = (a0 + a1) >= (b0 + b1);   // 구간 평균으로 색 결정
      ctx.fillStyle = up ? 'rgba(63,185,80,0.40)' : 'rgba(248,81,73,0.40)';
      ctx.beginPath();
      ctx.moveTo(x0, yOf(a0)); ctx.lineTo(x1, yOf(a1)); ctx.lineTo(x1, yOf(b1)); ctx.lineTo(x0, yOf(b0));
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  // 다이버전스 오버레이(원본 LonesomeTheBlue) — 매칭된 이전 피벗들로 각도 라인 다중 + 지표명/개수 라벨.
  //   강세(bull)=하단 노랑 라벨(검정 글자), 약세(bear)=상단 네이비 라벨(흰 글자). 라인도 동색.
  function _drawDivergence(ctx, ind, candles, start, end, padL, padT, plotW, priceH, xOf, yOf) {
    const bull = ind.divBull || [], bear = ind.divBear || [];
    const COL_BULL = '#f7e84e', COL_BEAR = '#3d51d4';
    function label(x, yAnchor, names, count, bg, fg, down) {
      ctx.font = '8px -apple-system,system-ui,sans-serif'; ctx.textBaseline = 'top'; ctx.textAlign = 'center';
      const ln = names.slice(0, 8), lh = 9, padY = 2, padX = 4;
      let tw = ctx.measureText('' + count).width;
      for (const t of ln) tw = Math.max(tw, ctx.measureText(t).width);
      const boxW = tw + padX * 2, boxH = (ln.length + 1) * lh + padY * 2;
      let bx = x - boxW / 2; bx = Math.max(padL, Math.min(bx, padL + plotW - boxW));
      let by = down ? yAnchor + 7 : yAnchor - 7 - boxH;
      by = Math.max(padT, Math.min(by, padT + priceH - boxH));
      ctx.globalAlpha = 0.92; ctx.fillStyle = bg; ctx.fillRect(bx, by, boxW, boxH); ctx.globalAlpha = 1;
      ctx.fillStyle = fg; let ty = by + padY;
      for (const nm of ln) { ctx.fillText(nm, bx + boxW / 2, ty); ty += lh; }
      ctx.font = 'bold 9px system-ui'; ctx.fillText('' + count, bx + boxW / 2, ty);
    }
    const drawLines = (lines, i2, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([]);
      (lines || []).forEach(i1 => { if (i1 != null && i1 < i2) { ctx.beginPath(); ctx.moveTo(xOf(i1), yOf(candles[i1].close)); ctx.lineTo(xOf(i2), yOf(candles[i2].close)); ctx.stroke(); } });   // 연결 피벗이 화면 밖(왼쪽)이어도 라인 렌더(원본처럼 가장자리로 들어옴)
    };
    for (let i = start; i < end; i++) {
      const b = bull[i];
      if (b) { drawLines(b.lines || (b.i1 != null ? [b.i1] : []), i, COL_BULL); label(xOf(i), yOf(candles[i].low), b.names, b.count, COL_BULL, '#1a1500', true); }
      const s = bear[i];
      if (s) { drawLines(s.lines || (s.i1 != null ? [s.i1] : []), i, COL_BEAR); label(xOf(i), yOf(candles[i].high), s.names, s.count, COL_BEAR, '#ffffff', false); }
    }
  }

  function _drawBtiLanes(ctx, bti, start, end, padL, padT, plotW, plotH, cw, xOf) {
    const keys = bti.keys || [], sub = bti.sub || {}, n = keys.length;
    if (!n) { ctx.fillStyle = COL.text; ctx.font = '11px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText('데이터 부족', padL + 6, padT + plotH / 2); return; }
    const bandH = 13;                          // 하단 사이클 신호 밴드 높이
    const lanesH = Math.max(10, plotH - bandH - 2);
    const laneH = lanesH / n;
    ctx.font = '9px -apple-system,system-ui,sans-serif';
    ctx.textBaseline = 'middle';
    const last = end - 1;
    let topNow = 0, botNow = 0;
    for (let k = 0; k < n; k++) {
      const key = keys[k], yc = padT + (k + 0.5) * laneH;
      const near = (sub[key] && sub[key].near) || [], botNear = (sub[key] && sub[key].botNear) || [], prox = (sub[key] && sub[key].prox) || [];
      // 레인 베이스라인
      ctx.strokeStyle = 'rgba(127,127,127,0.10)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, yc); ctx.lineTo(padL + plotW, yc); ctx.stroke();
      // 지표별 신호 가로줄 — 고점=빨강 / 저점=녹색
      const segH = Math.max(3, Math.min(6, laneH - 3));
      for (let i = start; i < end; i++) {
        if (near[i]) ctx.fillStyle = '#f5524a';
        else if (botNear[i]) ctx.fillStyle = '#22c55e';
        else continue;
        ctx.fillRect(xOf(i) - cw / 2, yc - segH / 2, Math.max(1.2, cw), segH);
      }
      const onTop = !!near[last], onBot = !!botNear[last];
      if (onTop) topNow++; if (onBot) botNow++;
      // 이름 라벨(좌) + 현재 근접도(우) — 고점 빨강 / 저점 녹색
      ctx.fillStyle = onTop ? '#ffb4b1' : onBot ? '#86efac' : 'rgba(139,148,158,0.85)'; ctx.textAlign = 'left';
      ctx.fillText(key, padL + 3, yc);
      const cv = prox[last];
      if (!isNaN(cv)) { ctx.fillStyle = onTop ? '#f5524a' : onBot ? '#22c55e' : '#6b7280'; ctx.textAlign = 'right'; ctx.fillText(cv.toFixed(2), padL + plotW - 3, yc); }
    }
    // ── 하단 밴드: 사이클 고점(빨강 3단계)/저점(녹색 3단계) — 개수 많을수록 진하게 ──
    const bandY = padT + plotH - bandH;
    const topC = bti.btiCount || [], botC = bti.botCount || [];
    const stg = c => c >= 7 ? 1.0 : c >= 5 ? 0.62 : 0.32;   // 3단계 농도 (≥3 약 / ≥5 중 / ≥7 강)
    for (let i = start; i < end; i++) {
      const tc = topC[i] || 0, bc = botC[i] || 0;
      let col = null;
      if (tc >= 3 && tc >= bc) col = 'rgba(245,82,74,' + stg(tc) + ')';   // 고점 빨강 3단계
      else if (bc >= 3) col = 'rgba(34,197,94,' + stg(bc) + ')';           // 저점 녹색 3단계
      if (!col) continue;
      ctx.fillStyle = col; ctx.fillRect(xOf(i) - cw / 2, bandY, Math.max(1.2, cw), bandH);
    }
    // 상단 헤더 — 현재 고점/저점 카운트
    ctx.fillStyle = '#e6edf3'; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('고점저점통합 · 고점 ' + topNow + '/' + n + ' · 저점 ' + botNow + '/' + n, padL + 3, padT + 1);
  }

  function _drawZones(ctx, flags, start, end, xOf, cw, padT, plotH, fill, border, label) {
    if (!flags) return;
    let runStart = -1;
    let labeled = false;
    for (let i = start; i <= end; i++) {
      const on = i < end && flags[i];
      if (on && runStart < 0) runStart = i;
      if (!on && runStart >= 0) {
        const x0 = xOf(runStart) - cw / 2;
        const x1 = xOf(i - 1) + cw / 2;
        ctx.fillStyle = fill;
        ctx.fillRect(x0, padT, x1 - x0, plotH);
        ctx.strokeStyle = border; ctx.lineWidth = 1;
        ctx.strokeRect(x0, padT, x1 - x0, plotH);
        if (!labeled && (x1 - x0) > 26) {
          ctx.fillStyle = border; ctx.font = '9px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
          ctx.fillText(label, x0 + 2, padT + 2);
          labeled = true;
        }
        runStart = -1;
      }
    }
  }

  // 4년주기 사이클: 반감기 세로선(주황) · Profit START(녹색 점선) · END(빨간 점선) 수직선 + 말풍선 라벨
  function _drawCycleMarks(ctx, marks, start, end, xOf, padT, plotH) {
    if (!marks || !marks.length) return;
    const bottom = padT + plotH;
    function box(x, anchorTop, lines, bg, fg) {
      ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'center';
      let w = 0; lines.forEach(function (s) { w = Math.max(w, ctx.measureText(s).width); });
      const bw = w + 10, lh = 11, bh = lines.length * lh + 6;
      let bx = x - bw / 2; bx = Math.max(2, Math.min(bx, ctx.canvas.width / (window.devicePixelRatio || 1) - bw - 2));
      const by = anchorTop ? padT + 2 : bottom - bh - 2;
      ctx.fillStyle = bg; ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = fg; ctx.textBaseline = 'top';
      lines.forEach(function (s, k) { ctx.fillText(s, bx + bw / 2, by + 3 + k * lh); });
    }
    marks.forEach(function (m) {
      if (m.barIdx == null || m.barIdx < start || m.barIdx >= end) return;
      const x = xOf(m.barIdx);
      if (m.kind === 'halving') {
        ctx.save(); ctx.setLineDash([6, 4]); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,123,0,0.9)';
        ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, bottom); ctx.stroke(); ctx.restore();
        box(x, true, ['⛏ Halving', m.mdy], 'rgba(255,136,0,0.92)', '#000');
      } else if (m.kind === 'start') {
        ctx.save(); ctx.setLineDash([]); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(17,255,0,0.95)';
        ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, bottom); ctx.stroke(); ctx.restore();
        box(x, true, ['Profit', 'START'], 'rgba(17,255,0,0.92)', '#000');
      } else if (m.kind === 'end') {
        ctx.save(); ctx.setLineDash([]); ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(248,81,73,1)';
        ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, bottom); ctx.stroke(); ctx.restore();
        box(x, true, ['Profit', 'END'], 'rgba(248,81,73,0.95)', '#fff');
      } else if (m.kind === 'dca') {
        box(x, false, ['→ DCA'], 'rgba(226,246,0,0.92)', '#000');
      }
    });
    ctx.setLineDash([]);
  }

  function _line(ctx, arr, start, end, xOf, yOf, color, lw, dash) {
    if (!arr) return;
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.setLineDash(dash || []); ctx.beginPath();
    let started = false;
    for (let i = start; i < end; i++) {
      const v = arr[i];
      if (v == null || isNaN(v)) { started = false; continue; }
      const x = xOf(i), y = yOf(v);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.setLineDash([]);
  }

  // 두 시리즈 사이 밴드 채움 (파워로 등) — a(좌→우) + b(우→좌) 폐곡선
  function _plBand(ctx, a, b, start, end, xOf, yOf, fill) {
    if (!a || !b) return;
    ctx.fillStyle = fill; ctx.beginPath(); let started = false;
    for (let i = start; i < end; i++) { const v = a[i]; if (v == null || !isFinite(v)) continue; const x = xOf(i), y = yOf(v); if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y); }
    if (!started) return;
    for (let i = end - 1; i >= start; i--) { const v = b[i]; if (v == null || !isFinite(v)) continue; ctx.lineTo(xOf(i), yOf(v)); }
    ctx.closePath(); ctx.fill();
  }
  function _tri(ctx, x, y, r, up, color) {
    ctx.fillStyle = color; ctx.beginPath();
    if (up) { ctx.moveTo(x, y - r); ctx.lineTo(x - r, y + r); ctx.lineTo(x + r, y + r); }
    else { ctx.moveTo(x, y + r); ctx.lineTo(x - r, y - r); ctx.lineTo(x + r, y - r); }
    ctx.closePath(); ctx.fill();
  }

  function _findIdx(candles, ts, start, end) {
    for (let i = start; i < end; i++) if (candles[i].ts === ts) return i;
    return -1;
  }

  function _msg(ctx, w, h, t) {
    ctx.fillStyle = '#8b949e'; ctx.font = '13px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(t, w / 2, h / 2);
  }

  global.NChart = { create };
})(typeof window !== 'undefined' ? window : globalThis);
