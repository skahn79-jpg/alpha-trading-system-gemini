"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { fail } = require("./errors");
const { parseJsonSafe, stableStringify } = require("./json-safe");
const { defaultInitConfig, defaultInitState, validateConfig, validateState, validateGateId, validateTrackName } = require("./schema");
const {
  gatesDir,
  atomicWriteFile,
  acquireLock,
  releaseLock,
  ensureGatesWritable,
  ensureContainedDirectory,
} = require("./fs-safe");
const { inspectGit } = require("./git-inspector");
const { evaluatePolicy } = require("./policy");
const { analyzeP50 } = require("./p50");
const { scanSafety } = require("./safety-scanner");
const { scanEligibility } = require("./eligibility");
const { runTests } = require("./test-runner");
const {
  writeReportPair,
  computeMachineVerdict,
  nextAttemptNumber,
  ingestFile,
  resolveNextGate,
} = require("./report");

function newRunId() {
  return crypto.randomBytes(16).toString("hex");
}

function loadConfigState(repoRoot) {
  const dir = gatesDir(repoRoot);
  const cfgPath = path.join(dir, "config.json");
  const stPath = path.join(dir, "state.json");
  if (!fs.existsSync(dir) || !fs.existsSync(cfgPath) || !fs.existsSync(stPath)) {
    fail("GATE_RUNNER_NOT_INITIALIZED", ".gates is not initialized");
  }
  ensureGatesWritable(repoRoot);
  const config = validateConfig(parseJsonSafe(fs.readFileSync(cfgPath, "utf8"), "GATE_RUNNER_INVALID_CONFIG"));
  const state = validateState(parseJsonSafe(fs.readFileSync(stPath, "utf8"), "GATE_RUNNER_INVALID_STATE"));
  return { config, state, cfgPath, stPath };
}

function writeState(repoRoot, state) {
  const validated = validateState(state);
  atomicWriteFile(repoRoot, path.join(gatesDir(repoRoot), "state.json"), stableStringify(validated) + "\n");
}

async function withLock(repoRoot, command, fn) {
  const lock = acquireLock(repoRoot, command);
  try {
    return await fn();
  } finally {
    releaseLock(lock);
  }
}

function patchLastRun(state, command, machineVerdict, attempt) {
  return Object.assign({}, state, {
    lastRun: {
      runId: newRunId(),
      command,
      attempt: attempt == null ? state.lastRun.attempt : attempt,
      machineVerdict,
    },
  });
}

async function cmdInit({ repoRoot }) {
  const git = inspectGit(repoRoot, []);
  const dir = gatesDir(repoRoot);
  try {
    fs.mkdirSync(dir);
  } catch (err) {
    if (err && err.code === "EEXIST") {
      fail("GATE_RUNNER_ALREADY_INITIALIZED", ".gates already exists");
    }
    throw err;
  }
  return withLock(repoRoot, "init", async () => {
    const cfg = defaultInitConfig();
    const st = defaultInitState(git.head, cfg.project);
    atomicWriteFile(repoRoot, path.join(dir, "config.json"), stableStringify(cfg) + "\n");
    atomicWriteFile(repoRoot, path.join(dir, "state.json"), stableStringify(st) + "\n");
    ensureContainedDirectory(repoRoot, ["reports"]);
    ensureContainedDirectory(repoRoot, ["evidence"]);
    atomicWriteFile(repoRoot, path.join(dir, ".gitignore"), "*\n!.gitignore\n");
    return {
      machineVerdict: "PASS",
      initialized: true,
      head: git.head,
      branch: git.branch,
    };
  });
}

async function cmdStatus({ repoRoot }) {
  const { config, state } = loadConfigState(repoRoot);
  const git = inspectGit(repoRoot, config.knownUntracked);
  const eligibility = scanEligibility(repoRoot, config);
  const findings = eligibility.findings || [];
  const hasBlockerOrHardStop = findings.some(
    (f) =>
      f &&
      (f.severity === "BLOCKER" ||
        f.hardStop === true ||
        f.code === "GATE_RUNNER_HARD_STOP")
  );
  let machineVerdict = "PASS";
  if (eligibility.hardStop || hasBlockerOrHardStop) {
    machineVerdict = computeMachineVerdict(findings);
    if (eligibility.hardStop) machineVerdict = "HARD_STOP";
  }
  return {
    machineVerdict,
    paperEligible: eligibility.paperEligible,
    liveEligible: eligibility.liveEligible,
    eligibility,
    eligibilityCache: state.eligibilityCache,
    git,
    tracks: state.tracks,
    pushAllowed: state.pushAllowed,
    lastRun: state.lastRun,
  };
}

