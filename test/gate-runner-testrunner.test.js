"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  makeFixtureRepo,
  runCliAgainstFixture,
  closedConfig,
  replaceConfig,
  rmrf,
} = require("./gate-runner-helpers.test.js");
const { buildTestArgv, buildTestEnv, parseTestSummary, resolveTestOperands, runTests } = require("../tools/gate-runner/test-runner");
const { validateTestArgsGrammar } = require("../tools/gate-runner/schema");
const { GateRunnerError } = require("../tools/gate-runner/errors");
const { validateTestPathOperand } = require("../tools/gate-runner/fs-safe");

function assertInvalidConfig(args) {
  assert.throws(
    () => validateTestArgsGrammar(args),
    (err) => err instanceof GateRunnerError && err.code === "GATE_RUNNER_INVALID_CONFIG",
    `expected GATE_RUNNER_INVALID_CONFIG for ${JSON.stringify(args)}`
  );
}

function writeTiny(dir, name, source) {
  const tdir = path.join(dir, "test");
  fs.mkdirSync(tdir, { recursive: true });
  fs.writeFileSync(path.join(tdir, name), source);
}

function assertPathEscape(fn) {
  assert.throws(fn, (err) => err instanceof GateRunnerError && err.code === "GATE_RUNNER_PATH_ESCAPE");
}

function assertResolveInvalidConfig(fn) {
  assert.throws(fn, (err) => err instanceof GateRunnerError && err.code === "GATE_RUNNER_INVALID_CONFIG");
}

function tinyPassSource() {
  return '"use strict";\nconst test = require("node:test");\ntest("ok", () => {});\n';
}

function testConfig(dir, group, extra) {
  replaceConfig(
    dir,
    closedConfig(
      Object.assign(
        {
          knownUntracked: [],
          safetyScanRoots: ["lib"],
          eligibility: { scanRoots: ["lib"] },
          p50: { file: "README.md", testId: "GATE5H-P50" },
          testGroups: { full: group },
        },
        extra || {}
      )
    )
  );
}

test("A19 test PASS parsed", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    writeTiny(dir, "tiny-pass.test.js", '"use strict";\nconst test = require("node:test");\ntest("ok", () => {});\n');
    testConfig(dir, { args: ["--test", "test/tiny-pass.test.js"], timeoutMs: 20000 });
    const res = await runCliAgainstFixture(dir, ["test", "--json"]);
    const body = JSON.parse(res.stdout);
    assert.equal(body.tests.unknown, false);
    assert.equal(body.tests.tests, 1);
    assert.equal(body.tests.pass, 1);
    assert.equal(body.tests.fail, 0);
    assert.equal(body.machineVerdict, "PASS");
    assert.equal(res.code, 0);
  } finally {
    rmrf(dir);
  }
});

test("A20 test FAIL parsed", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    writeTiny(
      dir,
      "tiny-fail.test.js",
      '"use strict";\nconst test = require("node:test");\nconst assert = require("node:assert/strict");\ntest("fail", () => { assert.equal(1, 2); });\n'
    );
    testConfig(dir, { args: ["--test", "test/tiny-fail.test.js"], timeoutMs: 20000 });
    const res = await runCliAgainstFixture(dir, ["test", "--json"]);
    const body = JSON.parse(res.stdout);
    assert.equal(body.tests.fail, 1);
    assert.equal(body.machineVerdict, "FAIL");
    assert.notEqual(res.code, 0);
  } finally {
    rmrf(dir);
  }
});

test("A21 test unknown count handled UNKNOWN", () => {
  const u = parseTestSummary("no summary");
  assert.equal(u.tests, "UNKNOWN");
  assert.equal(u.pass, "UNKNOWN");
  assert.equal(u.fail, "UNKNOWN");
  assert.equal(u.skipped, "UNKNOWN");
  assert.equal(u.unknown, true);
});

