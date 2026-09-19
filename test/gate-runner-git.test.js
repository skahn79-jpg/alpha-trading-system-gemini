"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  makeFixtureRepo,
  runCliAgainstFixture,
  closedConfig,
  replaceConfig,
  replaceState,
  rmrf,
} = require("./gate-runner-helpers.test.js");
const { rejectMutationCommand } = require("../tools/gate-runner");
const { inspectGit } = require("../tools/gate-runner/git-inspector");
const { GateRunnerError } = require("../tools/gate-runner/errors");

test("A01 status reads branch/HEAD", async () => {
  const dir = makeFixtureRepo();
  try {
    const init = await runCliAgainstFixture(dir, ["init", "--json"]);
    assert.equal(init.code, 0);
    const st = await runCliAgainstFixture(dir, ["status", "--json"]);
    assert.equal(st.code, 0);
    const body = JSON.parse(st.stdout);
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
    assert.equal(body.git.head, head);
    assert.equal(body.git.branch, branch);
  } finally {
    rmrf(dir);
  }
});

test("A02 status distinguishes staged/unstaged/untracked", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    fs.writeFileSync(path.join(dir, "README.md"), "dirty\n");
    fs.writeFileSync(path.join(dir, "staged.txt"), "s\n");
    execFileSync("git", ["add", "staged.txt"], { cwd: dir });
    fs.writeFileSync(path.join(dir, "untracked.txt"), "u\n");
    const st = await runCliAgainstFixture(dir, ["status", "--json"]);
    const body = JSON.parse(st.stdout);
    assert.ok(body.git.unstaged.includes("README.md"));
    assert.ok(body.git.staged.includes("staged.txt"));
    assert.ok(body.git.untracked.includes("untracked.txt"));
  } finally {
    rmrf(dir);
  }
});

test("A03 known untracked separated", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    replaceConfig(
      dir,
      closedConfig({
        knownUntracked: [".renderignore", "docs/kb/"],
        safetyScanRoots: ["lib"],
        eligibility: { scanRoots: ["lib"] },
        p50: { file: "README.md", testId: "GATE5H-P50" },
        testGroups: { full: { args: ["--test", "README.md"], timeoutMs: 1000 } },
      })
    );
    fs.writeFileSync(path.join(dir, ".renderignore"), "x\n");
    fs.mkdirSync(path.join(dir, "docs", "kb"), { recursive: true });
    fs.writeFileSync(path.join(dir, "docs", "kb", "x.txt"), "x\n");
    const git = inspectGit(dir, [".renderignore", "docs/kb/"]);
    assert.ok(git.knownUntracked.includes(".renderignore"));
    assert.ok(git.knownUntracked.some((p) => p.startsWith("docs/kb")));
    assert.equal(git.unexpectedUntracked.includes(".renderignore"), false);
  } finally {
    rmrf(dir);
  }
});

test("A04 unexpected untracked detected", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    fs.writeFileSync(path.join(dir, "surprise.txt"), "x\n");
    const git = inspectGit(dir, [".renderignore"]);
    assert.ok(git.unexpectedUntracked.includes("surprise.txt"));
  } finally {
    rmrf(dir);
  }
});

test("A05 contract Gate dirty worktree policy violation", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    replaceState(dir, (st) => {
      st.tracks.TRADING.phase = "CONTRACT";
    });
    replaceConfig(
      dir,
      closedConfig({
        knownUntracked: [],
        safetyScanRoots: ["lib"],
        eligibility: { scanRoots: ["lib"] },
        p50: { file: "README.md", testId: "GATE5H-P50" },
        testGroups: { full: { args: ["--test", "README.md"], timeoutMs: 1000 } },
      })
    );
    fs.writeFileSync(path.join(dir, "README.md"), "dirty-contract\n");
    const ins = await runCliAgainstFixture(dir, ["inspect", "--json"]);
    assert.notEqual(ins.code, 0);
    const body = JSON.parse(ins.stdout);
    assert.equal(body.machineVerdict, "REVIEW_REQUIRED");
    assert.ok(body.findings.some((f) => f.code === "GATE_RUNNER_POLICY_VIOLATION"));
  } finally {
    rmrf(dir);
  }
});

test("A06 stage-forbidden Gate staged file violation", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    fs.writeFileSync(path.join(dir, "staged.txt"), "s\n");
    execFileSync("git", ["add", "staged.txt"], { cwd: dir });
    replaceConfig(
      dir,
      closedConfig({
        knownUntracked: [],
        safetyScanRoots: ["lib"],
        eligibility: { scanRoots: ["lib"] },
        p50: { file: "README.md", testId: "GATE5H-P50" },
        testGroups: { full: { args: ["--test", "README.md"], timeoutMs: 1000 } },
      })
    );
    const ins = await runCliAgainstFixture(dir, ["inspect", "--json"]);
    const body = JSON.parse(ins.stdout);
    assert.ok(body.findings.some((f) => f.code === "GATE_RUNNER_POLICY_VIOLATION" && /staged/i.test(f.message)));
    assert.equal(body.machineVerdict, "REVIEW_REQUIRED");
  } finally {
    rmrf(dir);
  }
});

test("A07 fixed Git whitelist rejects mutation command", () => {
  assert.throws(
    () => rejectMutationCommand(["add", "file"]),
    (err) => err instanceof GateRunnerError && err.code === "GATE_RUNNER_GIT_ERROR"
  );
  assert.throws(() => rejectMutationCommand(["commit", "-m", "x"]));
  assert.throws(() => rejectMutationCommand(["push"]));
  assert.throws(() => rejectMutationCommand(["reset", "--hard"]));
  assert.throws(() => rejectMutationCommand(["checkout", "main"]));
  assert.throws(() => rejectMutationCommand(["-c", "core.filemode=false", "status"]));
  assert.doesNotThrow(() =>
    rejectMutationCommand(["diff", "--cached", "--name-only", "--no-ext-diff", "--no-textconv"])
  );
  assert.doesNotThrow(() =>
    rejectMutationCommand(["diff", "--name-only", "--no-ext-diff", "--no-textconv", "HEAD"])
  );
});
