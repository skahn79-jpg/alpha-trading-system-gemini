"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { fail } = require("./errors");
const { looksLikeSecretEnvKey } = require("./redaction");
const { isApprovedTestDirGlob, validateTestArgsGrammar } = require("./schema");
const { assertContained, assertSafeRepoRelPattern, realpathOrEscape } = require("./fs-safe");

const TEST_OPERAND_GLOB_LIKE_RE = /[*?\[\]{}!`$()]/;
const FINAL_ARGV_GLOB_RE = /[*?\[\]{}]/;
const APPROVED_GLOB_SUFFIX = "/*.test.js";

function buildTestEnv() {
  const env = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "LANG"]) {
    if (looksLikeSecretEnvKey(key)) continue;
    if (Object.prototype.hasOwnProperty.call(process.env, key) && process.env[key] != null) {
      env[key] = process.env[key];
    }
  }
  env.NODE_ENV = "test";
  return env;
}

function killProcessGroup(pid, signal) {
  if (pid == null) return;
  process.kill(-pid, signal);
}

function parseCount(text, label) {
  const src = String(text || "");
  const patterns = [
    new RegExp("^# " + label + " (\\d+)\\s*$", "m"),
    new RegExp("^ℹ " + label + " (\\d+)\\s*$", "m"),
    new RegExp("^info " + label + " (\\d+)\\s*$", "im"),
  ];
  for (const re of patterns) {
    const m = src.match(re);
    if (m) return Number(m[1]);
  }
  return null;
}

function parseTestSummary(text) {
  const tests = parseCount(text, "tests");
  const pass = parseCount(text, "pass");
  const fail = parseCount(text, "fail");
  const skipped = parseCount(text, "skipped");
  const unknown = tests === null || pass === null || fail === null || skipped === null;
  if (unknown) {
    return {
      tests: "UNKNOWN",
      pass: "UNKNOWN",
      fail: "UNKNOWN",
      skipped: "UNKNOWN",
      unknown: true,
    };
  }
  return { tests, pass, fail, skipped, unknown: false };
}

function makeCollector(maxBytes) {
  const chunks = [];
  let stored = 0;
  let truncated = false;
  function onData(chunk) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (truncated) return;
    if (stored + buf.length > maxBytes) {
      const remain = maxBytes - stored;
      if (remain > 0) chunks.push(buf.subarray(0, remain));
      stored = maxBytes;
      truncated = true;
      return;
    }
    chunks.push(buf);
    stored += buf.length;
  }
  function text() {
    return Buffer.concat(chunks, stored).toString("utf8");
  }
  return { onData, text, isTruncated: () => truncated };
}

function waitMs(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function waitExit(child) {
  return new Promise((resolve) => {
    if (child.exitCode != null || child.signalCode != null) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

function extractTestOperands(configuredArgs) {
  const operands = [];
  for (let i = 1; i < configuredArgs.length; i++) {
    if (configuredArgs[i] === "--test") continue;
    operands.push(configuredArgs[i]);
  }
  return operands;
}

function assertNoFinalArgvGlob(argv) {
  for (const arg of argv) {
    if (typeof arg !== "string" || FINAL_ARGV_GLOB_RE.test(arg)) {
      fail("GATE_RUNNER_INVALID_CONFIG", "final test argv must not contain glob metacharacters");
    }
  }
}

function assertSelectedFilesStillSafe(repoRoot, files) {
  const rootReal = realpathOrEscape(repoRoot, "repoRoot");
  for (const rel of files) {
    const abs = path.join(rootReal, rel);
    let lst;
    try {
      lst = fs.lstatSync(abs);
    } catch {
      fail("GATE_RUNNER_PATH_ESCAPE", "selected test file disappeared");
    }
    if (lst.isSymbolicLink()) {
      fail("GATE_RUNNER_PATH_ESCAPE", "selected test file is a symlink");
    }
    if (!lst.isFile()) {
      fail("GATE_RUNNER_INVALID_CONFIG", "selected test file is not a regular file");
    }
    const real = realpathOrEscape(abs, rel);
    assertContained(rootReal, real);
  }
}

function resolveExplicitTestFile(repoRoot, operand, selected) {
  const rootReal = realpathOrEscape(repoRoot, "repoRoot");
  const joined = path.join(rootReal, operand);
  let lst;
  try {
    lst = fs.lstatSync(joined);
  } catch {
    fail("GATE_RUNNER_INVALID_CONFIG", "test file does not exist");
  }
  if (lst.isSymbolicLink()) {
    fail("GATE_RUNNER_PATH_ESCAPE", "test file is a symlink");
  }
  if (!lst.isFile()) {
    fail("GATE_RUNNER_INVALID_CONFIG", "test path is not a regular file");
  }
  const real = realpathOrEscape(joined, operand);
  assertContained(rootReal, real);
  const base = path.posix.basename(operand);
  if (!base.endsWith(".test.js") || base === ".test.js") {
    fail("GATE_RUNNER_INVALID_CONFIG", "test file must end with .test.js");
  }
  selected.add(operand);
}

function expandApprovedDirGlob(repoRoot, pattern, selected) {
  if (!isApprovedTestDirGlob(pattern) || !pattern.endsWith(APPROVED_GLOB_SUFFIX)) {
    fail("GATE_RUNNER_INVALID_CONFIG", "unsupported test glob pattern");
  }
  const dirRel = pattern.slice(0, -APPROVED_GLOB_SUFFIX.length);
  assertSafeRepoRelPattern(dirRel, "GATE_RUNNER_INVALID_CONFIG");
  const rootReal = realpathOrEscape(repoRoot, "repoRoot");
  const dirAbs = path.join(rootReal, dirRel);
  let lst;
  try {
    lst = fs.lstatSync(dirAbs);
  } catch {
    fail("GATE_RUNNER_INVALID_CONFIG", "test glob directory does not exist");
  }
  if (lst.isSymbolicLink()) {
    fail("GATE_RUNNER_PATH_ESCAPE", "test glob directory is a symlink");
  }
  if (!lst.isDirectory()) {
    fail("GATE_RUNNER_INVALID_CONFIG", "test glob path is not a directory");
  }
  const dirReal = realpathOrEscape(dirAbs, dirRel);
  assertContained(rootReal, dirReal);

  let names;
  try {
    names = fs.readdirSync(dirAbs);
  } catch {
    fail("GATE_RUNNER_INVALID_CONFIG", "test glob directory cannot be read");
  }
  for (const name of names) {
    if (name === "." || name === ".." || name.includes("/")) continue;
    if (!name.endsWith(".test.js") || name === ".test.js") continue;
    const childRel = dirRel + "/" + name;
    const childAbs = path.join(dirAbs, name);
    let childLst;
    try {
      childLst = fs.lstatSync(childAbs);
    } catch {
      fail("GATE_RUNNER_PATH_ESCAPE", "test child lstat failed");
    }
    if (childLst.isSymbolicLink()) {
      fail("GATE_RUNNER_PATH_ESCAPE", "test file is a symlink");
    }
    if (!childLst.isFile()) {
      fail("GATE_RUNNER_INVALID_CONFIG", "test child is not a regular file");
    }
    const childReal = realpathOrEscape(childAbs, childRel);
    assertContained(rootReal, childReal);
    selected.add(childRel);
  }
}

function resolveTestOperands(repoRoot, operands) {
  if (!Array.isArray(operands)) {
    fail("GATE_RUNNER_INVALID_CONFIG", "test operands required");
  }
  const selected = new Set();
  for (const operand of operands) {
    if (typeof operand !== "string" || operand.length === 0) {
      fail("GATE_RUNNER_INVALID_CONFIG", "empty test operand");
    }
    const posix = assertSafeRepoRelPattern(operand, "GATE_RUNNER_INVALID_CONFIG");
    if (isApprovedTestDirGlob(posix)) {
      expandApprovedDirGlob(repoRoot, posix, selected);
      continue;
    }
    if (TEST_OPERAND_GLOB_LIKE_RE.test(posix)) {
      fail("GATE_RUNNER_INVALID_CONFIG", "unsupported test glob pattern");
    }
    resolveExplicitTestFile(repoRoot, posix, selected);
  }
  if (selected.size === 0) {
    fail("GATE_RUNNER_INVALID_CONFIG", "no test files matched");
  }
  const files = Array.from(selected);
  files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  assertSelectedFilesStillSafe(repoRoot, files);
  return files;
}

function buildTestArgv(repoRoot, configuredArgs) {
  validateTestArgsGrammar(configuredArgs);
  const files = resolveTestOperands(repoRoot, extractTestOperands(configuredArgs));
  const argv = ["--test"].concat(files);
  assertNoFinalArgvGlob(argv);
  return argv;
}

async function runTests(opts) {
  const repoRoot = opts.repoRoot;
  const args = opts.args;
  const timeoutMs = opts.timeoutMs;
  const stdoutMax = opts.stdoutCaptureMaxBytes || opts.stdoutMax || 8388608;
  const stderrMax = opts.stderrCaptureMaxBytes || opts.stderrMax || 8388608;
  const execPath = opts.execPath || process.execPath;
  if (!timeoutMs || timeoutMs <= 0) {
    fail("GATE_RUNNER_INVALID_CONFIG", "timeoutMs is required");
  }
  if (!Array.isArray(args) || args.length === 0) {
    fail("GATE_RUNNER_INVALID_CONFIG", "test args required");
  }
  validateTestArgsGrammar(args);
  const finalArgv = buildTestArgv(repoRoot, args);
  assertNoFinalArgvGlob(finalArgv);
  assertSelectedFilesStillSafe(repoRoot, finalArgv.slice(1));

  const stdoutCol = makeCollector(stdoutMax);
  const stderrCol = makeCollector(stderrMax);
  let timedOut = false;
  let spawnErr = null;

  const child = spawn(execPath, finalArgv, {
    cwd: repoRoot,
    env: buildTestEnv(),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", stdoutCol.onData);
  child.stderr.on("data", stderrCol.onData);
  child.on("error", (err) => {
    spawnErr = err;
  });

  let timer = null;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve("timeout");
    }, timeoutMs);
  });

  const exitPromise = waitExit(child).then((r) => ({ type: "exit", ...r }));
  const first = await Promise.race([timeoutPromise, exitPromise]);

  if (first === "timeout") {
    try {
      killProcessGroup(child.pid, "SIGTERM");
    } catch {
      /* already dead */
    }
    await waitMs(2000);
    if (child.exitCode == null && child.signalCode == null) {
      try {
        killProcessGroup(child.pid, "SIGKILL");
      } catch {
        /* already dead */
      }
    }
    await waitExit(child);
  } else if (timer) {
    clearTimeout(timer);
  }

  const stdout = stdoutCol.text();
  const stderr = stderrCol.text();
  const truncated = stdoutCol.isTruncated() || stderrCol.isTruncated();
  const combined = stdout + "\n" + stderr;
  const summary = parseTestSummary(combined);
  const exitCode = child.exitCode;
  const signal = child.signalCode;

  if (spawnErr) {
    fail("GATE_RUNNER_TEST_FAILED", spawnErr.message || "spawn failed");
  }

  return {
    exitCode,
    signal,
    timedOut,
    truncated,
    stdout,
    stderr,
    ...summary,
  };
}

module.exports = {
  buildTestEnv,
  buildTestArgv,
  killProcessGroup,
  parseTestSummary,
  resolveTestOperands,
  runTests,
};
