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
  replaceState,
  rmrf,
} = require("./gate-runner-helpers.test.js");
const { writeReportPair, parseIngestedReport, resolveNextGate } = require("../tools/gate-runner/report");
const { loadConfigState } = require("../tools/gate-runner/commands");
const { GateRunnerError } = require("../tools/gate-runner/errors");

function reportCfg(extra) {
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

function ingestableMarkdown() {
  return (
    [
      "GATE: PASS",
      "FULL_REGRESSION: 1 / 1",
      "BLOCKER: 0",
      "HIGH: 0",
      "HEAD: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ].join("\n") + "\n"
  );
}

function listIngestEvidence(repoRoot) {
  const root = path.join(repoRoot, ".gates", "evidence");
  const found = [];
  if (!fs.existsSync(root)) return found;
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.startsWith("ingest-")) found.push(p);
    }
  };
  walk(root);
  return found;
}

test("A17 report JSON/Markdown consistent", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    const { state } = loadConfigState(dir);
    const written = writeReportPair(
      dir,
      {
        track: "AUTOMATION",
        gateId: "GATE-A2",
        head: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        branch: "main",
        machineVerdict: "PASS",
        findings: [],
      },
      state
    );
    const json = JSON.parse(fs.readFileSync(written.jsonPath, "utf8"));
    const md = fs.readFileSync(written.mdPath, "utf8");
    assert.equal(json.digest, written.report.digest);
    assert.match(md, new RegExp("DIGEST: " + json.digest));
    assert.match(md, /MACHINE_VERDICT: PASS/);
    assert.match(md, /GATE: PASS/);
    assert.equal(json.reviewVerdict, "PENDING");
    assert.equal(json.finalVerdict, "PENDING");
  } finally {
    rmrf(dir);
  }
});

test("A18 report existing finalized not overwritten", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    const { state } = loadConfigState(dir);
    const payload = {
      track: "AUTOMATION",
      gateId: "GATE-A2",
      attempt: 1,
      machineVerdict: "PASS",
      findings: [],
    };
    writeReportPair(dir, payload, state);
    assert.throws(
      () => writeReportPair(dir, payload, state),
      (err) => err instanceof GateRunnerError && err.code === "GATE_RUNNER_REPORT_EXISTS"
    );
  } finally {
    rmrf(dir);
  }
});

test("A35 Markdown parser PASS fields extracted", () => {
  const md = [
    "GATE-A1: PASS",
    "FULL_REGRESSION: 10 / 10",
    "BLOCKER: 0",
    "HIGH: 0",
    "HEAD: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  ].join("\n");
  const parsed = parseIngestedReport(md);
  assert.equal(parsed.gate, "PASS");
  assert.equal(parsed.fullRegression, "10 / 10");
  assert.equal(parsed.blocker, 0);
  assert.equal(parsed.high, 0);
  assert.equal(parsed.head, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
});

test("A36 malformed report stays UNKNOWN/FAIL-safe", () => {
  const parsed = parseIngestedReport("The gate looks like a PASS because we tried hard.\nLooks good.");
  assert.equal(parsed.gate, "UNKNOWN");
  assert.equal(parsed.fullRegression, "UNKNOWN");
  assert.equal(parsed.head, "UNKNOWN");
});

test("A37 next explicit nextGate respected", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    replaceState(dir, (st) => {
      st.tracks.AUTOMATION.nextGate = "GATE-X9";
    });
    const res = await runCliAgainstFixture(dir, ["next", "--json"]);
    const body = JSON.parse(res.stdout);
    assert.equal(body.nextGate, "GATE-X9");
    assert.equal(res.code, 0);
  } finally {
    rmrf(dir);
  }
});

test("A38 missing nextGate does not invent complex revision ID", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    replaceState(dir, (st) => {
      st.tracks.AUTOMATION.nextGate = null;
    });
    const res = await runCliAgainstFixture(dir, ["next", "--json"]);
    assert.notEqual(res.code, 0);
    const body = JSON.parse(res.stdout);
    assert.equal(body.nextGate, null);
    assert.equal(res.stdout.includes("GATE-A3"), false);
    assert.equal(res.stdout.includes("11O"), false);
    assert.equal(res.stdout.includes("R1"), false);
  } finally {
    rmrf(dir);
  }
});

test("A39 TRADING/AUTOMATION tracks coexist", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    const st = await runCliAgainstFixture(dir, ["status", "--json"]);
    const body = JSON.parse(st.stdout);
    assert.ok(body.tracks.TRADING);
    assert.ok(body.tracks.AUTOMATION);
    assert.equal(body.tracks.AUTOMATION.currentGate, "GATE-A2");
    assert.equal(body.tracks.TRADING.currentGate, null);
  } finally {
    rmrf(dir);
  }
});

test("A41 absolute path ingest rejected", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    const res = await runCliAgainstFixture(dir, ["ingest", "/tmp/report.md"]);
    assert.equal(res.code, 2);
  } finally {
    rmrf(dir);
  }
});

