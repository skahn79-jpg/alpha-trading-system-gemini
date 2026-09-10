/**
 * Pane-chart helpers — synced / linked panes (React-friendly, no IIFE).
 */

"use strict";

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function createPane(id, options = {}) {
  return {
    id,
    kind: options.kind || "price",
    height: options.height || (options.kind === "price" ? 280 : 110),
    linked: options.linked !== false,
    osc: options.osc || (options.kind === "rsi" ? "rsi" : options.kind === "cmo" ? "cmo" : null),
  };
}

function defaultPanes() {
  return [
    createPane("price", { kind: "price", height: 300 }),
    createPane("volume", { kind: "volume", height: 90 }),
    createPane("rsi", { kind: "osc", osc: "rsi", height: 110 }),
  ];
}

function syncTimeScale(panes, view) {
  const count = Math.max(1, Number(view?.count) || 80);
  const offset = Math.max(0, Number(view?.offset) || 0);
  return (panes || []).map((pane) => (
    pane.linked === false
      ? { ...pane, view: pane.view || { count, offset } }
      : { ...pane, view: { count, offset } }
  ));
}

function linkPanes(panes, linked = true) {
  return (panes || []).map((pane) => ({ ...pane, linked }));
}

function nextView(view, { deltaOffset = 0, zoom = 1, maxCount = 500 } = {}) {
  const count = clamp(Math.round((view?.count || 80) * zoom), 20, maxCount);
  const offset = Math.max(0, (view?.offset || 0) + deltaOffset);
  return { count, offset };
}

const PaneChart = {
  createPane,
  defaultPanes,
  syncTimeScale,
  linkPanes,
  nextView,
};

export default PaneChart;
export { createPane, defaultPanes, syncTimeScale, linkPanes, nextView };
