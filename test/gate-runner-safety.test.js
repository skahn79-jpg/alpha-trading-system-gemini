"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  makeFixtureRepo,
  runCliAgainstFixture,
  closedConfig,
  replaceConfig,
  rmrf,
} = require("./gate-runner-helpers.test.js");
const { redactSecrets, looksLikeSecretEnvKey } = require("../tools/gate-runner/redaction");
const { classifyJs, scanSafety } = require("../tools/gate-runner/safety-scanner");
const { scanEligibility } = require("../tools/gate-runner/eligibility");
const { buildGitEnv } = require("../tools/gate-runner/git-inspector");

function writeScanFile(dir, relDir, name, source) {
  fs.mkdirSync(path.join(dir, relDir), { recursive: true });
  fs.writeFileSync(path.join(dir, relDir, name), source);
}

function hasFinding(result, code) {
  return (result.findings || []).some((f) => f && f.code === code);
}

function hasSeverity(result, severity) {
  return (result.findings || []).some((f) => f && f.severity === severity);
}

function baseCfg(extra) {
  return closedConfig(
    Object.assign(
      {
        knownUntracked: [],
        safetyScanRoots: ["lib"],
        eligibility: { scanRoots: ["lib"] },
        p50: { file: "README.md", testId: "GATE5H-P50" },
        testGroups: { full: { args: ["--test", "README.md"], timeoutMs: 1000 } },
      },
      extra || {}
    )
  );
}

test("A27 safety LiveBroker import FAIL (in fixture file, not project)", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    fs.mkdirSync(path.join(dir, "lib"), { recursive: true });
    fs.writeFileSync(path.join(dir, "lib", "hit.js"), 'const LiveBroker = require("./x");\n');
    replaceConfig(dir, baseCfg());
    const res = await runCliAgainstFixture(dir, ["safety", "--json"]);
    const body = JSON.parse(res.stdout);
    assert.equal(body.safety.status, "FAIL");
    assert.ok(body.findings.some((f) => f.code === "GATE_RUNNER_SAFETY_FAILED"));
    assert.notEqual(res.code, 0);
  } finally {
    rmrf(dir);
  }
});

test("A28 safety comment false positive not hard FAIL", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    fs.mkdirSync(path.join(dir, "lib"), { recursive: true });
    fs.writeFileSync(path.join(dir, "lib", "comment.js"), "// mentions LiveBroker and placeOrder only in a comment\nmodule.exports = 1;\n");
    replaceConfig(dir, baseCfg());
    const scanned = scanSafety(dir, ["lib"]);
    assert.notEqual(scanned.status, "FAIL");
    const cls = classifyJs(fs.readFileSync(path.join(dir, "lib", "comment.js"), "utf8"));
    assert.equal(cls.executableHits.filter((h) => h.name === "LiveBroker").length, 0);
    const res = await runCliAgainstFixture(dir, ["safety", "--json"]);
    const body = JSON.parse(res.stdout);
    assert.notEqual(body.safety.status, "FAIL");
    assert.notEqual(body.machineVerdict, "FAIL");
  } finally {
    rmrf(dir);
  }
});

test("A29 eligibility true detected blocker", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    fs.mkdirSync(path.join(dir, "lib"), { recursive: true });
    fs.writeFileSync(path.join(dir, "lib", "elig.js"), "module.exports = { paperEligible: true };\n");
    replaceConfig(dir, baseCfg());
    const res = await runCliAgainstFixture(dir, ["safety", "--json"]);
    const body = JSON.parse(res.stdout);
    assert.equal(body.eligibility.paperEligible, true);
    assert.ok(body.findings.some((f) => f.severity === "BLOCKER"));
    assert.notEqual(res.code, 0);
  } finally {
    rmrf(dir);
  }
});

test("A30 secret-like output redacted", () => {
  const out = redactSecrets("API_KEY=abc123secret TOKEN=xyz");
  assert.equal(out.includes("abc123secret"), false);
  assert.equal(out.includes("xyz"), false);
  assert.equal(looksLikeSecretEnvKey("KB_API_KEY"), true);
  assert.equal(looksLikeSecretEnvKey("PATH"), false);
});

