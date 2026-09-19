"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { fail } = require("./errors");
const { looksLikeSecretEnvKey } = require("./redaction");

const MUTATION_VERBS = new Set([
  "add",
  "commit",
  "push",
  "reset",
  "checkout",
  "switch",
  "clean",
  "stash",
  "merge",
  "rebase",
  "cherry-pick",
  "tag",
  "config",
  "-c",
]);

const WHITELIST = [
  ["rev-parse", "--show-toplevel"],
  ["rev-parse", "HEAD"],
  ["rev-parse", "--verify", "--quiet", "HEAD~1"],
  ["rev-parse", "--abbrev-ref", "HEAD"],
  ["status", "--short", "--untracked-files=all"],
  ["diff", "--name-only", "--no-ext-diff", "--no-textconv", "HEAD"],
  ["diff", "--name-status", "--no-ext-diff", "--no-textconv", "HEAD"],
  ["diff", "--cached", "--name-only", "--no-ext-diff", "--no-textconv"],
  ["diff", "--cached", "--name-status", "--no-ext-diff", "--no-textconv"],
  ["ls-files", "--others", "--exclude-standard"],
  ["log", "-1", "--format=%H%n%P%n%s"],
];

function argsKey(args) {
  return args.join("\0");
}

const WHITELIST_SET = new Set(WHITELIST.map(argsKey));

function buildGitEnv() {
  const env = {};
  const allow = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "USER", "LOGNAME", "TERM"];
  for (const key of allow) {
    if (looksLikeSecretEnvKey(key)) continue;
    if (Object.prototype.hasOwnProperty.call(process.env, key) && process.env[key] != null) {
      env[key] = process.env[key];
    }
  }
  return env;
}

function rejectMutationCommand(argv) {
  const args = Array.isArray(argv) ? argv : [];
  for (const raw of args) {
    const a = String(raw);
    if (MUTATION_VERBS.has(a) || a === "--exec" || a.startsWith("--exec=")) {
      fail("GATE_RUNNER_GIT_ERROR", `mutation command rejected: ${a}`);
    }
  }
}

function assertWhitelisted(args) {
  if (!WHITELIST_SET.has(argsKey(args))) {
    fail("GATE_RUNNER_GIT_ERROR", `git argv not on whitelist: ${args.join(" ")}`);
  }
}

function resolveGitBinary(repoRoot) {
  let candidate = null;
  try {
    fs.accessSync("/usr/bin/git", fs.constants.X_OK);
    candidate = "/usr/bin/git";
  } catch {
    candidate = null;
  }
  if (!candidate) {
    const pathEnv = process.env.PATH || "";
    for (const dir of pathEnv.split(path.delimiter)) {
      if (!dir) continue;
      const p = path.join(dir, "git");
      try {
        fs.accessSync(p, fs.constants.X_OK);
        candidate = p;
        break;
      } catch {
        /* try next */
      }
    }
  }
  if (!candidate) fail("GATE_RUNNER_GIT_ERROR", "git binary not found");
  let real;
  try {
    real = fs.realpathSync(candidate);
  } catch {
    fail("GATE_RUNNER_GIT_ERROR", "git binary realpath failed");
  }
  let rootReal;
  try {
    rootReal = fs.realpathSync(repoRoot);
  } catch {
    fail("GATE_RUNNER_GIT_ERROR", "repo realpath failed");
  }
  const prefix = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  if (real === rootReal || real.startsWith(prefix)) {
    fail("GATE_RUNNER_GIT_ERROR", "git binary inside repository");
  }
  return real;
}