test("A22 test timeout handled", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    writeTiny(
      dir,
      "tiny-hang.test.js",
      '"use strict";\nconst test = require("node:test");\ntest("h", () => new Promise(() => {}));\n'
    );
    testConfig(dir, { args: ["--test", "test/tiny-hang.test.js"], timeoutMs: 300 });
    const res = await runCliAgainstFixture(dir, ["test", "--json"]);
    const body = JSON.parse(res.stdout);
    assert.equal(body.tests.timedOut, true);
    assert.ok(body.findings.some((f) => f.code === "GATE_RUNNER_TEST_TIMEOUT"));
    assert.notEqual(res.code, 0);
  } finally {
    rmrf(dir);
  }
});

test("A23 expected count mismatch detected", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    writeTiny(dir, "tiny-pass.test.js", '"use strict";\nconst test = require("node:test");\ntest("ok", () => {});\n');
    testConfig(dir, { args: ["--test", "test/tiny-pass.test.js"], timeoutMs: 20000, expectedTotal: 99 });
    const res = await runCliAgainstFixture(dir, ["test", "--json"]);
    const body = JSON.parse(res.stdout);
    assert.ok(body.findings.some((f) => f.code === "EXPECTED_TOTAL_MISMATCH"));
    assert.equal(body.machineVerdict, "FAIL");
  } finally {
    rmrf(dir);
  }
});

test("A24 skipped increase detected (skipped > 0 vs baseline 0 as finding)", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    writeTiny(
      dir,
      "tiny-skip.test.js",
      '"use strict";\nconst test = require("node:test");\ntest("skipme", { skip: true }, () => {});\n'
    );
    testConfig(dir, { args: ["--test", "test/tiny-skip.test.js"], timeoutMs: 20000 });
    const res = await runCliAgainstFixture(dir, ["test", "--json"]);
    const body = JSON.parse(res.stdout);
    assert.ok(body.tests.skipped > 0);
    assert.ok(body.findings.some((f) => f.code === "SKIPPED_INCREASE"));
  } finally {
    rmrf(dir);
  }
});

test("A44 NODE_OPTIONS not inherited (inspect spawned env builder)", () => {
  const prev = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = "--require ./evil.js";
  try {
    const env = buildTestEnv();
    assert.equal(env.NODE_OPTIONS, undefined);
    assert.equal(env.NODE_PATH, undefined);
    assert.equal(env.NODE_EXTRA_CA_CERTS, undefined);
    assert.equal(env.NODE_ENV, "test");
  } finally {
    if (prev === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = prev;
  }
});

test("A47 truncated output not PASS", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    writeTiny(
      dir,
      "tiny-loud.test.js",
      '"use strict";\nconst test = require("node:test");\ntest("loud", () => { process.stdout.write("x".repeat(200000)); });\n'
    );
    testConfig(
      dir,
      { args: ["--test", "test/tiny-loud.test.js"], timeoutMs: 20000 },
      { stdoutCaptureMaxBytes: 64, stderrCaptureMaxBytes: 64 }
    );
    const res = await runCliAgainstFixture(dir, ["test", "--json"]);
    const body = JSON.parse(res.stdout);
    assert.equal(body.tests.truncated, true);
    assert.notEqual(body.machineVerdict, "PASS");
    assert.notEqual(res.code, 0);
  } finally {
    rmrf(dir);
  }
});

test("A52 timeout kill does not kill parent group", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "tools", "gate-runner", "test-runner.js"), "utf8");
  assert.equal(src.includes("kill(-"), true);
  assert.equal(src.includes("process.kill(process.pid)"), false);
  assert.equal(src.includes("unref()"), false);
});

test("parseTestSummary unit", () => {
  const s = parseTestSummary("# tests 2\n# pass 1\n# fail 1\n# skipped 0\n");
  assert.equal(s.tests, 2);
  assert.equal(s.unknown, false);
  const u = parseTestSummary("no summary");
  assert.equal(u.tests, "UNKNOWN");
});

test("C1 test args -e rejected", () => {
  assertInvalidConfig(["-e", "process.stdout.write('x')"]);
  assertInvalidConfig(["--test", "-e", "1"]);
});

test("C2 test args --require rejected", () => {
  assertInvalidConfig(["--test", "--require", "x"]);
});

test("C3 test args --import= rejected", () => {
  assertInvalidConfig(["--test", "--import=foo"]);
});

test("C4 test path ../outside.test.js rejected", () => {
  assertInvalidConfig(["--test", "../outside.test.js"]);
});

