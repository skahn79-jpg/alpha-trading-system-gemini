import React, { useEffect, useRef, useState } from "react";
import NChart from "./nchart";

/**
 * React wrapper around NChart.create / setData / draw.
 * Pinch + horizontal pan are handled inside the canvas engine (touch-action: none).
 * 고고저: auto-fits window to pivots ①/②; drag markers to override; 초기화/자동 resets.
 */
export default function ProChartCanvas({
  candles = [],
  view,
  symbol,
  timeframe = "D",
  assetType,
  overlays,
  drawings,
  showRainbow = false,
  showHalving = false,
  showGogoZones = true,
  onHover,
  onViewChange,
  height = 420,
}) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const [gogoComment, setGogoComment] = useState("");
  const [gogoManual, setGogoManual] = useState(false);
  const prevShowGogo = useRef(showGogoZones);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const chart = NChart.create(canvas, {
      symbol,
      timeframe,
      assetType,
      overlays,
      drawings,
      showRainbow,
      showHalving,
      showGogoZones,
      period: timeframe,
      onHover,
      onViewChange,
      onGogoChange: (zones) => {
        setGogoComment(zones?.comment || "");
        setGogoManual(Boolean(chartRef.current?._gogoUserAdjusted));
      },
    });
    chart.setData(candles, view);
    const first = chart.draw();
    setGogoComment(first?.gogoZones?.comment || "");
    setGogoManual(Boolean(chart._gogoUserAdjusted));
    chartRef.current = chart;
    const onResize = () => chart.draw();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.destroy();
      chartRef.current = null;
    };
  }, [symbol, timeframe, assetType]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.options.overlays = overlays;
    chart.options.showRainbow = showRainbow;
    chart.options.showHalving = showHalving;
    chart.options.showGogoZones = showGogoZones;
    chart.options.period = timeframe;
    chart.options.onGogoChange = (zones) => {
      setGogoComment(zones?.comment || "");
      setGogoManual(Boolean(chart._gogoUserAdjusted));
    };
    if (showGogoZones && !prevShowGogo.current) {
      chart._gogoFitted = false;
      chart.fitViewToGogo(true);
    }
    prevShowGogo.current = showGogoZones;
    chart.setData(candles, view);
    const next = chart.draw();
    setGogoComment(showGogoZones ? (next?.gogoZones?.comment || "") : "");
    setGogoManual(Boolean(chart._gogoUserAdjusted));
  }, [candles, view, overlays, showRainbow, showHalving, showGogoZones, timeframe]);

  const resetGogo = () => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.resetGogoManual();
    const next = chart.draw();
    setGogoComment(next?.gogoZones?.comment || "");
    setGogoManual(false);
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        className="pro-chart-canvas"
        style={{ width: "100%", height, display: "block", touchAction: "none" }}
      />
      {gogoComment ? (
        <div style={{ color: "#8aa4b5", fontSize: 11, padding: "6px 4px 0", display: "flex", gap: 8, alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>{gogoComment}</div>
          {gogoManual ? (
            <button
              type="button"
              onClick={resetGogo}
              style={{
                border: "1px solid #ff446688",
                background: "#48111b",
                color: "#ffb4c0",
                fontSize: 11,
                fontWeight: 800,
                padding: "4px 8px",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              초기화/자동
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