function collectP50Findings(p50) {
  const findings = [];
  if (p50.p50ParseStatus === "UNKNOWN") {
    findings.push({
      code: "GATE_RUNNER_P50_PARSE_UNKNOWN",
      severity: "MEDIUM",
      message: "P50 allowlist parse status UNKNOWN",
    });
  }
  if (p50.p50ActualDiffConflict === true) {
    findings.push({
      code: "P50_PREDICTED_ALLOWLIST_CONFLICT",
      severity: "MEDIUM",
      message: "git diff --name-only HEAD has paths outside P50 allowlist",
      missingFromAllowlist: p50.missingFromAllowlist,
      p50Fail: true,
    });
  }
  if (Array.isArray(p50.untrackedOutsideKnown) && p50.untrackedOutsideKnown.length > 0) {
    findings.push({
      code: "UNEXPECTED_UNTRACKED",
      severity: "LOW",
      message: "untracked files outside knownUntracked",
      paths: p50.untrackedOutsideKnown,
      p50Fail: false,
    });
  }
  return findings;
}

async function cmdInspect({ repoRoot }) {
  const { config, state } = loadConfigState(repoRoot);
  const git = inspectGit(repoRoot, config.knownUntracked);
  const policyFindings = evaluatePolicy(git, state);
  const p50 = analyzeP50({ repoRoot, config, gitSnapshot: git });
  const findings = policyFindings.concat(collectP50Findings(p50));
  const machineVerdict = computeMachineVerdict(findings);
  return {
    machineVerdict,
    git,
    p50,
    policyFindings,
    findings,
    tracks: state.tracks,
  };
}

async function cmdSafety({ repoRoot }) {
  const { config, state } = loadConfigState(repoRoot);
  return withLock(repoRoot, "safety", async () => {
    const safety = scanSafety(repoRoot, config.safetyScanRoots);
    const eligibility = scanEligibility(repoRoot, config);
    const findings = [].concat(safety.findings || [], eligibility.findings || []);
    let machineVerdict = computeMachineVerdict(findings);
    if (eligibility.hardStop) machineVerdict = "HARD_STOP";
    else if (safety.status === "FAIL" && (machineVerdict === "PASS" || machineVerdict === "PASS_WITH_NOTES")) {
      machineVerdict = "FAIL";
    }
    const next = patchLastRun(
      Object.assign({}, state, {
        eligibilityCache: {
          paperEligible: eligibility.paperEligible,
          liveEligible: eligibility.liveEligible,
        },
      }),
      "safety",
      machineVerdict,
      state.lastRun.attempt
    );
    writeState(repoRoot, next);
    return { machineVerdict, safety, eligibility, findings, hardStop: eligibility.hardStop };
  });
}

async function cmdTest({ repoRoot, execPath }) {
  const { config, state } = loadConfigState(repoRoot);
  const group = config.testGroups && config.testGroups.full;
  if (!group) fail("GATE_RUNNER_INVALID_CONFIG", "missing testGroups.full");
  return withLock(repoRoot, "test", async () => {
    const result = await runTests({
      repoRoot,
      args: group.args,
      timeoutMs: group.timeoutMs,
      stdoutCaptureMaxBytes: config.stdoutCaptureMaxBytes,
      stderrCaptureMaxBytes: config.stderrCaptureMaxBytes,
      execPath,
    });
    const findings = [];
    if (result.truncated) {
      findings.push({
        code: "GATE_RUNNER_TEST_OUTPUT_TRUNCATED",
        severity: "HIGH",
        message: "test output truncated",
      });
    }
    if (result.timedOut) {
      findings.push({
        code: "GATE_RUNNER_TEST_TIMEOUT",
        severity: "HIGH",
        message: "test timeout",
      });
    }
    if (result.unknown) {
      findings.push({
        code: "GATE_RUNNER_TEST_RESULT_UNKNOWN",
        severity: "HIGH",
        message: "unparsable test counts",
      });
    }
    if (!result.timedOut && result.exitCode !== 0) {
      findings.push({
        code: "GATE_RUNNER_TEST_FAILED",
        severity: "HIGH",
        message: "nonzero test exit",
        exitCode: result.exitCode,
      });
    }
    if (
      group.expectedTotal != null &&
      result.tests !== "UNKNOWN" &&
      result.tests !== group.expectedTotal
    ) {
      findings.push({
        code: "EXPECTED_TOTAL_MISMATCH",
        severity: "HIGH",
        message: `expectedTotal ${group.expectedTotal} actual ${result.tests}`,
      });
    }
    const baseline =
      (state.tracks.AUTOMATION && state.tracks.AUTOMATION.testBaseline) || {};
    if (
      result.skipped !== "UNKNOWN" &&
      result.skipped > 0 &&
      (baseline.skipped == null || baseline.skipped === 0)
    ) {
      findings.push({
        code: "SKIPPED_INCREASE",
        severity: "MEDIUM",
        message: "skipped > 0 vs baseline 0/missing",
        skipped: result.skipped,
      });
    }
    let machineVerdict = computeMachineVerdict(findings);
    if (result.truncated || result.timedOut || result.unknown) {
      if (machineVerdict === "PASS" || machineVerdict === "PASS_WITH_NOTES") machineVerdict = "FAIL";
    }
    const nextBaseline = {
      total: result.tests === "UNKNOWN" ? undefined : result.tests,
      pass: result.pass === "UNKNOWN" ? undefined : result.pass,
      fail: result.fail === "UNKNOWN" ? undefined : result.fail,
      skipped: result.skipped === "UNKNOWN" ? undefined : result.skipped,
    };
    Object.keys(nextBaseline).forEach((k) => {
      if (nextBaseline[k] === undefined) delete nextBaseline[k];
    });
    const nextTracks = Object.assign({}, state.tracks, {
      AUTOMATION: Object.assign({}, state.tracks.AUTOMATION, { testBaseline: nextBaseline }),
    });
    const next = patchLastRun(Object.assign({}, state, { tracks: nextTracks }), "test", machineVerdict, state.lastRun.attempt);
    writeState(repoRoot, next);
    return {
      machineVerdict,
      tests: {
        tests: result.tests,
        pass: result.pass,
        fail: result.fail,
        skipped: result.skipped,
        unknown: result.unknown,
        timedOut: result.timedOut,
        truncated: result.truncated,
        exitCode: result.exitCode,
        signal: result.signal,
      },
      findings,
    };
  });
}

