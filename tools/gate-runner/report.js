"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { fail } = require("./errors");
const { parseJsonSafe, stableStringify } = require("./json-safe");
const {
  assertSafeRepoRelPattern,
  assertContained,
  realpathOrEscape,
  atomicWriteFile,
  ensureContainedDirectory,
} = require("./fs-safe");
const { validateGateId, validateTrackName } = require("./schema");
const { redactSecrets } = require("./redaction");

function computeMachineVerdict(findings) {
  const list = Array.isArray(findings) ? findings : [];
  if (list.some((f) => f && (f.hardStop || f.code === "GATE_RUNNER_HARD_STOP"))) {
    return "HARD_STOP";
  }
  const sevs = new Set(list.map((f) => f && f.severity).filter(Boolean));
  if (sevs.has("BLOCKER") || sevs.has("HIGH")) return "FAIL";
  if (sevs.has("MEDIUM")) return "REVIEW_REQUIRED";
  if (sevs.has("LOW")) return "PASS_WITH_NOTES";
  return "PASS";
}

function nextAttemptNumber(state, reportsDir) {
  let diskMax = 0;
  if (reportsDir && fs.existsSync(reportsDir)) {
    let names = [];
    try {
      names = fs.readdirSync(reportsDir);
    } catch {
      names = [];
    }
    for (const name of names) {
      const m = String(name).match(/^attempt-(\d+)\.(json|md)$/);
      if (m) diskMax = Math.max(diskMax, Number(m[1]));
    }
  }
  const stateAttempt = state && state.lastRun && Number.isInteger(state.lastRun.attempt)
    ? state.lastRun.attempt
    : 0;
  return Math.max(stateAttempt, diskMax) + 1;
}

function attachDigest(obj) {
  const copy = Object.assign({}, obj);
  delete copy.digest;
  const normalized = stableStringify(copy);
  const digest = crypto.createHash("sha256").update(normalized).digest("hex");
  copy.digest = digest;
  return copy;
}

function renderMarkdown(report) {
  const lines = [];
  const mv = report.machineVerdict || "UNKNOWN";
  const gatePass = mv === "PASS" || mv === "PASS_WITH_NOTES" ? "PASS" : mv === "FAIL" || mv === "HARD_STOP" ? "FAIL" : "FAIL";
  lines.push("# Gate Runner Report");
  lines.push(`GATE: ${gatePass}`);
  lines.push(`GATE_ID: ${report.gateId || ""}`);
  lines.push(`TRACK: ${report.track || ""}`);
  lines.push(`HEAD: ${report.head || ""}`);
  lines.push(`BRANCH: ${report.branch || ""}`);
  lines.push(`ATTEMPT: ${String(report.attempt).padStart(2, "0")}`);
  lines.push(`MACHINE_VERDICT: ${mv}`);
  lines.push(`REVIEW_VERDICT: ${report.reviewVerdict || "PENDING"}`);
  lines.push(`FINAL_VERDICT: ${report.finalVerdict || "PENDING"}`);
  const tests = report.tests || {};
  const total = tests.tests == null ? "UNKNOWN" : tests.tests;
  const pass = tests.pass == null ? "UNKNOWN" : tests.pass;
  lines.push(`FULL_REGRESSION: ${pass} / ${total}`);
  const findings = Array.isArray(report.findings) ? report.findings : [];
  const blocker = findings.filter((f) => f && f.severity === "BLOCKER").length;
  const high = findings.filter((f) => f && f.severity === "HIGH").length;
  lines.push(`BLOCKER: ${blocker}`);
  lines.push(`HIGH: ${high}`);
  lines.push(`DIGEST: ${report.digest || ""}`);
  lines.push("");
  lines.push("## Findings");
  if (findings.length === 0) {
    lines.push("(none)");
  } else {
    for (const f of findings) {
      lines.push(`- ${f.severity} ${f.code}: ${f.message || ""}`);
    }
  }
  return lines.join("\n") + "\n";
}

function writeReportPair(repoRoot, reportInput, state) {
  const track = validateTrackName(reportInput.track || "AUTOMATION", "GATE_RUNNER_INVALID_ARGUMENT");
  const rawGate = reportInput.gateId == null || reportInput.gateId === "" ? "UNSET" : reportInput.gateId;
  const gateId = validateGateId(rawGate, "GATE_RUNNER_INVALID_ARGUMENT");
  const reportsDir = ensureContainedDirectory(repoRoot, ["reports", track, gateId]);
  const attempt = reportInput.attempt || nextAttemptNumber(state, reportsDir);
  const padded = String(attempt).padStart(2, "0");
  const jsonPath = path.join(reportsDir, `attempt-${padded}.json`);
  const mdPath = path.join(reportsDir, `attempt-${padded}.md`);
  if (fs.existsSync(jsonPath) || fs.existsSync(mdPath)) {
    fail("GATE_RUNNER_REPORT_EXISTS", `report already exists for attempt ${padded}`);
  }
  const machineVerdict = reportInput.machineVerdict || computeMachineVerdict(reportInput.findings || []);
  const body = attachDigest({
    track,
    gateId,
    attempt,
    head: reportInput.head || null,
    branch: reportInput.branch || null,
    machineVerdict,
    reviewVerdict: "PENDING",
    finalVerdict: "PENDING",
    findings: reportInput.findings || [],
    git: reportInput.git || null,
    p50: reportInput.p50 || null,
    safety: reportInput.safety || null,
    eligibility: reportInput.eligibility || null,
    tests: reportInput.tests || null,
  });
  const jsonText = stableStringify(body) + "\n";
  const mdText = renderMarkdown(body);
  atomicWriteFile(repoRoot, jsonPath, jsonText);
  atomicWriteFile(repoRoot, mdPath, mdText);
  return { report: body, jsonPath, mdPath, attempt };
}

