import React, { useEffect, useRef, useState } from "react";
import NChart from "./nchart";

/**
 * React wrapper around NChart.create / setData / draw.
 * Pinch + horizontal pan are handled inside the canvas engine (touch-action: none).
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
      onHover,
      onViewChange,
    });
    chart.setData(candles, view);
    const first = chart.draw();
    setGogoComment(first?.gogoZones?.comment || "");
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
    chart.setData(candles, view);
    const next = chart.draw();
    setGogoComment(showGogoZones ? (next?.gogoZones?.comment || "") : "");
  }, [candles, view, overlays, showRainbow, showHalving, showGogoZones]);

  return (
    <div>
      <canvas
        ref={canvasRef}
        className="pro-chart-canvas"
        style={{ width: "100%", height, display: "block", touchAction: "none" }}
      />
      {gogoComment ? (
        <div style={{ color: "#8aa4b5", fontSize: 11, padding: "6px 4px 0" }}>{gogoComment}</div>
      ) : null}
    </div>
  );
}
