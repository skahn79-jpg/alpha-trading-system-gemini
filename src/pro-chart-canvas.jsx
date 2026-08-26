import React, { useEffect, useMemo, useRef, useState } from "react";
import "./nchart.js";
import "./ndraw.js";
import "./nindicators.js";
import "./ncvdd.js";
import "./nbti.js";
import "./nbubble.js";
import "./nbbp.js";
import "./nlth.js";

const TOOLS = [
  { id: null, label: "이동" },
  { id: "hline", label: "가로줄" },
  { id: "vline", label: "세로줄" },
  { id: "trend", label: "추세선" },
  { id: "channel", label: "채널" },
  { id: "arrowUp", label: "화살표↑" },
  { id: "arrowDown", label: "화살표↓" },
  { id: "cross", label: "십자선" },
  { id: "erase", label: "지우개" },
];

const COMMON_OVERLAYS = [
  { id: "ma", label: "이평" },
  { id: "bb", label: "볼린저" },
  { id: "st", label: "슈퍼트렌드" },
  { id: "ich", label: "일목구름" },
  { id: "vp", label: "매물대" },
  { id: "sig", label: "시그널" },
  { id: "gc", label: "골든크로스" },
  { id: "div", label: "다이버전스" },
];

const CRYPTO_OVERLAYS = [
  { id: "pi", label: "파이사이클" },
  { id: "cvdd", label: "CVDD" },
  { id: "cycle", label: "4년주기" },
  { id: "lth", label: "LTH" },
  { id: "pl", label: "파워로" },
  { id: "uodiv", label: "강세다이브" },
];

const OSC_COMMON = [
  { id: "stoch", label: "스토캐스틱" },
  { id: "macd", label: "MACD" },
  { id: "rsi", label: "RSI" },
  { id: "heat", label: "히트맵" },
];

const OSC_CRYPTO = [
  { id: "bti", label: "BTI" },
  { id: "puell", label: "Puell" },
];

const DEFAULT_OV = {
  ma: true, bb: true, st: true, ich: false, vp: true, sig: true, gc: true, div: false,
  pi: true, cvdd: false, cycle: true, lth: false, pl: false, uodiv: false,
};

const LS_OV = "alpha-chart-overlays";
const LS_OSC = "alpha-chart-osc";

function loadOv() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_OV) || "{}");
    return { ...DEFAULT_OV, ...raw };
  } catch (_e) {
    return { ...DEFAULT_OV };
  }
}

function toTs(date, index) {
  if (date == null) return index;
  const s = String(date);
  const m = s.match(/(\d{4})[-./]?(\d{2})[-./]?(\d{2})/);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : index;
}

function mapCandles(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((c, i) => ({
    ts: toTs(c.date ?? c.ts, i),
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: Number(c.volume) || 0,
    date: c.date,
  })).filter((c) => Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close));
}

function fmt(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  if (Math.abs(n) >= 1000) return Math.round(n).toLocaleString("ko-KR");
  if (Math.abs(n) >= 100) return n.toFixed(1);
  return n.toFixed(2);
}

