import React, { useMemo, useState } from "react";
import PaneChart from "./pane-chart";
import ProChartCanvas from "./pro-chart-canvas";

/** Synced multi-pane chart (price + volume/osc) — React, not a raw IIFE. */
export default function MultiChart({ candles = [], symbol, timeframe = "D", linked = true }) {
  const [view, setView] = useState({ count: 80, offset: 0 });
  const panes = useMemo(
    () => PaneChart.syncTimeScale(PaneChart.linkPanes(PaneChart.defaultPanes(), linked), view),
    [linked, view]
  );

  return (
    <div className="multi-chart">
      {panes.map((pane) => (
        <ProChartCanvas
          key={pane.id}
          candles={candles}
          view={pane.view || view}
          symbol={symbol}
          timeframe={timeframe}
          height={pane.height}
          onViewChange={(next) => setView((prev) => ({ ...prev, ...next }))}
        />
      ))}
    </div>
  );
}
