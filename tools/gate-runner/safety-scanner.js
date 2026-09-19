"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { collectContainedCodeFiles } = require("./fs-safe");

const CODE_EXTS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts"]);

const FORBIDDEN_SPECS = new Set([
  "kb/broker",
  "axios",
  "http",
  "https",
  "node:http",
  "node:https",
  "node:http2",
  "node:net",
  "undici",
]);

const FORBIDDEN_IDS = new Set([
  "placeOrder",
  "amendOrder",
  "cancelOrder",
  "LiveBroker",
]);

function buildMask(source) {
  const mask = Buffer.alloc(source.length, 99);
  let i = 0;
  const s = source;
  let parseOk = true;
  function fill(from, to, ch) {
    for (let k = from; k < to && k < mask.length; k++) mask[k] = ch;
  }
  while (i < s.length) {
    const c = s[i];
    const n = s[i + 1];
    if (c === "/" && n === "/") {
      const end = s.indexOf("\n", i);
      const to = end === -1 ? s.length : end + 1;
      fill(i, to, 47);
      i = to;
      continue;
    }
    if (c === "/" && n === "*") {
      const end = s.indexOf("*/", i + 2);
      if (end === -1) {
        fill(i, s.length, 47);
        parseOk = false;
        break;
      }
      fill(i, end + 2, 47);
      i = end + 2;
      continue;
    }
    if (c === "'" || c === '"') {
      const start = i;
      i += 1;
      let closed = false;
      while (i < s.length) {
        if (s[i] === "\\") {
          i += 2;
          continue;
        }
        if (s[i] === c) {
          i += 1;
          closed = true;
          break;
        }
        if (s[i] === "\n" && c !== "`") break;
        i += 1;
      }
      fill(start, i, 115);
      if (!closed) parseOk = false;
      continue;
    }
    if (c === "`") {
      const start = i;
      i += 1;
      let closed = false;
      while (i < s.length) {
        if (s[i] === "\\") {
          i += 2;
          continue;
        }
        if (s[i] === "`") {
          i += 1;
          closed = true;
          break;
        }
        i += 1;
      }
      fill(start, i, 115);
      if (!closed) parseOk = false;
      continue;
    }
    mask[i] = 99;
    i += 1;
  }
  return { mask, parseOk };
}

function kindAt(mask, index) {
  const k = mask[index];
  if (k === 47) return "comment";
  if (k === 115) return "string";
  return "code";
}

function collectMatches(source, mask, regex) {
  const out = [];
  regex.lastIndex = 0;
  let m;
  const re = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
  while ((m = re.exec(source))) {
    out.push({ index: m.index, text: m[0], groups: m });
    if (m.index === re.lastIndex) re.lastIndex += 1;
  }
  return out.map((hit) => ({ ...hit, kind: kindAt(mask, hit.index) }));
}