function localXY(el, e) {
  const r = el.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function applyOverlays(chart, ov, isCrypto) {
  if (!chart) return;
  chart._maOn = !!ov.ma;
  chart._bbOn = !!ov.bb;
  chart._stOn = !!ov.st;
  chart._ichOn = !!ov.ich;
  chart._vpOn = !!ov.vp;
  chart._showSig = !!ov.sig;
  chart._gcOn = !!ov.gc;
  chart._divOn = !!ov.div;
  chart._uoDivOn = !!(isCrypto && ov.uodiv);
  chart._piOn = !!(isCrypto && ov.pi);
  chart._cvddOn = !!(isCrypto && ov.cvdd);
  chart._cycleOn = !!(isCrypto && ov.cycle);
  chart._lthOn = !!(isCrypto && ov.lth);
  chart._plOn = !!(isCrypto && ov.pl);
}

function buildOsc(canvas, osc, ind, isCrypto) {
  if (!canvas || !ind) return null;
  if (osc === "stoch" && ind.K) {
    return {
      canvas,
      series: [
        { data: ind.K, color: "#3fb950", w: 1.4 },
        { data: ind.D, color: "#f85149", w: 1.2 },
      ],
      fixed: [0, 100],
      bands: [
        { v: 80, label: "80", color: "rgba(248,81,73,0.7)", dash: [3, 3] },
        { v: 20, label: "20", color: "rgba(63,185,80,0.7)", dash: [3, 3] },
        { v: 50, label: "50", color: "#1c2128", dash: [2, 4] },
      ],
      obShade: { ob: 80, os: 20 },
    };
  }
  if (osc === "macd" && ind.macdLine) {
    return {
      canvas,
      series: [
        { kind: "hist", data: ind.macdHist },
        { data: ind.macdLine, color: "#58a6ff", w: 1.3 },
        { data: ind.macdSig, color: "#f85149", w: 1.1 },
      ],
      zero: true,
    };
  }
  if (osc === "rsi") {
    const a = ind.uRsi || ind.rsiK;
    const b = ind.uRsiSignal || ind.rsiD;
    if (!a) return null;
    return {
      canvas,
      series: [
        { data: a, color: "#a78bfa", w: 1.4 },
        { data: b, color: "#f59e0b", w: 1.1 },
      ],
      fixed: [0, 100],
      bands: [
        { v: 70, label: "70", color: "rgba(248,81,73,0.7)", dash: [3, 3] },
        { v: 30, label: "30", color: "rgba(63,185,80,0.7)", dash: [3, 3] },
        { v: 50, label: "50", color: "#1c2128", dash: [2, 4] },
      ],
      obShade: { ob: 70, os: 30 },
    };
  }
  if (osc === "heat" && ind.shm) {
    return { canvas, shm: ind.shm };
  }
  if (isCrypto && osc === "bti" && ind.bti) {
    return { canvas, btiLanes: ind.bti };
  }
  if (isCrypto && osc === "puell" && ind.puell) {
    const data = Array.isArray(ind.puell) ? ind.puell : ind.puell.puell;
    if (!data) return null;
    return {
      canvas,
      series: [{ data, color: "#f59e0b", w: 1.4 }],
      bands: [
        { v: 4, label: "4", color: "rgba(248,81,73,0.7)", dash: [3, 3] },
        { v: 0.5, label: "0.5", color: "rgba(63,185,80,0.7)", dash: [3, 3] },
      ],
    };
  }
  return null;
}

function zoneClass(cls) {
  if (cls === "strong") return "#ffd33d";
  if (cls === "low") return "#3fb950";
  if (cls === "high") return "#f85149";
  return "#8b949e";
}

export default function ProChartCanvas({ candles, drawKey = "alpha-draw", onHoverIndex, isCrypto = false }) {
  const rootRef = useRef(null);
  const mainRef = useRef(null);
  const oscRef = useRef(null);
  const chartRef = useRef(null);
  const layerRef = useRef(null);
  const dragRef = useRef(null);
  const indRef = useRef(null);
  const [tool, setTool] = useState(null);
  const [hover, setHover] = useState(null);
  const [ready, setReady] = useState(0);
  const [ov, setOv] = useState(loadOv);
  const [osc, setOsc] = useState(() => {
    try { return localStorage.getItem(LS_OSC) || "stoch"; } catch (_e) { return "stoch"; }
  });
  const [zone, setZone] = useState({ state: "중립", cls: "neutral" });

  const mapped = useMemo(() => mapCandles(candles), [candles]);
  const oscOptions = isCrypto ? OSC_COMMON.concat(OSC_CRYPTO) : OSC_COMMON;

  useEffect(() => {
    const canvas = mainRef.current;
    if (!canvas || !window.NChart) return undefined;
    const chart = window.NChart.create(canvas);
    applyOverlays(chart, ov, isCrypto);
    chartRef.current = chart;
    if (window.NDraw) {
      const layer = window.NDraw.create(chart, () => drawKey);
      chart.setDrawLayer(layer);
      layer.load();
      layerRef.current = layer;
    }
    setReady((n) => n + 1);
    const root = rootRef.current;
    let ro = null;
    if (root && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => {
        try { chart.draw(); } catch (_e) { /* ignore */ }
      });
      ro.observe(root);
    }
    const onResize = () => {
      try { chart.draw(); } catch (_e) { /* ignore */ }
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (ro) ro.disconnect();
      chartRef.current = null;
      layerRef.current = null;
    };
  }, [drawKey]);

  useEffect(() => {
    const canvas = mainRef.current;
    if (!canvas) return undefined;
    const onWheel = (e) => {
      const chart = chartRef.current;
      if (!chart) return;
      e.preventDefault();
      if (e.shiftKey) chart.yZoomBy(e.deltaY > 0 ? 0.9 : 1.1);
      else chart.zoom(e.deltaY > 0 ? 1.12 : 0.88);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [ready]);

  useEffect(() => {
    try { localStorage.setItem(LS_OV, JSON.stringify(ov)); } catch (_e) { /* ignore */ }
    const chart = chartRef.current;
    if (!chart) return;
    applyOverlays(chart, ov, isCrypto);
    try { chart.draw(); } catch (_e) { /* ignore */ }
  }, [ov, isCrypto]);

  useEffect(() => {
    try { localStorage.setItem(LS_OSC, osc); } catch (_e) { /* ignore */ }
    const chart = chartRef.current;
    if (!chart) return;
    const cfg = buildOsc(oscRef.current, osc, indRef.current, isCrypto);
    chart.setOscs(cfg ? [cfg] : []);
    try { chart.draw(); } catch (_e) { /* ignore */ }
  }, [osc, isCrypto, ready]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !mapped.length) return;
    if (layerRef.current) {
      layerRef.current.getKey = () => drawKey;
      layerRef.current.load();
    }
    let ind = null;
    let signals = [];
    try {
      if (window.Indicators && typeof window.Indicators.compute === "function") {
        ind = window.Indicators.compute(mapped, {});
        if (isCrypto && window.LTHSupply && typeof window.LTHSupply.compute === "function") {
          try { ind.lth = window.LTHSupply.compute(mapped); } catch (_e) { /* ignore */ }
        }
        if (typeof window.Indicators.buildSignals === "function") {
          signals = window.Indicators.buildSignals(mapped, ind, "1d", {}) || [];
        }
        if (typeof window.Indicators.currentZone === "function") {
          setZone(window.Indicators.currentZone(ind) || { state: "중립", cls: "neutral" });
        }
      }
    } catch (_e) {
      ind = null;
      signals = [];
      setZone({ state: "중립", cls: "neutral" });
    }
    indRef.current = ind;
    chart.setData({ candles: mapped, ind, signals });
    applyOverlays(chart, ov, isCrypto);
    const cfg = buildOsc(oscRef.current, osc, ind, isCrypto);
    chart.setOscs(cfg ? [cfg] : []);
    chart.draw();
  }, [mapped, drawKey, ready, isCrypto]);

  const applyTool = (id) => {
    setTool(id);
    const chart = chartRef.current;
    const layer = layerRef.current;
    if (chart) chart._drawMode = !!id;
    if (layer) layer.setTool(id);
  };

  const toggleOv = (id) => setOv((prev) => ({ ...prev, [id]: !prev[id] }));

  const onPointerDown = (e) => {
    const canvas = mainRef.current;
    const chart = chartRef.current;
    if (!canvas || !chart) return;
    canvas.setPointerCapture(e.pointerId);
    const { x, y } = localXY(canvas, e);
    if (chart._drawMode && layerRef.current) {
      layerRef.current.down(x, y);
      return;
    }
    dragRef.current = { x, start: chart.view.start, count: chart.view.count };
  };

  const onPointerMove = (e) => {
    const canvas = mainRef.current;
    const chart = chartRef.current;
    if (!canvas || !chart || !mapped.length) return;
    const { x, y } = localXY(canvas, e);
    if (chart._drawMode && layerRef.current) {
      layerRef.current.move(x, y);
      return;
    }
    const tf = chart._tf;
    if (tf) {
      const idx = Math.round(tf.start + (x - tf.padL - tf.cw / 2) / tf.cw);
      const clamped = Math.max(0, Math.min(mapped.length - 1, idx));
      chart.setCrosshair(clamped, y);
      chart.draw();
      setHover(mapped[clamped]);
      if (typeof onHoverIndex === "function") onHoverIndex(clamped);
    }
    const drag = dragRef.current;
    if (drag && tf) {
      const delta = Math.round((drag.x - x) / Math.max(1, tf.cw));
      chart.setView(drag.start + delta, drag.count);
      chart.draw();
    }
  };

  const onPointerUp = (e) => {
    const canvas = mainRef.current;
    const chart = chartRef.current;
    if (canvas && chart && chart._drawMode && layerRef.current) {
      const { x, y } = localXY(canvas, e);
      layerRef.current.up(x, y);
    }
    dragRef.current = null;
  };

  const onPointerLeave = () => {
    const chart = chartRef.current;
    dragRef.current = null;
    if (chart) {
      chart.setCrosshair(null);
      chart.draw();
    }
    setHover(null);
    if (typeof onHoverIndex === "function") onHoverIndex(null);
  };

  const oscLabel = (oscOptions.find((x) => x.id === osc) || OSC_COMMON[0]).label;

  return (
    <div className="nchart-root" ref={rootRef}>
      <div className="nchart-toolbar">
        {TOOLS.map((t) => (
          <button
            key={String(t.id)}
            type="button"
            className={`btn ${tool === t.id ? "nchart-tool-on" : ""}`}
            onClick={() => applyTool(t.id)}
          >
            {t.label}
          </button>
        ))}
        <button type="button" className="btn" onClick={() => layerRef.current && layerRef.current.undo()}>실행취소</button>
        <button type="button" className="btn" onClick={() => layerRef.current && layerRef.current.clearAll()}>모두 지우기</button>
        <button type="button" className="btn" onClick={() => chartRef.current && chartRef.current.resetY()}>가격축 리셋</button>
        <span className="nchart-zone" style={{ color: zoneClass(zone.cls) }}>{zone.state}</span>
      </div>
      <div className="nchart-toolbar nchart-overlays">
        {COMMON_OVERLAYS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`btn ${ov[t.id] ? "nchart-tool-on" : ""}`}
            onClick={() => toggleOv(t.id)}
          >
            {t.label}
          </button>
        ))}
        {isCrypto && CRYPTO_OVERLAYS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`btn ${ov[t.id] ? "nchart-tool-on" : ""}`}
            onClick={() => toggleOv(t.id)}
          >
            {t.label}
          </button>
        ))}
        <span className="nchart-osc-sep">하단</span>
        {oscOptions.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`btn ${osc === t.id ? "nchart-tool-on" : ""}`}
            onClick={() => setOsc(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {hover && (
        <div className="chart-tooltip" style={{ left: "74px", top: "78px" }}>
          <b>{hover.date || ""}</b><br />
          시가: {fmt(hover.open)} / 고가: {fmt(hover.high)}<br />
          저가: {fmt(hover.low)} / 종가: {fmt(hover.close)}<br />
          거래량: {fmt(hover.volume)}
        </div>
      )}
      <canvas
        ref={mainRef}
        className="nchart-main"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
      />
      <div className="nchart-osc-label">{oscLabel}</div>
      <canvas ref={oscRef} className="nchart-osc" />
      <style>{`
        .nchart-root{position:relative;width:100%;height:100%;display:flex;flex-direction:column;background:#0d1117;border-radius:10px;overflow:hidden}
        .nchart-toolbar{display:flex;flex-wrap:wrap;gap:5px;padding:6px 10px;border-bottom:1px solid #1c2128;flex:0 0 auto;align-items:center}
        .nchart-overlays{padding-top:4px;padding-bottom:6px}
        .nchart-tool-on{outline:1px solid #3fb950;background:#16301f}
        .nchart-zone{margin-left:auto;font-size:12px;font-weight:800;letter-spacing:.4px}
        .nchart-osc-sep{color:#6e7681;font-size:11px;font-weight:700;margin-left:6px}
        .nchart-main{flex:1 1 auto;width:100%;min-height:240px;touch-action:none;cursor:crosshair}
        .nchart-osc{width:100%;height:88px;display:block;flex:0 0 88px;touch-action:none}
        .nchart-osc-label{color:#8b949e;font-size:11px;font-weight:700;padding:4px 10px 0;letter-spacing:.4px;flex:0 0 auto}
      `}</style>
    </div>
  );
}