test("C1-C4 test args grammar rejects code-injection flags and escaping operands", () => {
  const rejected = [
    ["--eval", "1"],
    ["--test", "--eval", "1"],
    ["--test", "-r", "x"],
    ["--test", "--require=x"],
    ["--test", "--import"],
    ["--test", "--loader"],
    ["--test", "--loader=x"],
    ["--test", "--inspect"],
    ["--test", "--inspect-brk"],
    ["--test", "--foo"],
    ["--test", "--"],
    ["--test", "NODE_OPTIONS=--require x"],
    ["--test", "/tmp/x.test.js"],
    [],
  ];
  for (const args of rejected) {
    assertInvalidConfig(args);
  }
  assert.deepEqual(validateTestArgsGrammar(["--test", "test/*.test.js"]), ["--test", "test/*.test.js"]);
  assert.deepEqual(validateTestArgsGrammar(["--test", "README.md"]), ["--test", "README.md"]);
});

test("A3R1-H1 escaping symlink test operand rejected before spawn", async () => {
  const dir = makeFixtureRepo();
  const outside = path.join(os.tmpdir(), `gate-runner-outside-${process.pid}.test.js`);
  fs.writeFileSync(outside, '"use strict";\n');
  try {
    fs.symlinkSync(outside, path.join(dir, "escape.test.js"));
    const isPathEscape = (err) =>
      err instanceof GateRunnerError && err.code === "GATE_RUNNER_PATH_ESCAPE";
    assert.throws(() => validateTestPathOperand(dir, "escape.test.js"), isPathEscape);
    await assert.rejects(
      runTests({
        repoRoot: dir,
        args: ["--test", "escape.test.js"],
        timeoutMs: 5000,
        execPath: process.execPath,
      }),
      isPathEscape
    );
  } finally {
    rmrf(dir);
    try {
      fs.unlinkSync(outside);
    } catch {
      /* ignore */
    }
  }
});

test("R3-C01 ordinary test/*.test.js resolve/build/run accepted", async () => {
  const dir = makeFixtureRepo();
  try {
    writeTiny(dir, "tiny-pass.test.js", tinyPassSource());
    assert.deepEqual(resolveTestOperands(dir, ["test/*.test.js"]), ["test/tiny-pass.test.js"]);
    assert.deepEqual(buildTestArgv(dir, ["--test", "test/*.test.js"]), ["--test", "test/tiny-pass.test.js"]);
    const result = await runTests({
      repoRoot: dir,
      args: ["--test", "test/*.test.js"],
      timeoutMs: 20000,
      execPath: process.execPath,
    });
    assert.equal(result.pass, 1);
    assert.equal(result.fail, 0);
  } finally {
    rmrf(dir);
  }
});

test("R3-C02 child symlink to outside rejected before spawn", async () => {
  const dir = makeFixtureRepo();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-runner-r3-c02-"));
  const outside = path.join(outsideDir, "outside.test.js");
  fs.writeFileSync(outside, tinyPassSource());
  try {
    writeTiny(dir, "ok.test.js", tinyPassSource());
    fs.symlinkSync(outside, path.join(dir, "test", "evil.test.js"));
    assertPathEscape(() => resolveTestOperands(dir, ["test/*.test.js"]));
    await assert.rejects(
      runTests({
        repoRoot: dir,
        args: ["--test", "test/*.test.js"],
        timeoutMs: 5000,
        execPath: process.execPath,
      }),
      (err) => err instanceof GateRunnerError && err.code === "GATE_RUNNER_PATH_ESCAPE"
    );
  } finally {
    rmrf(dir);
    rmrf(outsideDir);
  }
});

test("R3-C03 child symlink to inside repo .test.js rejected", async () => {
  const dir = makeFixtureRepo();
  try {
    writeTiny(dir, "real.test.js", tinyPassSource());
    fs.symlinkSync(path.join(dir, "test", "real.test.js"), path.join(dir, "test", "link.test.js"));
    assertPathEscape(() => resolveTestOperands(dir, ["test/*.test.js"]));
    await assert.rejects(
      runTests({
        repoRoot: dir,
        args: ["--test", "test/*.test.js"],
        timeoutMs: 5000,
        execPath: process.execPath,
      }),
      (err) => err instanceof GateRunnerError && err.code === "GATE_RUNNER_PATH_ESCAPE"
    );
  } finally {
    rmrf(dir);
  }
});

