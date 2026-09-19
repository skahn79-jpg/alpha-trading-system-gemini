"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  makeFixtureRepo,
  runCliAgainstFixture,
  rmrf,
} = require("./gate-runner-helpers.test.js");
const {
  resolveRepoRelative,
  ensureGatesWritable,
  atomicWriteFile,
  acquireLock,
  releaseLock,
  gatesDir,
  assertSafeRepoRelPattern,
  resolveContainedPath,
  collectContainedCodeFiles,
} = require("../tools/gate-runner/fs-safe");
const { GateRunnerError } = require("../tools/gate-runner/errors");

test("A13 path escape rejected", () => {
  const dir = makeFixtureRepo();
  try {
    assert.throws(
      () => resolveRepoRelative(dir, "/etc/passwd"),
      (err) => err instanceof GateRunnerError && err.code === "GATE_RUNNER_PATH_ESCAPE"
    );
    assert.throws(() => resolveRepoRelative(dir, "../../etc/passwd"));
  } finally {
    rmrf(dir);
  }
});

test("A14 symlink escape rejected", () => {
  const dir = makeFixtureRepo();
  try {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "gate-escape-"));
    fs.writeFileSync(path.join(outside, "secret.txt"), "x");
    fs.symlinkSync(outside, path.join(dir, "escape-link"));
    assert.throws(
      () => resolveRepoRelative(dir, "escape-link"),
      (err) => err instanceof GateRunnerError && err.code === "GATE_RUNNER_PATH_ESCAPE"
    );
    rmrf(outside);
  } finally {
    rmrf(dir);
  }
});

test("A15 init creates Gate-owned paths only", async () => {
  const dir = makeFixtureRepo();
  try {
    const before = new Set(fs.readdirSync(dir));
    const res = await runCliAgainstFixture(dir, ["init", "--json"]);
    assert.equal(res.code, 0);
    const after = fs.readdirSync(dir);
    const added = after.filter((n) => !before.has(n));
    assert.deepEqual(added.sort(), [".gates"]);
    const gates = fs.readdirSync(path.join(dir, ".gates")).sort();
    assert.ok(gates.includes("config.json"));
    assert.ok(gates.includes("state.json"));
    assert.ok(gates.includes("reports"));
    assert.ok(gates.includes("evidence"));
    assert.ok(gates.includes(".gitignore"));
    assert.equal(fs.existsSync(path.join(dir, ".gitignore")), false);
    const gi = fs.readFileSync(path.join(dir, ".gates", ".gitignore"), "utf8");
    assert.equal(gi.includes("*"), true);
    assert.equal(gi.includes("!.gitignore"), true);
  } finally {
    rmrf(dir);
  }
});

test("A16 init refuses overwrite", async () => {
  const dir = makeFixtureRepo();
  try {
    const a = await runCliAgainstFixture(dir, ["init"]);
    assert.equal(a.code, 0);
    const b = await runCliAgainstFixture(dir, ["init"]);
    assert.equal(b.code, 2);
    assert.match(b.stderr, /already exists|ALREADY_INITIALIZED|initialized/i);
  } finally {
    rmrf(dir);
  }
});

test("A32 state write atomic", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "tools", "gate-runner", "fs-safe.js"), "utf8");
  assert.match(src, /renameSync/);
  assert.equal(src.includes("os.tmpdir"), false);
  assert.equal(/require\(["']node:os["']\)/.test(src), false);
  assert.match(src, /path\.join\(dir,/);
});

test("A33 report write atomic", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "tools", "gate-runner", "report.js"), "utf8");
  assert.match(src, /atomicWriteFile/);
  const fsSrc = fs.readFileSync(path.join(__dirname, "..", "tools", "gate-runner", "fs-safe.js"), "utf8");
  assert.match(fsSrc, /renameSync/);
  assert.equal(fsSrc.includes("os.tmpdir"), false);
});

test("A34 lock contention rejected", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    const lock = acquireLock(dir, "test");
    try {
      assert.throws(
        () => acquireLock(dir, "test"),
        (err) => err instanceof GateRunnerError && err.code === "GATE_RUNNER_BUSY"
      );
    } finally {
      releaseLock(lock);
    }
  } finally {
    rmrf(dir);
  }
});

test("A42 realpath fail PATH_ESCAPE", () => {
  const dir = makeFixtureRepo();
  try {
    assert.throws(
      () => resolveRepoRelative(dir, "no-such-file.txt"),
      (err) => err instanceof GateRunnerError && err.code === "GATE_RUNNER_PATH_ESCAPE"
    );
  } finally {
    rmrf(dir);
  }
});

test("A49 lock O_EXCL", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "tools", "gate-runner", "fs-safe.js"), "utf8");
  assert.match(src, /O_EXCL/);
  assert.match(src, /O_CREAT/);
});

function assertPathCode(fn, code) {
  assert.throws(fn, (err) => err instanceof GateRunnerError && err.code === code);
}