function execGit(repoRoot, args) {
  rejectMutationCommand(args);
  assertWhitelisted(args);
  const gitBin = resolveGitBinary(repoRoot);
  try {
    return execFileSync(gitBin, args, {
      cwd: repoRoot,
      env: buildGitEnv(),
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (err) {
    if (err && err.name === "GateRunnerError") throw err;
    fail("GATE_RUNNER_GIT_ERROR", err && err.message ? err.message : "git exec failed");
  }
}

function execGitAllowFail(repoRoot, args) {
  rejectMutationCommand(args);
  assertWhitelisted(args);
  const gitBin = resolveGitBinary(repoRoot);
  try {
    return execFileSync(gitBin, args, {
      cwd: repoRoot,
      env: buildGitEnv(),
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (err) {
    if (err && err.name === "GateRunnerError") throw err;
    return null;
  }
}

function parseStatusShort(text) {
  const staged = [];
  const unstaged = [];
  const untracked = [];
  const trackedDirty = [];
  const lines = String(text || "").split("\n");
  for (const line of lines) {
    if (!line) continue;
    if (line.length < 3) continue;
    const x = line[0];
    const y = line[1];
    let file = line.slice(3);
    if (file.includes(" -> ")) {
      file = file.slice(file.lastIndexOf(" -> ") + 4);
    }
    if (x === "?" && y === "?") {
      untracked.push(file);
      continue;
    }
    if (x === "!") continue;
    if (x !== " " && x !== "?") staged.push(file);
    if (y !== " " && y !== "?") unstaged.push(file);
    trackedDirty.push(file);
  }
  return {
    staged: unique(staged),
    unstaged: unique(unstaged),
    untracked: unique(untracked),
    trackedDirty: unique(trackedDirty),
  };
}

function unique(arr) {
  return Array.from(new Set(arr));
}

function isKnownUntracked(file, patterns) {
  const n = String(file).replace(/\\/g, "/");
  for (const raw of patterns || []) {
    const pat = String(raw).replace(/\\/g, "/");
    if (pat.endsWith("/")) {
      if (n === pat.slice(0, -1) || n.startsWith(pat)) return true;
    } else if (n === pat) {
      return true;
    }
  }
  return false;
}

function assertRepoRootMatches(repoRootHint) {
  let hintReal;
  try {
    hintReal = fs.realpathSync(repoRootHint);
  } catch {
    fail("GATE_RUNNER_GIT_ERROR", "repoRootHint realpath failed");
  }
  const toplevelRaw = execGit(hintReal, ["rev-parse", "--show-toplevel"]).trim();
  let topReal;
  try {
    topReal = fs.realpathSync(toplevelRaw);
  } catch {
    fail("GATE_RUNNER_GIT_ERROR", "toplevel realpath failed");
  }
  if (topReal !== hintReal) {
    fail("GATE_RUNNER_GIT_ERROR", "cwd/toplevel mismatch");
  }
  return topReal;
}

function inspectGit(repoRoot, knownUntracked) {
  const root = assertRepoRootMatches(repoRoot);
  const patterns = Array.isArray(knownUntracked) ? knownUntracked : [];
  const head = execGit(root, ["rev-parse", "HEAD"]).trim();
  const branch = execGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  const parentOut = execGitAllowFail(root, ["rev-parse", "--verify", "--quiet", "HEAD~1"]);
  const parent = parentOut ? parentOut.trim() : null;
  const statusText = execGit(root, ["status", "--short", "--untracked-files=all"]);
  const parsed = parseStatusShort(statusText);
  const knownMatched = parsed.untracked.filter((f) => isKnownUntracked(f, patterns));
  const unexpectedUntracked = parsed.untracked.filter((f) => !isKnownUntracked(f, patterns));
  return {
    repoRoot: root,
    branch,
    head,
    parent,
    trackedDirty: parsed.trackedDirty,
    staged: parsed.staged,
    untracked: parsed.untracked,
    knownUntracked: knownMatched,
    unexpectedUntracked,
    unstaged: parsed.unstaged,
  };
}

function diffNameOnlyHead(repoRoot) {
  const root = assertRepoRootMatches(repoRoot);
  const text = execGit(root, ["diff", "--name-only", "--no-ext-diff", "--no-textconv", "HEAD"]);
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

module.exports = {
  buildGitEnv,
  rejectMutationCommand,
  execGit,
  inspectGit,
  diffNameOnlyHead,
  isKnownUntracked,
  resolveGitBinary,
  MUTATION_VERBS,
  WHITELIST,
};