test("R3-C04 explicit test symlink to outside rejected", async () => {
  const dir = makeFixtureRepo();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-runner-r3-c04-"));
  const outside = path.join(outsideDir, "outside.test.js");
  fs.writeFileSync(outside, tinyPassSource());
  try {
    fs.mkdirSync(path.join(dir, "test"), { recursive: true });
    fs.symlinkSync(outside, path.join(dir, "test", "escape.test.js"));
    assertPathEscape(() => resolveTestOperands(dir, ["test/escape.test.js"]));
    await assert.rejects(
      runTests({
        repoRoot: dir,
        args: ["--test", "test/escape.test.js"],
        timeoutMs: 5000,
        execPath: process.execPath,
      }),
      (err) => err instanceof GateRunnerError && err.code === "GATE_RUNNER_PATH_ESCAPE"
    );
  } finally {
    rmrf(dir);
    rmrf(outsideDir);
  }
});

test("R3-C05 explicit test symlink to inside rejected", async () => {
  const dir = makeFixtureRepo();
  try {
    writeTiny(dir, "real.test.js", tinyPassSource());
    fs.symlinkSync(path.join(dir, "test", "real.test.js"), path.join(dir, "test", "link.test.js"));
    assertPathEscape(() => resolveTestOperands(dir, ["test/link.test.js"]));
    await assert.rejects(
      runTests({
        repoRoot: dir,
        args: ["--test", "test/link.test.js"],
        timeoutMs: 5000,
        execPath: process.execPath,
      }),
      (err) => err instanceof GateRunnerError && err.code === "GATE_RUNNER_PATH_ESCAPE"
    );
  } finally {
    rmrf(dir);
  }
});

test("R3-C06 wildcard directory symlink to outside rejected", async () => {
  const dir = makeFixtureRepo();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-runner-r3-c06-"));
  try {
    fs.writeFileSync(path.join(outsideDir, "x.test.js"), tinyPassSource());
    fs.symlinkSync(outsideDir, path.join(dir, "test"));
    assertPathEscape(() => resolveTestOperands(dir, ["test/*.test.js"]));
    await assert.rejects(
      runTests({
        repoRoot: dir,
        args: ["--test", "test/*.test.js"],
        timeoutMs: 5000,
        execPath: process.execPath,
      }),
      (err) => err instanceof GateRunnerError && err.code === "GATE_RUNNER_PATH_ESCAPE"
    );
  } finally {
    rmrf(dir);
    rmrf(outsideDir);
  }
});

test("R3-C07 parent-traversal glob operands rejected", () => {
  assertInvalidConfig(["--test", "../x/*.test.js"]);
  assertInvalidConfig(["--test", "../*.test.js"]);
  assertResolveInvalidConfig(() => resolveTestOperands(process.cwd(), ["../x/*.test.js"]));
  assertResolveInvalidConfig(() => resolveTestOperands(process.cwd(), ["../*.test.js"]));
});

test("R3-C08 test/*.test.js with empty test dir rejected", () => {
  const dir = makeFixtureRepo();
  try {
    fs.mkdirSync(path.join(dir, "test"), { recursive: true });
    assertResolveInvalidConfig(() => resolveTestOperands(dir, ["test/*.test.js"]));
    assertResolveInvalidConfig(() => buildTestArgv(dir, ["--test", "test/*.test.js"]));
  } finally {
    rmrf(dir);
  }
});

test("R3-C09 ** pattern rejected", () => {
  assertInvalidConfig(["--test", "test/**/*.test.js"]);
  assertInvalidConfig(["--test", "**/*.test.js"]);
  assertInvalidConfig(["--test", "test/gate-runner-*.test.js"]);
  assertResolveInvalidConfig(() => resolveTestOperands(process.cwd(), ["test/**/*.test.js"]));
});

