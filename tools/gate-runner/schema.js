"use strict";

const { fail } = require("./errors");
const { assertKnownKeys, assertNoForbiddenKeys, walkRejectDangerous } = require("./json-safe");
const { assertSafeRepoRelPattern } = require("./fs-safe");

const FORBIDDEN_CONFIG_KEYS = new Set([
  "command",
  "shell",
  "executable",
  "retry",
  "transientFailureSignatures",
]);

const CONFIG_TOP_KEYS = [
  "configVersion",
  "project",
  "knownUntracked",
  "safetyScanRoots",
  "eligibility",
  "p50",
  "testGroups",
  "stdoutCaptureMaxBytes",
  "stderrCaptureMaxBytes",
  "summaryTailBytes",
  "ingestMaxBytes",
];

const ELIGIBILITY_KEYS = ["paperEligibleExpected", "liveEligibleExpected", "scanRoots"];
const P50_KEYS = ["file", "testId"];
const TEST_GROUP_KEYS = ["args", "timeoutMs", "expectedTotal", "expectedAdded", "expectedRemoved"];
const STATE_TOP_KEYS = ["version", "project", "tracks", "eligibilityCache", "pushAllowed", "lastRun"];
const TRACK_ENUM = Object.freeze(["TRADING", "AUTOMATION"]);
const TRACK_NAMES = TRACK_ENUM;
const GATE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const TRACK_KEYS = [
  "currentGate",
  "phase",
  "lastPassedGate",
  "expectedHead",
  "nextGate",
  "openFindings",
  "testBaseline",
];
const LAST_RUN_KEYS = ["runId", "command", "attempt", "machineVerdict"];
const ELIG_CACHE_KEYS = ["paperEligible", "liveEligible"];
const TEST_BASELINE_KEYS = ["total", "pass", "fail", "skipped", "added", "removed"];