test("H2 assertSafeRepoRelPattern rejects absolute, traversal, url-like and windows drive", () => {
  assertPathCode(() => assertSafeRepoRelPattern("/etc/passwd"), "GATE_RUNNER_INVALID_CONFIG");
  assertPathCode(() => assertSafeRepoRelPattern("../outside"), "GATE_RUNNER_INVALID_CONFIG");
  assertPathCode(() => assertSafeRepoRelPattern("lib/../../outside"), "GATE_RUNNER_INVALID_CONFIG");
  assertPathCode(() => assertSafeRepoRelPattern("file:///tmp/x"), "GATE_RUNNER_INVALID_CONFIG");
  assertPathCode(() => assertSafeRepoRelPattern("https://example.test/x"), "GATE_RUNNER_INVALID_CONFIG");
  assertPathCode(() => assertSafeRepoRelPattern("C:\\x"), "GATE_RUNNER_INVALID_CONFIG");
  assertPathCode(() => assertSafeRepoRelPattern("\\\\server\\share"), "GATE_RUNNER_INVALID_CONFIG");
  assertPathCode(() => assertSafeRepoRelPattern(""), "GATE_RUNNER_INVALID_CONFIG");
  assertPathCode(() => assertSafeRepoRelPattern(null), "GATE_RUNNER_INVALID_CONFIG");
  assertPathCode(() => assertSafeRepoRelPattern("test/a\0b.js"), "GATE_RUNNER_PATH_ESCAPE");
});

test("H2 assertSafeRepoRelPattern honours caller error code", () => {
  assertPathCode(
    () => assertSafeRepoRelPattern("../outside", "GATE_RUNNER_PATH_ESCAPE"),
    "GATE_RUNNER_PATH_ESCAPE"
  );
});

test("H2 assertSafeRepoRelPattern accepts repo-relative paths and globs", () => {
  assert.equal(assertSafeRepoRelPattern("test/*.test.js"), "test/*.test.js");
  assert.equal(assertSafeRepoRelPattern("README.md"), "README.md");
  assert.equal(assertSafeRepoRelPattern("lib/paper"), "lib/paper");
});

test("H2 resolveContainedPath mustExist missing file PATH_ESCAPE", () => {
  const dir = makeFixtureRepo();
  try {
    assertPathCode(
      () => resolveContainedPath(dir, "no-such-file.txt", { mustExist: true }),
      "GATE_RUNNER_PATH_ESCAPE"
    );
    const missing = resolveContainedPath(dir, "no-such-file.txt", { mustExist: false });
    assert.equal(missing.kind, "missing");
    assert.equal(missing.real, null);
  } finally {
    rmrf(dir);
  }
});

test("H2 resolveContainedPath containment uses root plus separator prefix", () => {
  const dir = makeFixtureRepo();
  const sibling = `${dir}-evil`;
  try {
    fs.mkdirSync(sibling);
    fs.writeFileSync(path.join(sibling, "secret.txt"), "x");
    fs.symlinkSync(sibling, path.join(dir, "sibling-link"));
    assertPathCode(
      () => resolveContainedPath(dir, "sibling-link", { mustExist: true }),
      "GATE_RUNNER_PATH_ESCAPE"
    );
    const inside = resolveContainedPath(dir, "README.md", { mustExist: true });
    assert.equal(inside.kind, "file");
    assert.equal(inside.real.startsWith(fs.realpathSync(dir) + path.sep), true);
  } finally {
    rmrf(sibling);
    rmrf(dir);
  }
});

test("H2 resolveContainedPath symlink escape rejected", () => {
  const dir = makeFixtureRepo();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "gate-escape-contained-"));
  try {
    fs.writeFileSync(path.join(outside, "secret.txt"), "x");
    fs.symlinkSync(outside, path.join(dir, "escape-link"));
    fs.symlinkSync(path.join(outside, "secret.txt"), path.join(dir, "escape-file-link"));
    assertPathCode(() => resolveContainedPath(dir, "escape-link"), "GATE_RUNNER_PATH_ESCAPE");
    assertPathCode(() => resolveContainedPath(dir, "escape-file-link"), "GATE_RUNNER_PATH_ESCAPE");
  } finally {
    rmrf(outside);
    rmrf(dir);
  }
});

test("H2 collectContainedCodeFiles records escaping child symlink without following it", () => {
  const dir = makeFixtureRepo();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "gate-escape-collect-"));
  try {
    fs.writeFileSync(path.join(outside, "leak.js"), "module.exports = 1;\n");
    const scanDir = path.join(dir, "lib", "paper");
    fs.mkdirSync(scanDir, { recursive: true });
    fs.writeFileSync(path.join(scanDir, "inside.js"), "module.exports = 2;\n");
    fs.symlinkSync(path.join(outside, "leak.js"), path.join(scanDir, "leak-link.js"));
    fs.symlinkSync(outside, path.join(scanDir, "outside-dir-link"));

    const res = collectContainedCodeFiles(dir, "lib/paper");
    assert.equal(res.missing, false);
    assert.ok(res.escaped.length > 0);
    assert.equal(
      res.escaped.some((p) => p.includes("leak-link.js")),
      true
    );
    assert.equal(
      res.escaped.some((p) => p.includes("outside-dir-link")),
      true
    );
    assert.equal(
      res.files.some((p) => p.endsWith(path.join("lib", "paper", "inside.js"))),
      true
    );
    assert.equal(
      res.files.some((p) => p.includes("leak.js")),
      false
    );
    const outsideReal = fs.realpathSync(outside);
    for (const f of res.files) {
      assert.equal(f.startsWith(outsideReal), false);
    }
  } finally {
    rmrf(outside);
    rmrf(dir);
  }
});

test("R2-C17 atomicWriteFile dest under .gates-evil/x → PATH_ESCAPE and .gates-evil is NOT created", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    assert.throws(
      () => atomicWriteFile(dir, path.join(dir, ".gates-evil", "x"), "x"),
      (err) => err instanceof GateRunnerError && err.code === "GATE_RUNNER_PATH_ESCAPE"
    );
    assert.equal(fs.existsSync(path.join(dir, ".gates-evil")), false);
  } finally {
    rmrf(dir);
  }
});