async function cmdReport({ repoRoot }) {
  const { config, state } = loadConfigState(repoRoot);
  return withLock(repoRoot, "report", async () => {
    const git = inspectGit(repoRoot, config.knownUntracked);
    const policyFindings = evaluatePolicy(git, state);
    const p50 = analyzeP50({ repoRoot, config, gitSnapshot: git });
    const safety = scanSafety(repoRoot, config.safetyScanRoots);
    const eligibility = scanEligibility(repoRoot, config);
    const findings = []
      .concat(policyFindings, collectP50Findings(p50), safety.findings || [], eligibility.findings || []);
    let machineVerdict = computeMachineVerdict(findings);
    if (eligibility.hardStop) machineVerdict = "HARD_STOP";
    else if (safety.status === "FAIL" && (machineVerdict === "PASS" || machineVerdict === "PASS_WITH_NOTES")) {
      machineVerdict = "FAIL";
    }
    const track = validateTrackName("AUTOMATION", "GATE_RUNNER_INVALID_ARGUMENT");
    const rawGate = (state.tracks.AUTOMATION && state.tracks.AUTOMATION.currentGate) || "UNSET";
    const gateId = validateGateId(rawGate, "GATE_RUNNER_INVALID_STATE");
    const reportsDir = path.join(gatesDir(repoRoot), "reports", track, gateId);
    const attempt = nextAttemptNumber(state, reportsDir);
    const written = writeReportPair(
      repoRoot,
      {
        track,
        gateId,
        attempt,
        head: git.head,
        branch: git.branch,
        machineVerdict,
        findings,
        git,
        p50,
        safety,
        eligibility,
        tests: state.tracks.AUTOMATION && state.tracks.AUTOMATION.testBaseline,
      },
      state
    );
    const next = patchLastRun(state, "report", machineVerdict, attempt);
    writeState(repoRoot, next);
    return {
      machineVerdict,
      findings,
      report: written.report,
      jsonPath: written.jsonPath,
      mdPath: written.mdPath,
      attempt,
    };
  });
}

async function cmdNext({ repoRoot }) {
  const { state } = loadConfigState(repoRoot);
  return resolveNextGate(state);
}

async function cmdIngest({ repoRoot, ingestPath }) {
  const loaded = loadConfigState(repoRoot);
  return withLock(repoRoot, "ingest", async () => {
    const result = ingestFile(repoRoot, ingestPath, loaded);
    const next = patchLastRun(loaded.state, "ingest", result.machineVerdict, loaded.state.lastRun.attempt);
    writeState(repoRoot, next);
    return result;
  });
}

async function dispatch(command, ctx) {
  switch (command) {
    case "init":
      return cmdInit(ctx);
    case "status":
      return cmdStatus(ctx);
    case "inspect":
      return cmdInspect(ctx);
    case "test":
      return cmdTest(ctx);
    case "safety":
      return cmdSafety(ctx);
    case "report":
      return cmdReport(ctx);
    case "next":
      return cmdNext(ctx);
    case "ingest":
      return cmdIngest(ctx);
    default:
      fail("GATE_RUNNER_INVALID_ARGUMENT", `unknown command: ${command}`);
  }
}

module.exports = {
  dispatch,
  cmdInit,
  cmdStatus,
  cmdInspect,
  cmdTest,
  cmdSafety,
  cmdReport,
  cmdNext,
  cmdIngest,
  loadConfigState,
};
