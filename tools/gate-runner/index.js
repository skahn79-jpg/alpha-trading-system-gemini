"use strict";

const { fail, isGateRunnerError, exitCodeForVerdict } = require("./errors");
const { stableStringify } = require("./json-safe");
const { redactSecrets } = require("./redaction");
const { dispatch } = require("./commands");
const { buildTestEnv } = require("./test-runner");
const { buildGitEnv, rejectMutationCommand } = require("./git-inspector");

const COMMANDS = new Set(["init", "status", "inspect", "test", "safety", "report", "next", "ingest"]);

function parseArgv(argv) {
  const flags = { json: false, debug: false };
  const positionals = [];
  const list = Array.isArray(argv) ? argv : [];
  for (const raw of list) {
    const a = String(raw);
    if (a === "--json") flags.json = true;
    else if (a === "--debug") flags.debug = true;
    else if (a.startsWith("-")) fail("GATE_RUNNER_INVALID_ARGUMENT", `unknown flag: ${a}`);
    else positionals.push(a);
  }
  if (positionals.length === 0) {
    fail("GATE_RUNNER_INVALID_ARGUMENT", "command required");
  }
  const command = positionals[0];
  if (!COMMANDS.has(command)) {
    fail("GATE_RUNNER_INVALID_ARGUMENT", `unknown command: ${command}`);
  }
  if (command === "ingest") {
    if (positionals.length !== 2) {
      fail("GATE_RUNNER_INVALID_ARGUMENT", "ingest requires exactly one repository-relative file");
    }
    return { command, flags, ingestPath: positionals[1] };
  }
  if (positionals.length !== 1) {
    fail("GATE_RUNNER_INVALID_ARGUMENT", "unexpected extra arguments");
  }
  return { command, flags, ingestPath: null };
}

function humanize(command, result) {
  const lines = [];
  lines.push(`command: ${command}`);
  if (result && result.machineVerdict) lines.push(`machineVerdict: ${result.machineVerdict}`);
  if (result && result.git) {
    lines.push(`branch: ${result.git.branch}`);
    lines.push(`HEAD: ${result.git.head}`);
  }
  if (result && result.nextGate !== undefined) lines.push(`nextGate: ${result.nextGate == null ? "" : result.nextGate}`);
  if (result && Array.isArray(result.findings) && result.findings.length) {
    lines.push(`findings: ${result.findings.length}`);
  }
  return lines.join("\n") + "\n";
}

async function runCli({ argv, repoRootHint, execPath, stdout, stderr }) {
  const outStream = stdout || process.stdout;
  const errStream = stderr || process.stderr;
  const writeOut = (text) => {
    outStream.write(String(text));
  };
  const writeErr = (text) => {
    errStream.write(redactSecrets(String(text)));
  };
  let debug = false;
  try {
    const parsed = parseArgv(argv);
    debug = parsed.flags.debug;
    if (!repoRootHint) fail("GATE_RUNNER_INVALID_ARGUMENT", "repoRootHint required");
    const result = await dispatch(parsed.command, {
      repoRoot: repoRootHint,
      execPath: execPath || process.execPath,
      ingestPath: parsed.ingestPath,
    });
    const payload = result && typeof result === "object" ? result : { machineVerdict: "PASS" };
    if (parsed.flags.json) {
      writeOut(stableStringify(payload) + "\n");
    } else {
      writeOut(humanize(parsed.command, payload));
    }
    const verdict = payload.machineVerdict || "PASS";
    return exitCodeForVerdict(verdict);
  } catch (err) {
    if (isGateRunnerError(err)) {
      if (debug) writeErr((err.stack || err.message) + "\n");
      else writeErr((err.message || err.code) + "\n");
      return err.exitCode;
    }
    writeErr(String(err && err.message ? err.message : err) + "\n");
    return 3;
  }
}

module.exports = {
  runCli,
  parseArgv,
  buildTestEnv,
  buildGitEnv,
  rejectMutationCommand,
  errors: require("./errors"),
  schema: require("./schema"),
  jsonSafe: require("./json-safe"),
  fsSafe: require("./fs-safe"),
  gitInspector: require("./git-inspector"),
  redaction: require("./redaction"),
  policy: require("./policy"),
  p50: require("./p50"),
  safetyScanner: require("./safety-scanner"),
  eligibility: require("./eligibility"),
  testRunner: require("./test-runner"),
  report: require("./report"),
  commands: require("./commands"),
};