function ingestDenied(rel) {
  const n = String(rel).replace(/\\/g, "/").toLowerCase();
  const parts = n.split("/");
  if (parts.some((p) => p.startsWith(".env"))) return true;
  if (n === ".git" || n.startsWith(".git/") || parts.includes(".git")) return true;
  if (n.includes("secret") || n.includes("token") || n.includes("credential")) return true;
  if (/\.(p8|p12|pem|key)$/.test(n)) return true;
  if (parts.includes("serviceaccountkey.json") || n.endsWith("serviceaccountkey.json")) return true;
  if (n.endsWith("google-services.json")) return true;
  if (n.endsWith("googleservice-info.plist")) return true;
  if (n.includes("firebaseconfig")) return true;
  if (n === "docs/kb" || n.startsWith("docs/kb/")) return true;
  return false;
}

const GLOB_REGEX_SPECIAL = new Set(["\\", "^", "$", ".", "|", "+", "(", ")", "[", "]", "{", "}"]);

function globToRegExpSource(pattern) {
  let src = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        src += ".*";
        i += 1;
      } else {
        src += "[^/]*";
      }
    } else if (ch === "?") {
      src += "[^/]";
    } else if (GLOB_REGEX_SPECIAL.has(ch)) {
      src += "\\" + ch;
    } else {
      src += ch;
    }
  }
  return src;
}

function parseGitignore(text) {
  const rules = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    let line = rawLine.replace(/\s+$/, "");
    if (line === "" || line.startsWith("#")) continue;
    let negate = false;
    if (line.startsWith("!")) {
      negate = true;
      line = line.slice(1);
    }
    let dirOnly = false;
    if (line.endsWith("/")) {
      dirOnly = true;
      line = line.replace(/\/+$/, "");
    }
    let anchored = false;
    if (line.startsWith("/")) {
      anchored = true;
      line = line.replace(/^\/+/, "");
    } else if (line.includes("/")) {
      anchored = true;
    }
    if (line === "") continue;
    rules.push({
      negate,
      dirOnly,
      anchored,
      re: new RegExp("^" + globToRegExpSource(line) + "$"),
    });
  }
  return rules;
}

function gitignoreRuleMatches(rule, segments) {
  const last = segments.length - 1;
  const startMax = rule.anchored ? 0 : last;
  for (let i = 0; i <= startMax; i += 1) {
    for (let j = i; j <= last; j += 1) {
      // A directory-only pattern never matches the file itself, but matching an
      // ancestor directory still ignores everything beneath it.
      if (rule.dirOnly && j === last) continue;
      if (rule.re.test(segments.slice(i, j + 1).join("/"))) return true;
    }
  }
  return false;
}

function readGitignoreRules(rootReal, dirRelPosix) {
  const dirAbs = dirRelPosix === "" ? rootReal : path.join(rootReal, dirRelPosix);
  const file = path.join(dirAbs, ".gitignore");
  let lst;
  try {
    lst = fs.lstatSync(file);
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    fail("GATE_RUNNER_SECRET_INGEST_DENIED", "gitignore unreadable, ingest denied");
  }
  if (lst.isSymbolicLink() || !lst.isFile()) {
    fail("GATE_RUNNER_SECRET_INGEST_DENIED", "gitignore unreadable, ingest denied");
  }
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    fail("GATE_RUNNER_SECRET_INGEST_DENIED", "gitignore unreadable, ingest denied");
  }
  return parseGitignore(text);
}

function isGitIgnored(repoRoot, relPosix) {
  const rootReal = realpathOrEscape(repoRoot, "repoRoot");
  const rel = String(relPosix == null ? "" : relPosix).replace(/\\/g, "/");
  const segments = rel.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.length === 0) return false;
  let ignored = false;
  for (let depth = 0; depth < segments.length; depth += 1) {
    const rules = readGitignoreRules(rootReal, segments.slice(0, depth).join("/"));
    if (rules.length === 0) continue;
    const sub = segments.slice(depth);
    for (const rule of rules) {
      if (gitignoreRuleMatches(rule, sub)) ignored = !rule.negate;
    }
  }
  return ignored;
}

