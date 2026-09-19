"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { assertFiniteEqualWeightedMean } = require("../lib/backtest/finite-tile-mean");

test("GATE6D-U01 empty array fail-closed", () => {
  const r = assertFiniteEqualWeightedMean([]);
  assert.equal(r.ok, false);
  assert.equal(r.mean, null);
});

test("GATE6D-U02 non-array fail-closed", () => {
  assert.equal(assertFiniteEqualWeightedMean(null).ok, false);
  assert.equal(assertFiniteEqualWeightedMean(undefined).ok, false);
});

test("GATE6D-U03 one finite value is identity mean", () => {
  const r = assertFiniteEqualWeightedMean([0.10]);
  assert.equal(r.ok, true);
  assert.equal(r.mean, 0.10);
  assert.equal(r.n, 1);
});

test("GATE6D-U04 two finite values equal-weighted mean", () => {
  const r = assertFiniteEqualWeightedMean([0.10, 0.30]);
  assert.equal(r.ok, true);
  assert.equal(r.mean, (0.10 + 0.30) / 2);
});

test("GATE6D-U05 two MAX_VALUE sum overflow fail-closed", () => {
  const r = assertFiniteEqualWeightedMean([Number.MAX_VALUE, Number.MAX_VALUE]);
  assert.equal(r.ok, false);
  assert.equal(r.mean, null);
});

test("GATE6D-U06 two MAX_VALUE/4 remains finite", () => {
  const r = assertFiniteEqualWeightedMean([Number.MAX_VALUE / 4, Number.MAX_VALUE / 4]);
  assert.equal(r.ok, true);
  assert.equal(Number.isFinite(r.mean), true);
});

test("GATE6D-U07 Infinity tile value fail-closed", () => {
  const r = assertFiniteEqualWeightedMean([Number.POSITIVE_INFINITY]);
  assert.equal(r.ok, false);
});

test("GATE6D-U08 helper has no official error codes", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "backtest", "finite-tile-mean.js"), "utf8");
  assert.equal(src.includes("OOS_FOLD_FAILED"), false);
  assert.equal(src.includes("TRAIN_SELECTION_NONFINITE"), false);
  assert.equal(src.includes("OOS_EVALUATION_NONFINITE"), false);
  assert.equal(src.includes("LEAKAGE_ERROR"), false);
});

test("GATE6G-U01 freeze helper has no official codes or reason/stage API", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "backtest", "finite-tile-mean.js"), "utf8");
  assert.equal(src.includes("OOS_FOLD_FAILED"), false);
  assert.equal(src.includes("TRAIN_SELECTION_NONFINITE"), false);
  assert.equal(src.includes("OOS_EVALUATION_NONFINITE"), false);
  assert.equal(src.includes("WALK_FORWARD_AGGREGATE_NONFINITE"), false);
  assert.equal(src.includes("LEAKAGE_ERROR"), false);
  assert.equal(src.includes("reason:"), false);
  assert.equal(src.includes("stage:"), false);
});