function classifyJs(source) {
  if (typeof source !== "string") {
    return {
      parseOk: false,
      executableHits: [],
      commentHits: [],
      stringHits: [],
      dynamicRequire: false,
      unclassifiedExecutable: false,
      testOnly: false,
    };
  }
  const { mask, parseOk } = buildMask(source);
  const executableHits = [];
  const commentHits = [];
  const stringHits = [];
  const staticRequireStarts = new Set();
  const staticImportStarts = new Set();
  const classifiedFetchStarts = new Set();

  function bucket(hit, name, how) {
    const rec = { name, how, kind: hit.kind, text: hit.text };
    if (hit.kind === "code") executableHits.push(rec);
    else if (hit.kind === "comment") commentHits.push(rec);
    else stringHits.push(rec);
  }

  for (const hit of collectMatches(source, mask, /require\s*\(\s*(['"])([^'"]+)\1\s*\)/)) {
    if (hit.kind === "code") staticRequireStarts.add(hit.index);
    bucket(hit, hit.groups[2], "require");
  }
  for (const hit of collectMatches(
    source,
    mask,
    /import\s+(?:[\s\S]*?\sfrom\s*)?(['"])([^'"]+)\1/
  )) {
    if (hit.kind === "code") staticImportStarts.add(hit.index);
    bucket(hit, hit.groups[2], "import");
  }
  for (const id of FORBIDDEN_IDS) {
    const re = new RegExp("\\b" + id + "\\b");
    for (const hit of collectMatches(source, mask, re)) {
      bucket(hit, id, "identifier");
    }
  }
  for (const hit of collectMatches(source, mask, /\bfetch\s*\(/)) {
    if (hit.kind === "code") classifiedFetchStarts.add(hit.index);
    bucket(hit, "fetch", "call");
  }

  let dynamicRequire = false;
  let unclassifiedExecutable = false;
  for (const hit of collectMatches(source, mask, /require\s*\(\s*([A-Za-z_$])/)) {
    if (hit.kind === "code") dynamicRequire = true;
  }
  for (const hit of collectMatches(source, mask, /\brequire\s*\(/)) {
    if (hit.kind !== "code" || staticRequireStarts.has(hit.index)) continue;
    dynamicRequire = true;
    unclassifiedExecutable = true;
  }
  for (const hit of collectMatches(source, mask, /\bimport\s*\(/)) {
    if (hit.kind !== "code") continue;
    dynamicRequire = true;
    if (!staticImportStarts.has(hit.index)) unclassifiedExecutable = true;
  }
  for (const hit of collectMatches(source, mask, /\bcreateRequire\s*\(/)) {
    if (hit.kind !== "code") continue;
    dynamicRequire = true;
    unclassifiedExecutable = true;
  }
  for (const hit of collectMatches(source, mask, /\bfetch\s*\(/)) {
    if (hit.kind !== "code" || classifiedFetchStarts.has(hit.index)) continue;
    unclassifiedExecutable = true;
  }
  for (const hit of collectMatches(source, mask, /\]\s*\(/)) {
    if (hit.kind === "code") unclassifiedExecutable = true;
  }

  let testOnly = false;
  for (const hit of collectMatches(source, mask, /\b(?:test|describe|it)\.only\b/)) {
    if (hit.kind === "code") testOnly = true;
  }

  return {
    parseOk,
    executableHits,
    commentHits,
    stringHits,
    dynamicRequire,
    unclassifiedExecutable,
    testOnly,
  };
}

function isForbiddenSpec(spec) {
  if (typeof spec !== "string") return false;
  const n = spec.replace(/\\/g, "/");
  if (FORBIDDEN_SPECS.has(n)) return true;
  if (n === "kb/broker" || n.endsWith("/kb/broker") || n.includes("kb/broker")) return true;
  return false;
}

function isForbiddenHit(hit) {
  if (FORBIDDEN_IDS.has(hit.name) || hit.name === "fetch") return true;
  if (hit.how === "require" || hit.how === "import") return isForbiddenSpec(hit.name);
  return false;
}

function scanSafety(repoRoot, roots) {
  const findings = [];
  const files = [];
  const seen = new Set();
  const list = Array.isArray(roots) ? roots : [];
  let anyFail = false;
  let anyReview = false;
  for (const rel of list) {
    if (typeof rel !== "string" || rel.length === 0) continue;
    if (path.isAbsolute(rel)) {
      findings.push({
        code: "GATE_RUNNER_PATH_ESCAPE",
        severity: "HIGH",
        message: "scan root must be repository-relative",
        root: rel,
      });
      anyFail = true;
      continue;
    }
    let collected;
    try {
      collected = collectContainedCodeFiles(repoRoot, rel, CODE_EXTS);
    } catch (err) {
      findings.push({
        code: "GATE_RUNNER_PATH_ESCAPE",
        severity: "HIGH",
        message: err && err.message ? String(err.message) : "scan root escapes repository",
        root: rel,
      });
      anyFail = true;
      continue;
    }
    for (const escapedPath of collected.escaped) {
      findings.push({
        code: "SAFETY_ESCAPED_SYMLINK",
        severity: "MEDIUM",
        message: "scan child symlink escapes repository",
        file: escapedPath,
      });
      anyReview = true;
    }
    if (collected.missing) continue;
    for (const file of collected.files) {
      if (seen.has(file)) continue;
      seen.add(file);
      files.push(file);
    }
  }
  for (const file of files) {
    let src;
    try {
      src = fs.readFileSync(file, "utf8");
    } catch {
      findings.push({
        code: "SAFETY_READ_FAILED",
        severity: "MEDIUM",
        message: "failed to read scan file",
        file,
      });
      anyReview = true;
      continue;
    }
    const cls = classifyJs(src);
    if (!cls.parseOk) {
      findings.push({
        code: "SAFETY_PARSE_FAILED",
        severity: "MEDIUM",
        message: "parse failed",
        file,
      });
      anyReview = true;
    }
    const forbiddenExec = cls.executableHits.filter(isForbiddenHit);
    if (forbiddenExec.length > 0) {
      anyFail = true;
      findings.push({
        code: "GATE_RUNNER_SAFETY_FAILED",
        severity: "HIGH",
        message: "executable forbidden import/call",
        file,
        hits: forbiddenExec,
      });
    }
    const commentMentions = cls.commentHits.filter(isForbiddenHit);
    const stringMentions = cls.stringHits.filter(isForbiddenHit);
    if (commentMentions.length > 0 || stringMentions.length > 0) {
      if (forbiddenExec.length === 0) {
        anyReview = true;
        findings.push({
          code: "SAFETY_COMMENT_OR_STRING_MENTION",
          severity: "MEDIUM",
          message: "forbidden name mentioned only in comment or string",
          file,
        });
      }
    }
    if (cls.dynamicRequire) {
      anyReview = true;
      findings.push({
        code: "SAFETY_DYNAMIC_REQUIRE",
        severity: "MEDIUM",
        message: "dynamic require/import/createRequire",
        file,
      });
    }
    if (cls.unclassifiedExecutable && !cls.dynamicRequire) {
      anyReview = true;
      findings.push({
        code: "SAFETY_UNCLASSIFIED_EXECUTABLE",
        severity: "MEDIUM",
        message: "executable construct could not be classified",
        file,
      });
    }
    if (cls.testOnly) {
      anyFail = true;
      findings.push({
        code: "TEST_ONLY_DETECTED",
        severity: "HIGH",
        message: "test.only/describe.only/it.only in scanned code",
        file,
      });
    }
  }
  let status = "PASS";
  if (anyFail) status = "FAIL";
  else if (anyReview) status = "REVIEW_REQUIRED";
  return { status, findings, filesScanned: files.length };
}

module.exports = {
  buildMask,
  classifyJs,
  scanSafety,
  FORBIDDEN_SPECS,
  FORBIDDEN_IDS,
};
