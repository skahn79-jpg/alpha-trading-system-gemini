"use strict";

const { fail } = require("./errors");

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function rejectDangerousKey(key, errorCode) {
  if (DANGEROUS_KEYS.has(key)) {
    fail(errorCode, `forbidden key: ${key}`);
  }
}

function walkRejectDangerous(value, errorCode, seen) {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) walkRejectDangerous(item, errorCode, seen);
    return;
  }
  for (const key of Object.keys(value)) {
    rejectDangerousKey(key, errorCode);
    walkRejectDangerous(value[key], errorCode, seen);
  }
}

function parseJsonSafe(text, errorCode) {
  const code = errorCode || "GATE_RUNNER_INVALID_STATE";
  if (typeof text !== "string") {
    fail(code, "JSON input must be a string");
  }
  const trimmed = text.replace(/^\uFEFF/, "");
  if (trimmed.trim() === "") {
    fail(code, "empty JSON");
  }
  let parsed;
  try {
    parsed = JSON.parse(trimmed, (key, value) => {
      rejectDangerousKey(key, code);
      return value;
    });
  } catch (err) {
    if (err && err.name === "GateRunnerError") throw err;
    fail(code, "malformed JSON");
  }
  walkRejectDangerous(parsed, code, new Set());
  return parsed;
}

function assertKnownKeys(obj, allowed, errorCode, label) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    fail(errorCode, `${label} must be an object`);
  }
  const allow = new Set(allowed);
  for (const key of Object.keys(obj)) {
    rejectDangerousKey(key, errorCode);
    if (!allow.has(key)) {
      fail(errorCode, `unknown ${label} key: ${key}`);
    }
  }
}

function assertNoForbiddenKeys(obj, forbidden, errorCode) {
  if (obj === null || typeof obj !== "object") return;
  for (const key of Object.keys(obj)) {
    if (forbidden.has(key)) {
      fail(errorCode, `forbidden key: ${key}`);
    }
  }
}

function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortValue);
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (DANGEROUS_KEYS.has(key)) continue;
    out[key] = sortValue(value[key]);
  }
  return out;
}

module.exports = {
  DANGEROUS_KEYS,
  parseJsonSafe,
  assertKnownKeys,
  assertNoForbiddenKeys,
  rejectDangerousKey,
  walkRejectDangerous,
  stableStringify,
};