test("A40 no network imports/calls in runner source", () => {
  const root = path.join(__dirname, "..");
  const files = [];
  function walk(d) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith(".js")) files.push(p);
    }
  }
  walk(path.join(root, "tools", "gate-runner"));
  files.push(path.join(root, "scripts", "gate.js"));
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    assert.equal(/require\s*\(\s*['"]node:https?['"]\s*\)/.test(src), false, f);
    assert.equal(/require\s*\(\s*['"]https?['"]\s*\)/.test(src), false, f);
    assert.equal(/require\s*\(\s*['"]axios['"]\s*\)/.test(src), false, f);
    assert.equal(/require\s*\(\s*['"]undici['"]\s*\)/.test(src), false, f);
    assert.equal(/\bfrom\s+['"]https?['"]/.test(src), false, f);
  }
});

test("A50 runner source does not require paper/kb/server", () => {
  const root = path.join(__dirname, "..");
  const files = [];
  function walk(d) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith(".js")) files.push(p);
    }
  }
  walk(path.join(root, "tools", "gate-runner"));
  files.push(path.join(root, "scripts", "gate.js"));
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    assert.equal(/require\s*\(\s*['"][^'"]*lib\/paper/.test(src), false, f);
    assert.equal(/require\s*\(\s*['"][^'"]*lib\/backtest/.test(src), false, f);
    assert.equal(/require\s*\(\s*['"][^'"]*kb\//.test(src), false, f);
    assert.equal(/require\s*\(\s*['"][^'"]*server\.js['"]/.test(src), false, f);
    assert.equal(/require\s*\(\s*['"][^'"]*trade\.js['"]/.test(src), false, f);
  }
});

test("C7 require template ../kb/${x} REVIEW_REQUIRED", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    writeScanFile(dir, "lib", "dyn.js", 'const x = "broker";\nrequire(`../kb/${x}`);\n');
    replaceConfig(dir, baseCfg());

    const scanned = scanSafety(dir, ["lib"]);
    assert.equal(scanned.status, "REVIEW_REQUIRED");
    assert.equal(hasFinding(scanned, "SAFETY_DYNAMIC_REQUIRE"), true);

    const res = await runCliAgainstFixture(dir, ["safety", "--json"]);
    const body = JSON.parse(res.stdout);
    assert.notEqual(body.machineVerdict, "PASS");
    assert.notEqual(body.machineVerdict, "PASS_WITH_NOTES");
    assert.equal(body.findings.some((f) => f.code === "SAFETY_DYNAMIC_REQUIRE"), true);
    assert.notEqual(res.code, 0);
  } finally {
    rmrf(dir);
  }
});

test('C8 obj["liveEligible"] = true hard failure', async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    writeScanFile(dir, "lib", "elig.js", 'const obj = {};\nobj["liveEligible"] = true;\n');
    replaceConfig(dir, baseCfg());

    const res = await runCliAgainstFixture(dir, ["safety", "--json"]);
    const body = JSON.parse(res.stdout);
    assert.equal(body.eligibility.liveEligible, true);
    assert.equal(body.hardStop, true);
    assert.equal(body.findings.some((f) => f.severity === "BLOCKER"), true);
    assert.equal(body.machineVerdict === "HARD_STOP" || body.machineVerdict === "FAIL", true);
    assert.notEqual(body.machineVerdict, "PASS");
    assert.notEqual(res.code, 0);
  } finally {
    rmrf(dir);
  }
});

test("C9 liveEligible = variable REVIEW_REQUIRED", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    writeScanFile(dir, "lib", "elig.js", "const v = true;\nliveEligible = v;\n");
    replaceConfig(dir, baseCfg());

    const res = await runCliAgainstFixture(dir, ["safety", "--json"]);
    const body = JSON.parse(res.stdout);
    assert.equal(body.machineVerdict, "REVIEW_REQUIRED");
    assert.notEqual(body.machineVerdict, "PASS");
    assert.equal(body.eligibility.liveEligible, false);
    assert.equal(body.hardStop, false);
    const nonliteral = body.findings.filter((f) => f.code === "ELIGIBILITY_NONLITERAL");
    assert.equal(nonliteral.length > 0, true);
    assert.equal(nonliteral[0].severity, "MEDIUM");
    assert.notEqual(res.code, 0);
  } finally {
    rmrf(dir);
  }
});

test("A3R1-H3 require(variable) REVIEW_REQUIRED", () => {
  const dir = makeFixtureRepo();
  try {
    writeScanFile(dir, "lib", "dynvar.js", 'const x = "./mod";\nrequire(x);\n');
    const scanned = scanSafety(dir, ["lib"]);
    assert.equal(scanned.status, "REVIEW_REQUIRED");
    assert.equal(hasFinding(scanned, "SAFETY_DYNAMIC_REQUIRE"), true);
  } finally {
    rmrf(dir);
  }
});

test("A3R1-H3 import(variable) REVIEW_REQUIRED", () => {
  const dir = makeFixtureRepo();
  try {
    writeScanFile(dir, "lib", "dynimport.js", 'const x = "./mod";\nimport(x);\n');
    const scanned = scanSafety(dir, ["lib"]);
    assert.equal(scanned.status, "REVIEW_REQUIRED");
    assert.equal(hasFinding(scanned, "SAFETY_DYNAMIC_REQUIRE"), true);
  } finally {
    rmrf(dir);
  }
});

test("A3R1-H3 createRequire REVIEW_REQUIRED", () => {
  const dir = makeFixtureRepo();
  try {
    writeScanFile(
      dir,
      "lib",
      "createreq.js",
      'const mod = require("node:module");\nconst r = mod.createRequire("./x");\nmodule.exports = r;\n'
    );
    const scanned = scanSafety(dir, ["lib"]);
    assert.equal(scanned.status, "REVIEW_REQUIRED");
    assert.equal(hasFinding(scanned, "SAFETY_DYNAMIC_REQUIRE"), true);
  } finally {
    rmrf(dir);
  }
});

test("A3R1-H3 static kb/broker require FAIL", () => {
  const dir = makeFixtureRepo();
  try {
    writeScanFile(dir, "lib", "broker.js", 'const b = require("../kb/broker");\nmodule.exports = b;\n');
    const scanned = scanSafety(dir, ["lib"]);
    assert.equal(scanned.status, "FAIL");
    assert.equal(hasFinding(scanned, "GATE_RUNNER_SAFETY_FAILED"), true);
  } finally {
    rmrf(dir);
  }
});

test("A3R1-H3 static placeOrder call FAIL", () => {
  const dir = makeFixtureRepo();
  try {
    writeScanFile(dir, "lib", "order.js", "const client = {};\nclient.placeOrder(1);\n");
    const scanned = scanSafety(dir, ["lib"]);
    assert.equal(scanned.status, "FAIL");
    assert.equal(hasFinding(scanned, "GATE_RUNNER_SAFETY_FAILED"), true);
  } finally {
    rmrf(dir);
  }
});

test("A3R1-H3 string-only forbidden name not FAIL", () => {
  const dir = makeFixtureRepo();
  try {
    writeScanFile(dir, "lib", "stringonly.js", 'const s = "placeOrder";\nmodule.exports = s;\n');
    const scanned = scanSafety(dir, ["lib"]);
    assert.notEqual(scanned.status, "FAIL");
    assert.equal(hasFinding(scanned, "SAFETY_COMMENT_OR_STRING_MENTION"), true);
    assert.equal(hasFinding(scanned, "GATE_RUNNER_SAFETY_FAILED"), false);
  } finally {
    rmrf(dir);
  }
});

test("A3R1-H3 unparsable source REVIEW_REQUIRED", () => {
  const dir = makeFixtureRepo();
  try {
    writeScanFile(dir, "lib", "broken.js", "/* unterminated\nmodule.exports = 1;\n");
    const scanned = scanSafety(dir, ["lib"]);
    assert.equal(scanned.status, "REVIEW_REQUIRED");
    assert.equal(hasFinding(scanned, "SAFETY_PARSE_FAILED"), true);
  } finally {
    rmrf(dir);
  }
});

test("A3R1-H4 bracket paperEligible true BLOCKER", () => {
  const dir = makeFixtureRepo();
  try {
    writeScanFile(dir, "lib", "paper.js", 'const o = {};\no["paperEligible"] = true;\n');
    const result = scanEligibility(dir, baseCfg());
    assert.equal(result.paperEligible, true);
    assert.equal(hasFinding(result, "ELIGIBILITY_PAPER_TRUE"), true);
    assert.equal(hasSeverity(result, "BLOCKER"), true);
    assert.equal(result.hardStop, false);
  } finally {
    rmrf(dir);
  }
});

test("A3R1-H4 computed obj[key] = true REVIEW_REQUIRED", () => {
  const dir = makeFixtureRepo();
  try {
    writeScanFile(
      dir,
      "lib",
      "computed.js",
      'const key = "liveEligible";\nconst o = {};\no[key] = true;\nmodule.exports = o;\n'
    );
    const result = scanEligibility(dir, baseCfg());
    assert.equal(hasFinding(result, "ELIGIBILITY_COMPUTED"), true);
    assert.equal(hasSeverity(result, "BLOCKER"), false);
    assert.equal(result.liveEligible, false);
    assert.equal(result.hardStop, false);
  } finally {
    rmrf(dir);
  }
});

test("A3R1-H4 fixture paperEligible outside scanRoots not production blocker", () => {
  const dir = makeFixtureRepo();
  try {
    writeScanFile(dir, "lib", "ok.js", "module.exports = { note: 1 };\n");
    writeScanFile(dir, "test", "fixture.js", "module.exports = { paperEligible: true };\n");
    const result = scanEligibility(dir, baseCfg());
    assert.equal(result.paperEligible, false);
    assert.equal(result.liveEligible, false);
    assert.equal(hasSeverity(result, "BLOCKER"), false);
    assert.equal(result.findings.length, 0);
  } finally {
    rmrf(dir);
  }
});

test("A3R1-H4 eligibility parse failure REVIEW_REQUIRED", () => {
  const dir = makeFixtureRepo();
  try {
    writeScanFile(dir, "lib", "broken.js", "/* unterminated\nmodule.exports = {};\n");
    const result = scanEligibility(dir, baseCfg());
    assert.equal(hasFinding(result, "ELIGIBILITY_PARSE_FAILED"), true);
    assert.equal(hasSeverity(result, "BLOCKER"), false);
    assert.equal(result.hardStop, false);
  } finally {
    rmrf(dir);
  }
});

test("A51 git env scrub", () => {
  const prev = {
    GIT_DIR: process.env.GIT_DIR,
    GIT_WORK_TREE: process.env.GIT_WORK_TREE,
    GIT_INDEX_FILE: process.env.GIT_INDEX_FILE,
    GIT_OBJECT_DIRECTORY: process.env.GIT_OBJECT_DIRECTORY,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES,
  };
  process.env.GIT_DIR = "/tmp/evil.git";
  process.env.GIT_WORK_TREE = "/tmp";
  process.env.GIT_INDEX_FILE = "/tmp/index";
  process.env.GIT_OBJECT_DIRECTORY = "/tmp/objects";
  process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES = "/tmp/alt";
  try {
    const env = buildGitEnv();
    assert.equal(env.GIT_DIR, undefined);
    assert.equal(env.GIT_WORK_TREE, undefined);
    assert.equal(env.GIT_INDEX_FILE, undefined);
    assert.equal(env.GIT_OBJECT_DIRECTORY, undefined);
    assert.equal(env.GIT_ALTERNATE_OBJECT_DIRECTORIES, undefined);
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
