/**
 * Shared chart zoom/pan math for iPhone Safari and canvas charts.
 * Page scroll stays available unless the gesture is a horizontal pan or pinch.
 */

"use strict";

const MIN_COUNT = 20;

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function touchDistance(t0, t1) {
  return Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
}

function isHorizontalPan(dx, dy) {
  return Math.abs(dx) > Math.abs(dy);
}

function nextVisibleCount(baseCount, scale, total) {
  const safeScale = Math.max(0.05, Number(scale) || 1);
  const next = Math.round(baseCount / safeScale);
  return clamp(next, MIN_COUNT, Math.max(MIN_COUNT, total || MIN_COUNT));
}

function nextOffset(startOffset, translationX, chartWidth, visibleCount, total) {
  const barWidth = Math.max(2, (chartWidth || 1) / Math.max(1, visibleCount));
  const deltaBars = Math.round(translationX / barWidth);
  const maxOffset = Math.max(0, (total || 0) - visibleCount);
  return clamp((startOffset || 0) + deltaBars, 0, maxOffset);
}

/** Window covering fromIndex (with padding) through the latest bar — 고고저 auto-fit. */
function viewCoveringFromIndex(fromIndex, total, paddingBefore = 8, minCount = MIN_COUNT) {
  const safeTotal = Math.max(0, total || 0);
  if (!safeTotal) return { offset: 0, count: minCount };
  const start = Math.max(0, Math.min(fromIndex, safeTotal - 1) - Math.max(0, paddingBefore));
  const count = Math.max(minCount, safeTotal - start);
  return { offset: 0, count: clamp(count, minCount, Math.max(minCount, safeTotal)) };
}

const ChartGestures = {
  MIN_COUNT,
  touchDistance,
  isHorizontalPan,
  nextVisibleCount,
  nextOffset,
  viewCoveringFromIndex,
};

export default ChartGestures;
export { MIN_COUNT, touchDistance, isHorizontalPan, nextVisibleCount, nextOffset, viewCoveringFromIndex };
