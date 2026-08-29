"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { runCli } = require("../tools/gate-runner");
const { atomicWriteFile } = require("../tools/gate-runner/fs-safe");
const { defaultInitConfig, validateConfig, validateState } = require("../tools/gate-runner/schema");
const { parseJsonSafe, stableStringify } = require("../tools/gate-runner/json-safe");

function makeFixtureRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-runner-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "fix@example.test"], { cwd: dir });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "README.md"), "fixture\n");
  execFileSync("git", ["add", "README.md"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir });
  return dir;
}

async function runCliAgainstFixture(repoRoot, argv) {
  const chunksOut = [];
  const chunksErr = [];
  const stdout = {
    write(c) {
      chunksOut.push(Buffer.isBuffer(c) ? c.toString("utf8") : String(c));
      return true;
    },
  };
  const stderr = {
    write(c) {
      chunksErr.push(Buffer.isBuffer(c) ? c.toString("utf8") : String(c));
      return true;
    },
  };
  const code = await runCli({
    argv,
    repoRootHint: repoRoot,
    execPath: process.execPath,
    stdout,
    stderr,
  });
  return { code, stdout: chunksOut.join(""), stderr: chunksErr.join("") };
}

function closedConfig(overrides) {
  const cfg = defaultInitConfig();
  const extra = overrides || {};
  const merged = Object.assign({}, cfg, extra);
  if (extra.eligibility) {
    merged.eligibility = Object.assign({}, cfg.eligibility, extra.eligibility);
  }
  if (extra.p50) {
    merged.p50 = Object.assign({}, cfg.p50, extra.p50);
  }
  if (extra.testGroups) {
    merged.testGroups = extra.testGroups;
  }
  return validateConfig(merged);
}

function replaceConfig(repoRoot, cfg) {
  const dest = path.join(repoRoot, ".gates", "config.json");
  atomicWriteFile(repoRoot, dest, stableStringify(cfg) + "\n");
}

function replaceState(repoRoot, mutator) {
  const dest = path.join(repoRoot, ".gates", "state.json");
  const st = parseJsonSafe(fs.readFileSync(dest, "utf8"), "GATE_RUNNER_INVALID_STATE");
  mutator(st);
  atomicWriteFile(repoRoot, dest, stableStringify(validateState(st)) + "\n");
}

function rmrf(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

async function initFixture() {
  const dir = makeFixtureRepo();
  const res = await runCliAgainstFixture(dir, ["init", "--json"]);
  return { dir, res };
}

test("helpers sanity makeFixtureRepo", () => {
  const dir = makeFixtureRepo();
  assert.ok(fs.existsSync(path.join(dir, ".git")));
  rmrf(dir);
});

module.exports = {
  makeFixtureRepo,
  runCliAgainstFixture,
  closedConfig,
  replaceConfig,
  replaceState,
  rmrf,
  initFixture,
};
