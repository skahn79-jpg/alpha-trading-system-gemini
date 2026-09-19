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
  rmrf,
} = require("./gate-runner-helpers.test.js");
const { analyzeP50 } = require("../tools/gate-runner/p50");
const { inspectGit } = require("../tools/gate-runner/git-inspector");

function p50Config(allowFile) {
  return closedConfig({
    knownUntracked: [".renderignore"],
    safetyScanRoots: ["lib"],
    eligibility: { scanRoots: ["lib"] },
    p50: { file: allowFile, testId: "GATE5H-P50" },
    testGroups: { full: { args: ["--test", "README.md"], timeoutMs: 1000 } },
  });
}

test("A25 P50 missing approved path predicted (p50ActualDiffConflict true)", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    fs.mkdirSync(path.join(dir, "test"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "test", "p50.test.js"),
      [
        'test("GATE5H-P50 allow", () => {',
        '  const allowed = new Set([',
        '    "README.md",',
        "  ]);",
        "});",
      ].join("\n")
    );
    fs.writeFileSync(path.join(dir, "extra.js"), "module.exports = 1;\n");
    execFileSync("git", ["add", "extra.js"], { cwd: dir });
    execFileSync("git", ["commit", "-m", "extra"], { cwd: dir });
    replaceConfig(dir, p50Config("test/p50.test.js"));
    replaceStateHead(dir);
    fs.writeFileSync(path.join(dir, "extra.js"), "module.exports = 2;\n");
    const git = inspectGit(dir, [".renderignore"]);
    const p50 = analyzeP50({ repoRoot: dir, config: p50Config("test/p50.test.js"), gitSnapshot: git });
    assert.equal(p50.p50ParseStatus, "PARSED");
    assert.equal(p50.p50ActualDiffConflict, true);
  } finally {
    rmrf(dir);
  }
});

function replaceStateHead(dir) {
  const { replaceState } = require("./gate-runner-helpers.test.js");
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  replaceState(dir, (st) => {
    st.tracks.TRADING.expectedHead = head;
    st.tracks.AUTOMATION.expectedHead = head;
  });
}

test("A26 P50 unknown parser yields UNKNOWN", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    fs.mkdirSync(path.join(dir, "test"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "test", "p50.test.js"),
      [
        'test("GATE5H-P50 allow", () => {',
        "  const foo = 'README.md';",
        "  const allowed = new Set([foo]);",
        "});",
      ].join("\n")
    );
    replaceConfig(dir, p50Config("test/p50.test.js"));
    const git = inspectGit(dir, []);
    const p50 = analyzeP50({ repoRoot: dir, config: p50Config("test/p50.test.js"), gitSnapshot: git });
    assert.equal(p50.p50ParseStatus, "UNKNOWN");
    assert.notEqual(p50.p50ActualDiffConflict, false);
  } finally {
    rmrf(dir);
  }
});

test("A45 P21 Set not used as P50", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    fs.mkdirSync(path.join(dir, "lib"), { recursive: true });
    fs.writeFileSync(path.join(dir, "lib", "evil.js"), "module.exports = 1;\n");
    execFileSync("git", ["add", "lib/evil.js"], { cwd: dir });
    execFileSync("git", ["commit", "-m", "evil"], { cwd: dir });
    fs.mkdirSync(path.join(dir, "test"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "test", "p50.test.js"),
      [
        'test("GATE5H-P50 allow", () => {',
        '  const allowed = new Set([',
        '    "README.md",',
        "  ]);",
        "});",
        'test("GATE5J-P21 GATE5H-P50 later", () => {',
        '  const allowed = new Set([',
        '    "lib/evil.js",',
        "  ]);",
        "});",
      ].join("\n")
    );
    replaceConfig(dir, p50Config("test/p50.test.js"));
    replaceStateHead(dir);
    fs.writeFileSync(path.join(dir, "lib", "evil.js"), "module.exports = 2;\n");
    const git = inspectGit(dir, []);
    const p50 = analyzeP50({ repoRoot: dir, config: p50Config("test/p50.test.js"), gitSnapshot: git });
    assert.equal(p50.p50ParseStatus, "PARSED");
    assert.deepEqual(p50.allowlist, ["README.md"]);
    assert.equal(p50.p50ActualDiffConflict, true);
    assert.ok(p50.missingFromAllowlist.includes("lib/evil.js"));
  } finally {
    rmrf(dir);
  }
});

test("A46 untracked prediction not labeled as actual P50 fail", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    fs.mkdirSync(path.join(dir, "test"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "test", "p50.test.js"),
      [
        'test("GATE5H-P50 allow", () => {',
        '  const allowed = new Set([',
        '    "README.md",',
        "  ]);",
        "});",
      ].join("\n")
    );
    replaceConfig(dir, p50Config("test/p50.test.js"));
    fs.writeFileSync(path.join(dir, "surprise.txt"), "u\n");
    const git = inspectGit(dir, [".renderignore"]);
    const p50 = analyzeP50({ repoRoot: dir, config: p50Config("test/p50.test.js"), gitSnapshot: git });
    assert.equal(p50.p50ParseStatus, "PARSED");
    assert.equal(p50.p50ActualDiffConflict, false);
    assert.ok(p50.untrackedOutsideKnown.includes("surprise.txt"));
    const ins = await runCliAgainstFixture(dir, ["inspect", "--json"]);
    const body = JSON.parse(ins.stdout);
    const untrackedFinding = body.findings.find((f) => f.code === "UNEXPECTED_UNTRACKED");
    assert.ok(untrackedFinding);
    assert.equal(untrackedFinding.p50Fail, false);
    assert.equal(
      body.findings.some((f) => f.code === "P50_PREDICTED_ALLOWLIST_CONFLICT"),
      false
    );
  } finally {
    rmrf(dir);
  }
});