test("A48 REVIEW_REQUIRED exit !== 0", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    replaceState(dir, (st) => {
      st.tracks.AUTOMATION.phase = "CONTRACT";
    });
    replaceConfig(dir, reportCfg());
    fs.writeFileSync(path.join(dir, "README.md"), "dirty\n");
    const res = await runCliAgainstFixture(dir, ["inspect", "--json"]);
    assert.notEqual(res.code, 0);
    const body = JSON.parse(res.stdout);
    assert.equal(body.machineVerdict, "REVIEW_REQUIRED");
  } finally {
    rmrf(dir);
  }
});

test("C10 notes.md symlink to .env ingest rejected", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    fs.writeFileSync(path.join(dir, ".env"), "DUMMY_TOKEN=dummy-value\n");
    fs.symlinkSync(path.join(dir, ".env"), path.join(dir, "notes.md"));
    const res = await runCliAgainstFixture(dir, ["ingest", "notes.md"]);
    assert.equal(res.code, 2);
    assert.match(res.stderr, /denied|symlink|SECRET/i);
    assert.equal(listIngestEvidence(dir).length, 0);
  } finally {
    rmrf(dir);
  }
});

test("C11 gitignored ingest file rejected", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    fs.writeFileSync(path.join(dir, ".gitignore"), "ignored-notes.md\n");
    fs.writeFileSync(path.join(dir, "ignored-notes.md"), ingestableMarkdown());
    const res = await runCliAgainstFixture(dir, ["ingest", "ignored-notes.md"]);
    assert.equal(res.code, 2);
    assert.match(res.stderr, /gitignored|denied/i);
    assert.equal(listIngestEvidence(dir).length, 0);
  } finally {
    rmrf(dir);
  }
});

test("C12 rejected ingest produces no evidence copy", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    fs.writeFileSync(path.join(dir, ".env"), "DUMMY_TOKEN=dummy-value\n");
    fs.writeFileSync(path.join(dir, "deploy.pem"), ingestableMarkdown());
    for (const target of [".env", "deploy.pem"]) {
      const res = await runCliAgainstFixture(dir, ["ingest", target]);
      assert.equal(res.code, 2, target);
      assert.equal(listIngestEvidence(dir).length, 0, target);
    }
  } finally {
    rmrf(dir);
  }
});

test("A3R1-H5 normal notes.md ingest PASS", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    fs.writeFileSync(path.join(dir, "notes.md"), ingestableMarkdown());
    const res = await runCliAgainstFixture(dir, ["ingest", "notes.md", "--json"]);
    assert.equal(res.code, 0);
    const body = JSON.parse(res.stdout);
    assert.equal(body.machineVerdict, "PASS");
    assert.equal(body.parsed.gate, "PASS");
    const evidence = listIngestEvidence(dir);
    assert.equal(evidence.length, 1);
    assert.equal(path.basename(evidence[0]), "ingest-notes.md");
  } finally {
    rmrf(dir);
  }
});

test("A3R1-H5 parent traversal ingest rejected", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    const res = await runCliAgainstFixture(dir, ["ingest", "../notes.md"]);
    assert.equal(res.code, 2);
    assert.equal(listIngestEvidence(dir).length, 0);
  } finally {
    rmrf(dir);
  }
});

test("A3R1-H5 symlink to outside repo ingest rejected", async () => {
  const dir = makeFixtureRepo();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-runner-outside-"));
  try {
    await runCliAgainstFixture(dir, ["init"]);
    const outside = path.join(outsideDir, "outside.md");
    fs.writeFileSync(outside, ingestableMarkdown());
    fs.symlinkSync(outside, path.join(dir, "notes.md"));
    const res = await runCliAgainstFixture(dir, ["ingest", "notes.md"]);
    assert.equal(res.code, 2);
    assert.equal(listIngestEvidence(dir).length, 0);
  } finally {
    rmrf(outsideDir);
    rmrf(dir);
  }
});

test("A3R1-H5 secret-like ingest names rejected", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    const names = [
      "secret-report.md",
      "token-report.md",
      "credential-report.md",
      "deploy.pem",
      "signing.key",
    ];
    for (const name of names) {
      fs.writeFileSync(path.join(dir, name), ingestableMarkdown());
      const res = await runCliAgainstFixture(dir, ["ingest", name]);
      assert.equal(res.code, 2, name);
      assert.match(res.stderr, /denied/i, name);
    }
    assert.equal(listIngestEvidence(dir).length, 0);
  } finally {
    rmrf(dir);
  }
});

test("A3R1-H5 oversize ingest rejected by ingestMaxBytes", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    replaceConfig(dir, reportCfg({ ingestMaxBytes: 64 }));
    const body = ingestableMarkdown();
    assert.equal(Buffer.byteLength(body, "utf8") > 64, true);
    fs.writeFileSync(path.join(dir, "notes.md"), body);
    const res = await runCliAgainstFixture(dir, ["ingest", "notes.md"]);
    assert.equal(res.code, 2);
    assert.match(res.stderr, /ingestMaxBytes|denied/i);
    assert.equal(listIngestEvidence(dir).length, 0);
  } finally {
    rmrf(dir);
  }
});