const SHA1_RE = /^[0-9a-f]{40}$/;
const APPROVED_TEST_DIR_GLOB_RE = /^([A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)\/\*\.test\.js$/;
const TEST_OPERAND_GLOB_LIKE_RE = /[*?\[\]{}!`$()]/;

function isApprovedTestDirGlob(operand) {
  return typeof operand === "string" && APPROVED_TEST_DIR_GLOB_RE.test(operand);
}

function defaultInitConfig() {
  return {
    configVersion: 1,
    project: "alpha-trading-system-gemini",
    knownUntracked: [".renderignore", "docs/kb/", "test/fixtures/kb-samples.js"],
    safetyScanRoots: ["lib/paper", "lib/backtest"],
    eligibility: {
      paperEligibleExpected: false,
      liveEligibleExpected: false,
      scanRoots: ["lib/backtest", "lib/paper", "src", "kb", "server.js"],
    },
    p50: {
      file: "test/backtest-synthetic-pipeline.test.js",
      testId: "GATE5H-P50",
    },
    testGroups: {
      full: {
        args: ["--test", "test/*.test.js"],
        timeoutMs: 600000,
      },
    },
    stdoutCaptureMaxBytes: 8388608,
    stderrCaptureMaxBytes: 8388608,
    summaryTailBytes: 65536,
    ingestMaxBytes: 1048576,
  };
}

function defaultInitState(expectedHead, project) {
  const head = expectedHead == null ? null : String(expectedHead);
  const proj = project || defaultInitConfig().project;
  const emptyTrack = () => ({
    currentGate: null,
    phase: null,
    lastPassedGate: null,
    expectedHead: head,
    nextGate: null,
    openFindings: [],
    testBaseline: {},
  });
  const automation = emptyTrack();
  automation.currentGate = "GATE-A2";
  automation.phase = "IMPLEMENTATION";
  automation.lastPassedGate = "GATE-A1";
  automation.nextGate = "GATE-A3";
  return {
    version: 1,
    project: proj,
    tracks: {
      TRADING: emptyTrack(),
      AUTOMATION: automation,
    },
    eligibilityCache: { paperEligible: false, liveEligible: false },
    pushAllowed: false,
    lastRun: { runId: null, command: null, attempt: 0, machineVerdict: null },
  };
}

function walkForbidden(value, errorCode) {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walkForbidden(item, errorCode);
    return;
  }
  assertNoForbiddenKeys(value, FORBIDDEN_CONFIG_KEYS, errorCode);
  for (const key of Object.keys(value)) {
    walkForbidden(value[key], errorCode);
  }
}

function assertStringArray(arr, label, errorCode) {
  if (!Array.isArray(arr)) fail(errorCode, `${label} must be an array`);
  for (const item of arr) {
    if (typeof item !== "string" || item.length === 0) {
      fail(errorCode, `${label} items must be non-empty strings`);
    }
    if (isAbsoluteLike(item)) {
      fail(errorCode, `${label} must be repository-relative`);
    }
  }
}

function validateTestArgsGrammar(args) {
  const code = "GATE_RUNNER_INVALID_CONFIG";
  if (!Array.isArray(args) || args.length === 0) {
    fail(code, "testGroup.args must be a non-empty string array");
  }
  for (const arg of args) {
    if (typeof arg !== "string" || arg.length === 0) {
      fail(code, "testGroup.args items must be non-empty strings");
    }
  }
  if (args[0] !== "--test") {
    fail(code, "testGroup.args[0] must be --test");
  }
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.includes("NODE_OPTIONS")) {
      fail(code, "NODE_OPTIONS-style test arg rejected");
    }
    if (arg === "--test") continue;
    if (arg.startsWith("-")) {
      fail(code, `forbidden or unknown test flag: ${arg}`);
    }
    assertSafeRepoRelPattern(arg, code);
    if (isApprovedTestDirGlob(arg)) continue;
    if (TEST_OPERAND_GLOB_LIKE_RE.test(arg)) {
      fail(code, "unsupported test glob pattern");
    }
  }
  return args;
}

function isAbsoluteLike(p) {
  if (typeof p !== "string") return false;
  if (p.startsWith("/") || p.startsWith("\\")) return true;
  if (/^[A-Za-z]:[\\/]/.test(p)) return true;
  return false;
}

function assertPositiveInt(n, label, errorCode) {
  if (!Number.isInteger(n) || n <= 0) {
    fail(errorCode, `${label} must be a positive integer`);
  }
}

function assertNonNegInt(n, label, errorCode) {
  if (!Number.isInteger(n) || n < 0) {
    fail(errorCode, `${label} must be a non-negative integer`);
  }
}

function assertNullOrString(v, label, errorCode) {
  if (v !== null && typeof v !== "string") {
    fail(errorCode, `${label} must be a string or null`);
  }
}

function validateGateId(value, errorCode) {
  const code = errorCode || "GATE_RUNNER_INVALID_ARGUMENT";
  if (typeof value !== "string") {
    fail(code, "gateId must be a string");
  }
  if (value.length === 0) {
    fail(code, "gateId must be non-empty");
  }
  if (value === "." || value === ".." || value === "...") {
    fail(code, "gateId rejected");
  }
  if (isAbsoluteLike(value) || value.includes("/") || value.includes("\\") || value.includes("\n") || value.includes("\r") || value.includes("\0")) {
    fail(code, "gateId rejected");
  }
  if (/\s/.test(value) || value.includes(":")) {
    fail(code, "gateId rejected");
  }
  if (!GATE_ID_RE.test(value)) {
    fail(code, "gateId rejected");
  }
  return value;
}

function validateOptionalGateId(value, label, errorCode) {
  if (value === null) return null;
  if (typeof value !== "string") {
    fail(errorCode, `${label} must be a string or null`);
  }
  return validateGateId(value, errorCode);
}

function validateTrackName(value, errorCode) {
  const code = errorCode || "GATE_RUNNER_INVALID_ARGUMENT";
  if (typeof value !== "string" || !TRACK_ENUM.includes(value)) {
    fail(code, "track must be TRADING or AUTOMATION");
  }
  return value;
}

function validateConfig(config) {
  const code = "GATE_RUNNER_INVALID_CONFIG";
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    fail(code, "config must be an object");
  }
  walkRejectDangerous(config, code, new Set());
  walkForbidden(config, code);
  assertKnownKeys(config, CONFIG_TOP_KEYS, code, "config");
  if (config.configVersion !== 1) {
    fail(code, "unknown configVersion");
  }
  if (typeof config.project !== "string" || config.project.length === 0) {
    fail(code, "project must be a non-empty string");
  }
  assertStringArray(config.knownUntracked, "knownUntracked", code);
  assertStringArray(config.safetyScanRoots, "safetyScanRoots", code);
  for (const root of config.safetyScanRoots) {
    assertSafeRepoRelPattern(root, code);
  }
  assertKnownKeys(config.eligibility, ELIGIBILITY_KEYS, code, "eligibility");
  if (typeof config.eligibility.paperEligibleExpected !== "boolean") {
    fail(code, "eligibility.paperEligibleExpected must be boolean");
  }
  if (typeof config.eligibility.liveEligibleExpected !== "boolean") {
    fail(code, "eligibility.liveEligibleExpected must be boolean");
  }
  assertStringArray(config.eligibility.scanRoots, "eligibility.scanRoots", code);
  for (const root of config.eligibility.scanRoots) {
    assertSafeRepoRelPattern(root, code);
  }
  assertKnownKeys(config.p50, P50_KEYS, code, "p50");
  if (typeof config.p50.file !== "string" || config.p50.file.length === 0) {
    fail(code, "p50.file must be a non-empty string");
  }
  if (isAbsoluteLike(config.p50.file)) fail(code, "p50.file must be repository-relative");
  assertSafeRepoRelPattern(config.p50.file, code);
  if (typeof config.p50.testId !== "string" || config.p50.testId.length === 0) {
    fail(code, "p50.testId must be a non-empty string");
  }
  if (config.testGroups === null || typeof config.testGroups !== "object" || Array.isArray(config.testGroups)) {
    fail(code, "testGroups must be an object");
  }
  const groupNames = Object.keys(config.testGroups);
  if (groupNames.length === 0) fail(code, "testGroups must not be empty");
  for (const name of groupNames) {
    const group = config.testGroups[name];
    assertKnownKeys(group, TEST_GROUP_KEYS, code, "testGroup");
    if (!Array.isArray(group.args) || group.args.length === 0) {
      fail(code, "testGroup.args must be a non-empty string array");
    }
    validateTestArgsGrammar(group.args);
    assertPositiveInt(group.timeoutMs, "testGroup.timeoutMs", code);
    if (group.expectedTotal !== undefined) assertNonNegInt(group.expectedTotal, "expectedTotal", code);
    if (group.expectedAdded !== undefined) assertNonNegInt(group.expectedAdded, "expectedAdded", code);
    if (group.expectedRemoved !== undefined) assertNonNegInt(group.expectedRemoved, "expectedRemoved", code);
  }
  assertPositiveInt(config.stdoutCaptureMaxBytes, "stdoutCaptureMaxBytes", code);
  assertPositiveInt(config.stderrCaptureMaxBytes, "stderrCaptureMaxBytes", code);
  assertPositiveInt(config.summaryTailBytes, "summaryTailBytes", code);
  assertPositiveInt(config.ingestMaxBytes, "ingestMaxBytes", code);
  return config;
}

function validateTrack(track, label) {
  const code = "GATE_RUNNER_INVALID_STATE";
  assertKnownKeys(track, TRACK_KEYS, code, label);
  assertNullOrString(track.currentGate, `${label}.currentGate`, code);
  assertNullOrString(track.phase, `${label}.phase`, code);
  assertNullOrString(track.lastPassedGate, `${label}.lastPassedGate`, code);
  assertNullOrString(track.nextGate, `${label}.nextGate`, code);
  if (track.currentGate !== null) validateGateId(track.currentGate, code);
  if (track.lastPassedGate !== null) validateGateId(track.lastPassedGate, code);
  if (track.nextGate !== null) validateGateId(track.nextGate, code);
  if (track.expectedHead !== null) {
    if (typeof track.expectedHead !== "string" || !SHA1_RE.test(track.expectedHead)) {
      fail(code, `${label}.expectedHead must be a 40-char sha or null`);
    }
  }
  if (!Array.isArray(track.openFindings)) {
    fail(code, `${label}.openFindings must be an array`);
  }
  if (track.testBaseline === null || typeof track.testBaseline !== "object" || Array.isArray(track.testBaseline)) {
    fail(code, `${label}.testBaseline must be an object`);
  }
  assertKnownKeys(track.testBaseline, TEST_BASELINE_KEYS, code, `${label}.testBaseline`);
  for (const k of Object.keys(track.testBaseline)) {
    assertNonNegInt(track.testBaseline[k], `${label}.testBaseline.${k}`, code);
  }
}

function validateState(state) {
  const code = "GATE_RUNNER_INVALID_STATE";
  if (state === null || typeof state !== "object" || Array.isArray(state)) {
    fail(code, "state must be an object");
  }
  walkRejectDangerous(state, code, new Set());
  assertKnownKeys(state, STATE_TOP_KEYS, code, "state");
  if (state.version !== 1) fail(code, "unknown state version");
  if (typeof state.project !== "string" || state.project.length === 0) {
    fail(code, "project must be a non-empty string");
  }
  if (state.tracks === null || typeof state.tracks !== "object" || Array.isArray(state.tracks)) {
    fail(code, "tracks must be an object");
  }
  assertKnownKeys(state.tracks, TRACK_NAMES, code, "tracks");
  for (const name of TRACK_NAMES) {
    validateTrack(state.tracks[name], name);
  }
  assertKnownKeys(state.eligibilityCache, ELIG_CACHE_KEYS, code, "eligibilityCache");
  if (typeof state.eligibilityCache.paperEligible !== "boolean") {
    fail(code, "eligibilityCache.paperEligible must be boolean");
  }
  if (typeof state.eligibilityCache.liveEligible !== "boolean") {
    fail(code, "eligibilityCache.liveEligible must be boolean");
  }
  if (state.pushAllowed !== false) {
    fail(code, "pushAllowed must be false");
  }
  assertKnownKeys(state.lastRun, LAST_RUN_KEYS, code, "lastRun");
  assertNullOrString(state.lastRun.runId, "lastRun.runId", code);
  assertNullOrString(state.lastRun.command, "lastRun.command", code);
  assertNullOrString(state.lastRun.machineVerdict, "lastRun.machineVerdict", code);
  if (!Number.isInteger(state.lastRun.attempt) || state.lastRun.attempt < 0) {
    fail(code, "lastRun.attempt must be a non-negative integer");
  }
  return state;
}

module.exports = {
  FORBIDDEN_CONFIG_KEYS,
  GATE_ID_RE,
  TRACK_ENUM,
  defaultInitConfig,
  defaultInitState,
  validateConfig,
  validateState,
  validateTestArgsGrammar,
  isApprovedTestDirGlob,
  validateGateId,
  validateOptionalGateId,
  validateTrackName,
};