test("R3-C10 ? pattern rejected", () => {
  assertInvalidConfig(["--test", "test/?.test.js"]);
  assertInvalidConfig(["--test", "test/a?.test.js"]);
  assertResolveInvalidConfig(() => resolveTestOperands(process.cwd(), ["test/?.test.js"]));
  assertResolveInvalidConfig(() => resolveTestOperands(process.cwd(), ["test/a?.test.js"]));
});

test("R3-C11 [] and {} patterns rejected", () => {
  assertInvalidConfig(["--test", "test/[ab].test.js"]);
  assertInvalidConfig(["--test", "test/{a,b}.test.js"]);
  assertResolveInvalidConfig(() => resolveTestOperands(process.cwd(), ["test/[ab].test.js"]));
  assertResolveInvalidConfig(() => resolveTestOperands(process.cwd(), ["test/{a,b}.test.js"]));
});

test("R3-C12 overlapping operands select one target", () => {
  const dir = makeFixtureRepo();
  try {
    writeTiny(dir, "tiny-pass.test.js", tinyPassSource());
    assert.deepEqual(resolveTestOperands(dir, ["test/*.test.js", "test/tiny-pass.test.js"]), [
      "test/tiny-pass.test.js",
    ]);
    assert.deepEqual(
      buildTestArgv(dir, ["--test", "test/*.test.js", "--test", "test/tiny-pass.test.js"]),
      ["--test", "test/tiny-pass.test.js"]
    );
  } finally {
    rmrf(dir);
  }
});

test("R3-C13 buildTestArgv / spawn argv contains no glob metacharacters", async () => {
  const dir = makeFixtureRepo();
  try {
    writeTiny(dir, "tiny-pass.test.js", tinyPassSource());
    const argv = buildTestArgv(dir, ["--test", "test/*.test.js"]);
    for (const arg of argv) {
      assert.equal(/[*?\[\]{}]/.test(arg), false);
    }
    assert.deepEqual(argv, ["--test", "test/tiny-pass.test.js"]);
    const src = fs.readFileSync(path.join(__dirname, "..", "tools", "gate-runner", "test-runner.js"), "utf8");
    assert.equal(src.includes("spawn(execPath, finalArgv"), true);
    assert.equal(src.includes("spawn(execPath, args"), false);
    const result = await runTests({
      repoRoot: dir,
      args: ["--test", "test/*.test.js"],
      timeoutMs: 20000,
      execPath: process.execPath,
    });
    assert.equal(result.pass, 1);
    assert.equal(result.fail, 0);
  } finally {
    rmrf(dir);
  }
});

test("R3-C14 original repro: symlink payload is not executed", async () => {
  const dir = makeFixtureRepo();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "gate-runner-r3-c14-"));
  const marker = path.join(scratch, "marker");
  const payload = path.join(scratch, "payload.test.js");
  fs.writeFileSync(
    payload,
    '"use strict";\nconst fs = require("node:fs");\nfs.writeFileSync(' +
      JSON.stringify(marker) +
      ", \"pwned\");\n"
  );
  try {
    fs.mkdirSync(path.join(dir, "test"), { recursive: true });
    fs.symlinkSync(payload, path.join(dir, "test", "evil.test.js"));
    await assert.rejects(
      runTests({
        repoRoot: dir,
        args: ["--test", "test/*.test.js"],
        timeoutMs: 5000,
        execPath: process.execPath,
      }),
      (err) => err instanceof GateRunnerError
    );
    assert.equal(fs.existsSync(marker), false);
  } finally {
    rmrf(dir);
    rmrf(scratch);
  }
});

test("R3-C15 resolveTestOperands matches on-disk test/*.test.js count", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const testDir = path.join(repoRoot, "test");
  const names = fs.readdirSync(testDir);
  const expected = [];
  for (const name of names) {
    if (!name.endsWith(".test.js") || name === ".test.js") continue;
    const abs = path.join(testDir, name);
    const lst = fs.lstatSync(abs);
    if (lst.isSymbolicLink()) continue;
    if (!lst.isFile()) continue;
    expected.push("test/" + name);
  }
  expected.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const got = resolveTestOperands(repoRoot, ["test/*.test.js"]);
  assert.equal(got.length, expected.length);
  assert.deepEqual(got, expected);
});
