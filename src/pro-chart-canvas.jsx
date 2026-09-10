import React, { useEffect, useRef } from "react";
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
  onHover,
  onViewChange,
  height = 420,
}) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

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
      onHover,
      onViewChange,
    });
    chart.setData(candles, view);
    chart.draw();
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
    chart.setData(candles, view);
    chart.draw();
  }, [candles, view, overlays, showRainbow, showHalving]);

  return (
    <canvas
      ref={canvasRef}
      className="pro-chart-canvas"
      style={{ width: "100%", height, display: "block", touchAction: "none" }}
    />
  );
}