function parseIngestedReport(text) {
  const src = String(text || "");
  const result = {
    gate: "UNKNOWN",
    fullRegression: "UNKNOWN",
    blocker: "UNKNOWN",
    high: "UNKNOWN",
    head: "UNKNOWN",
  };
  const gateM = src.match(/^GATE(?:[^\n:]*)?:\s*(PASS|FAIL)\s*$/im);
  if (gateM) result.gate = gateM[1].toUpperCase();
  const regM = src.match(/FULL_REGRESSION[:\s]+(\d+)\s*\/\s*(\d+)/i);
  if (regM) result.fullRegression = `${regM[1]} / ${regM[2]}`;
  const blk = src.match(/^BLOCKER:\s*(\d+)\s*$/im);
  if (blk) result.blocker = Number(blk[1]);
  const hi = src.match(/^HIGH:\s*(\d+)\s*$/im);
  if (hi) result.high = Number(hi[1]);
  const head = src.match(/^HEAD:\s*([0-9a-f]{40})\s*$/im);
  if (head) result.head = head[1];
  return result;
}

function ingestFile(repoRoot, userPath, ctx) {
  if (typeof userPath !== "string" || userPath.length === 0) {
    fail("GATE_RUNNER_PATH_ESCAPE", "ingest path required");
  }
  const relPosix = assertSafeRepoRelPattern(userPath, "GATE_RUNNER_PATH_ESCAPE");
  const rootReal = realpathOrEscape(repoRoot, "repoRoot");
  const joined = path.join(rootReal, userPath);
  let lst;
  try {
    lst = fs.lstatSync(joined);
  } catch {
    fail("GATE_RUNNER_PATH_ESCAPE", "ingest file not found");
  }
  if (lst.isSymbolicLink()) {
    fail("GATE_RUNNER_SECRET_INGEST_DENIED", "ingest symlink denied");
  }
  if (!lst.isFile()) {
    fail("GATE_RUNNER_SECRET_INGEST_DENIED", "ingest target must be a regular file");
  }
  const real = realpathOrEscape(joined, userPath);
  assertContained(rootReal, real);
  const realRel = path.relative(rootReal, real).replace(/\\/g, "/");
  if (ingestDenied(userPath) || ingestDenied(realRel)) {
    fail("GATE_RUNNER_SECRET_INGEST_DENIED", "ingest path denied");
  }
  if (isGitIgnored(rootReal, realRel)) {
    fail("GATE_RUNNER_SECRET_INGEST_DENIED", "gitignored ingest denied");
  }
  if (relPosix !== realRel && isGitIgnored(rootReal, relPosix)) {
    fail("GATE_RUNNER_SECRET_INGEST_DENIED", "gitignored ingest denied");
  }
  const maxBytes = (ctx && ctx.config && ctx.config.ingestMaxBytes) || 1048576;
  if (lst.size > maxBytes) {
    fail("GATE_RUNNER_SECRET_INGEST_DENIED", "ingest file exceeds ingestMaxBytes");
  }
  const raw = fs.readFileSync(real);
  const text = raw.toString("utf8");
  const parsed = parseIngestedReport(text);
  const redacted = redactSecrets(text);
  const state = ctx && ctx.state;
  const track = validateTrackName("AUTOMATION", "GATE_RUNNER_INVALID_ARGUMENT");
  const rawGate = (state && state.tracks && state.tracks.AUTOMATION && state.tracks.AUTOMATION.currentGate) || "UNSET";
  const gateId = validateGateId(rawGate, "GATE_RUNNER_INVALID_STATE");
  const evidenceDir = ensureContainedDirectory(repoRoot, ["evidence", track, gateId]);
  const base = path.basename(realRel).replace(/[^A-Za-z0-9._-]/g, "_");
  const dest = path.join(evidenceDir, `ingest-${base}`);
  if (fs.existsSync(dest)) {
    fail("GATE_RUNNER_REPORT_EXISTS", "ingest evidence already exists");
  }
  atomicWriteFile(repoRoot, dest, redacted);
  return {
    machineVerdict: parsed.gate === "PASS" ? "PASS" : parsed.gate === "FAIL" ? "FAIL" : "REVIEW_REQUIRED",
    parsed,
    evidencePath: dest,
  };
}

function resolveNextGate(state) {
  const n = state && state.tracks && state.tracks.AUTOMATION && state.tracks.AUTOMATION.nextGate;
  if (typeof n === "string" && n.trim() !== "") {
    return { nextGate: n.trim(), machineVerdict: "PASS" };
  }
  return {
    nextGate: null,
    machineVerdict: "REVIEW_REQUIRED",
    message: "nextGate is not an explicit non-empty string",
  };
}

module.exports = {
  writeReportPair,
  computeMachineVerdict,
  renderMarkdown,
  nextAttemptNumber,
  ingestFile,
  isGitIgnored,
  parseIngestedReport,
  resolveNextGate,
  attachDigest,
};
