"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  defaultInitConfig,
  defaultInitState,
  validateConfig,
  validateState,
  validateTestArgsGrammar,
  validateGateId,
} = require("../tools/gate-runner/schema");
const { GateRunnerError } = require("../tools/gate-runner/errors");

function assertCode(fn, code) {
  assert.throws(fn, (err) => err instanceof GateRunnerError && err.code === code);
}

test("A08 state schema valid", () => {
  const head = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const st = defaultInitState(head);
  const out = validateState(st);
  assert.equal(out.version, 1);
  assert.ok(out.tracks.TRADING);
  assert.ok(out.tracks.AUTOMATION);
  assert.equal(out.pushAllowed, false);
  assert.equal(Object.prototype.hasOwnProperty.call(out, "currentGate"), false);
});

test("A09 state unknown version rejected", () => {
  const st = defaultInitState("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  st.version = 2;
  assertCode(() => validateState(st), "GATE_RUNNER_INVALID_STATE");
});

test("A10 malformed state rejected", () => {
  assertCode(() => validateState(null), "GATE_RUNNER_INVALID_STATE");
  assertCode(() => validateState({ version: 1 }), "GATE_RUNNER_INVALID_STATE");
  const st = defaultInitState("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  st.currentGate = "GATE-A2";
  assertCode(() => validateState(st), "GATE_RUNNER_INVALID_STATE");
});

test("A11 config schema valid", () => {
  const cfg = validateConfig(defaultInitConfig());
  assert.equal(cfg.configVersion, 1);
  assert.equal(cfg.testGroups.full.expectedTotal, undefined);
  assert.deepEqual(cfg.testGroups.full.args, ["--test", "test/*.test.js"]);
});

test("A12 unknown config key rejected", () => {
  const cfg = defaultInitConfig();
  cfg.extra = true;
  assertCode(() => validateConfig(cfg), "GATE_RUNNER_INVALID_CONFIG");
});

test("A31 arbitrary shell injection impossible in test config (command/shell/executable keys reject)", () => {
  const cfg = defaultInitConfig();
  cfg.command = "rm -rf /";
  assertCode(() => validateConfig(cfg), "GATE_RUNNER_INVALID_CONFIG");
  const cfg2 = defaultInitConfig();
  cfg2.shell = true;
  assertCode(() => validateConfig(cfg2), "GATE_RUNNER_INVALID_CONFIG");
});

test("A43 npm executable rejected (config executable key)", () => {
  const cfg = defaultInitConfig();
  cfg.executable = "npm";
  assertCode(() => validateConfig(cfg), "GATE_RUNNER_INVALID_CONFIG");
});

test("C5 safety root ../outside rejected", () => {
  const cfg = defaultInitConfig();
  cfg.safetyScanRoots = ["../outside"];
  assertCode(() => validateConfig(cfg), "GATE_RUNNER_INVALID_CONFIG");
});

test("C6 p50.file ../outside rejected", () => {
  const cfg = defaultInitConfig();
  cfg.p50.file = "../outside";
  assertCode(() => validateConfig(cfg), "GATE_RUNNER_INVALID_CONFIG");
});

test("H1 eligibility.scanRoots parent traversal rejected", () => {
  const cfg = defaultInitConfig();
  cfg.eligibility.scanRoots = ["../x"];
  assertCode(() => validateConfig(cfg), "GATE_RUNNER_INVALID_CONFIG");
});

test("H1 safetyScanRoots absolute path rejected", () => {
  const cfg = defaultInitConfig();
  cfg.safetyScanRoots = ["/etc"];
  assertCode(() => validateConfig(cfg), "GATE_RUNNER_INVALID_CONFIG");
});

test("H1 p50.file url-like path rejected", () => {
  const cfg = defaultInitConfig();
  cfg.p50.file = "file:///tmp/x";
  assertCode(() => validateConfig(cfg), "GATE_RUNNER_INVALID_CONFIG");
});

test("H1 p50.file windows drive rejected", () => {
  const cfg = defaultInitConfig();
  cfg.p50.file = "C:\\x";
  assertCode(() => validateConfig(cfg), "GATE_RUNNER_INVALID_CONFIG");
});

test("H1 testGroups.full.args --eval rejected", () => {
  const cfg = defaultInitConfig();
  cfg.testGroups.full.args = ["--eval", "1"];
  assertCode(() => validateConfig(cfg), "GATE_RUNNER_INVALID_CONFIG");
});

test("H1 test args not starting with --test rejected", () => {
  const cfg = defaultInitConfig();
  cfg.testGroups.full.args = ["test/*.test.js"];
  assertCode(() => validateConfig(cfg), "GATE_RUNNER_INVALID_CONFIG");
  assertCode(() => validateTestArgsGrammar(["test/a.test.js"]), "GATE_RUNNER_INVALID_CONFIG");
  assertCode(() => validateTestArgsGrammar(["--experimental-vm-modules", "--test"]), "GATE_RUNNER_INVALID_CONFIG");
});

test("H1 test args grammar rejects empty, non-string, flags and NODE_OPTIONS", () => {
  assertCode(() => validateTestArgsGrammar([]), "GATE_RUNNER_INVALID_CONFIG");
  assertCode(() => validateTestArgsGrammar(null), "GATE_RUNNER_INVALID_CONFIG");
  assertCode(() => validateTestArgsGrammar(["--test", ""]), "GATE_RUNNER_INVALID_CONFIG");
  assertCode(() => validateTestArgsGrammar(["--test", 1]), "GATE_RUNNER_INVALID_CONFIG");
  assertCode(() => validateTestArgsGrammar(["--test", "--require"]), "GATE_RUNNER_INVALID_CONFIG");
  assertCode(() => validateTestArgsGrammar(["--test", "NODE_OPTIONS=--require x"]), "GATE_RUNNER_INVALID_CONFIG");
});

test("H1 test args grammar rejects escaping operands", () => {
  assertCode(() => validateTestArgsGrammar(["--test", "../outside/a.test.js"]), "GATE_RUNNER_INVALID_CONFIG");
  assertCode(() => validateTestArgsGrammar(["--test", "/tmp/a.test.js"]), "GATE_RUNNER_INVALID_CONFIG");
  assertCode(() => validateTestArgsGrammar(["--test", "file:///tmp/a.test.js"]), "GATE_RUNNER_INVALID_CONFIG");
});

test("H1 test args grammar accepts repo-relative globs and repeated --test", () => {
  assert.deepEqual(validateTestArgsGrammar(["--test", "test/*.test.js"]), ["--test", "test/*.test.js"]);
  assert.deepEqual(validateTestArgsGrammar(["--test", "test/a.test.js", "--test", "test/b.test.js"]), [
    "--test",
    "test/a.test.js",
    "--test",
    "test/b.test.js",
  ]);
});

test("H1 defaultInitConfig round-trips through validateConfig unchanged", () => {
  const cfg = defaultInitConfig();
  const out = validateConfig(defaultInitConfig());
  assert.deepEqual(out, cfg);
  assert.deepEqual(out.safetyScanRoots, ["lib/paper", "lib/backtest"]);
  assert.equal(out.p50.file, "test/backtest-synthetic-pipeline.test.js");
});

test("R2-C01 currentGate ../../../lib/paper/pwn → validateState INVALID_STATE", () => {
  const st = defaultInitState("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  st.tracks.AUTOMATION.currentGate = "../../../lib/paper/pwn";
  assertCode(() => validateState(st), "GATE_RUNNER_INVALID_STATE");
});

test("R2-C03 gateId ../x rejected", () => {
  assertCode(() => validateGateId("../x"), "GATE_RUNNER_INVALID_ARGUMENT");
});

test("R2-C04 gateId A/B rejected", () => {
  assertCode(() => validateGateId("A/B"), "GATE_RUNNER_INVALID_ARGUMENT");
});

test("R2-C05 gateId A\\B rejected", () => {
  assertCode(() => validateGateId("A\\B"), "GATE_RUNNER_INVALID_ARGUMENT");
});

test("R2-C06 absolute Unix gateId rejected", () => {
  assertCode(() => validateGateId("/tmp/x"), "GATE_RUNNER_INVALID_ARGUMENT");
});

test("R2-C07 Windows drive-like gateId rejected", () => {
  assertCode(() => validateGateId("C:\\x"), "GATE_RUNNER_INVALID_ARGUMENT");
  assertCode(() => validateGateId("C:/Windows"), "GATE_RUNNER_INVALID_ARGUMENT");
});

test("R2-C08 gateId . rejected", () => {
  assertCode(() => validateGateId("."), "GATE_RUNNER_INVALID_ARGUMENT");
});

test("R2-C09 gateId .. rejected", () => {
  assertCode(() => validateGateId(".."), "GATE_RUNNER_INVALID_ARGUMENT");
});

test("R2-C10 newline gateId rejected", () => {
  assertCode(() => validateGateId("GATE\nA3"), "GATE_RUNNER_INVALID_ARGUMENT");
});

test("R2-C11 GATE-A3-R2 accepted", () => {
  assert.equal(validateGateId("GATE-A3-R2"), "GATE-A3-R2");
  assert.equal(validateGateId("11N"), "11N");
  assert.equal(validateGateId("GATE-A3"), "GATE-A3");
  assert.equal(validateGateId("GATE_A3_REVISION_2"), "GATE_A3_REVISION_2");
  assert.equal(validateGateId("UNSET"), "UNSET");
  assert.equal(validateGateId("GATE-A1"), "GATE-A1");
  assert.equal(validateGateId("GATE-A2"), "GATE-A2");
  assert.equal(validateGateId("GATE-X9"), "GATE-X9");
});

test("R2-C12 11N-R1 accepted", () => {
  assert.equal(validateGateId("11N-R1"), "11N-R1");
});