test("R2-C02 writeReportPair gateId ../../../lib/paper/pwn rejected INVALID_ARGUMENT", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    const { state } = loadConfigState(dir);
    assert.throws(
      () =>
        writeReportPair(
          dir,
          {
            track: "AUTOMATION",
            gateId: "../../../lib/paper/pwn",
            machineVerdict: "PASS",
            findings: [],
          },
          state
        ),
      (err) => err instanceof GateRunnerError && err.code === "GATE_RUNNER_INVALID_ARGUMENT"
    );
  } finally {
    rmrf(dir);
  }
});

test("R2-C13 writeReportPair malicious gateId: lib/paper/pwn DOES_NOT_EXIST", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    const { state } = loadConfigState(dir);
    assert.throws(
      () =>
        writeReportPair(
          dir,
          {
            track: "AUTOMATION",
            gateId: "../../../lib/paper/pwn",
            machineVerdict: "PASS",
            findings: [],
          },
          state
        ),
      (err) => err instanceof GateRunnerError
    );
    assert.equal(fs.existsSync(path.join(dir, "lib", "paper", "pwn")), false);
    assert.equal(fs.existsSync(path.join(dir, "lib", "paper")), false);
  } finally {
    rmrf(dir);
  }
});

test("R2-C14 ingest markdown GATE: ../../../lib/paper/pwn creates NO outside directory", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    fs.writeFileSync(path.join(dir, "notes.md"), "GATE: ../../../lib/paper/pwn\n");
    const res = await runCliAgainstFixture(dir, ["ingest", "notes.md", "--json"]);
    assert.ok(res.code === 0 || res.code === 1 || res.code === 2);
    if (res.stdout) {
      const body = JSON.parse(res.stdout);
      assert.ok(
        body.machineVerdict === "REVIEW_REQUIRED" ||
          body.machineVerdict === "UNKNOWN" ||
          (body.parsed && (body.parsed.gate === "UNKNOWN" || body.parsed.gate === "REVIEW_REQUIRED"))
      );
    }
    assert.equal(fs.existsSync(path.join(dir, "lib", "paper", "pwn")), false);
    assert.equal(fs.existsSync(path.join(dir, "lib", "paper")), false);
  } finally {
    rmrf(dir);
  }
});

test("R2-C15 replace .gates/reports with symlink to outside → PATH_ESCAPE", async () => {
  const dir = makeFixtureRepo();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "gate-r2-c15-"));
  try {
    await runCliAgainstFixture(dir, ["init"]);
    const reportsPath = path.join(dir, ".gates", "reports");
    fs.rmSync(reportsPath, { recursive: true, force: true });
    fs.symlinkSync(outside, reportsPath);
    const { state } = loadConfigState(dir);
    assert.throws(
      () =>
        writeReportPair(
          dir,
          {
            track: "AUTOMATION",
            gateId: "GATE-A2",
            machineVerdict: "PASS",
            findings: [],
          },
          state
        ),
      (err) => err instanceof GateRunnerError && err.code === "GATE_RUNNER_PATH_ESCAPE"
    );
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally {
    rmrf(outside);
    rmrf(dir);
  }
});

test("R2-C16 track ../../../x to writeReportPair rejected", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    const { state } = loadConfigState(dir);
    assert.throws(
      () =>
        writeReportPair(
          dir,
          {
            track: "../../../x",
            gateId: "GATE-A2",
            machineVerdict: "PASS",
            findings: [],
          },
          state
        ),
      (err) => err instanceof GateRunnerError && err.code === "GATE_RUNNER_INVALID_ARGUMENT"
    );
  } finally {
    rmrf(dir);
  }
});

test("R2-C18 valid GATE-A3-R2 report creates directory only under .gates/reports/AUTOMATION/GATE-A3-R2", async () => {
  const dir = makeFixtureRepo();
  try {
    await runCliAgainstFixture(dir, ["init"]);
    const { state } = loadConfigState(dir);
    const written = writeReportPair(
      dir,
      {
        track: "AUTOMATION",
        gateId: "GATE-A3-R2",
        machineVerdict: "PASS",
        findings: [],
      },
      state
    );
    const gatesReal = fs.realpathSync(path.join(dir, ".gates"));
    const expected = path.join(gatesReal, "reports", "AUTOMATION", "GATE-A3-R2");
    assert.equal(fs.existsSync(expected), true);
    assert.equal(fs.statSync(expected).isDirectory(), true);
    assert.ok(written.jsonPath.startsWith(expected + path.sep));
    assert.ok(written.mdPath.startsWith(expected + path.sep));
    assert.ok(fs.readdirSync(expected).some((n) => n.startsWith("attempt-")));
    assert.equal(fs.existsSync(path.join(dir, "lib", "paper", "pwn")), false);
    const reportsRoot = path.join(gatesReal, "reports");
    const walk = (d, acc) => {
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, ent.name);
        if (ent.isDirectory()) walk(p, acc);
        else acc.push(p);
      }
      return acc;
    };
    const files = walk(reportsRoot, []);
    for (const f of files) {
      assert.equal(fs.realpathSync(f).startsWith(expected + path.sep), true);
    }
  } finally {
    rmrf(dir);
  }
});
