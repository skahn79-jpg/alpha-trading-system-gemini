"use strict";

const fs = require("node:fs");
const { fail } = require("./errors");
const { isKnownUntracked, diffNameOnlyHead } = require("./git-inspector");
const { resolveContainedPath } = require("./fs-safe");

function findMatchingTestRegion(source, testId) {
  const re = /test\s*\(\s*(['"])([\s\S]*?)\1/g;
  let match;
  const starts = [];
  while ((match = re.exec(source))) {
    const title = match[2];
    starts.push({ index: match.index, title, startsWith: title.startsWith(testId) });
  }
  let chosen = null;
  for (const s of starts) {
    if (s.startsWith) {
      chosen = s;
      break;
    }
  }
  if (!chosen) return null;
  const next = starts.find((s) => s.index > chosen.index);
  const end = next ? next.index : source.length;
  return source.slice(chosen.index, end);
}

function extractStringLiteralSet(region) {
  const setMatch = region.match(/new\s+Set\s*\(\s*\[([\s\S]*?)\]\s*\)/);
  if (!setMatch) return { status: "UNKNOWN", allowlist: [] };
  const inner = setMatch[1];
  const withoutComments = inner
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const leftover = withoutComments.replace(/(['"])(?:\\.|[^\\])*?\1/g, "").replace(/[\s,]/g, "");
  if (leftover.length > 0) {
    return { status: "UNKNOWN", allowlist: [] };
  }
  const allowlist = [];
  const litRe = /(['"])((?:\\.|[^\\])*?)\1/g;
  let m;
  while ((m = litRe.exec(withoutComments))) {
    allowlist.push(m[2]);
  }
  return { status: "PARSED", allowlist };
}

function analyzeP50({ repoRoot, config, gitSnapshot }) {
  const fileRel = config && config.p50 && config.p50.file;
  const testId = config && config.p50 && config.p50.testId;
  if (!fileRel || !testId) {
    fail("GATE_RUNNER_INVALID_CONFIG", "p50.file and p50.testId required");
  }
  const resolved = resolveContainedPath(repoRoot, fileRel, { mustExist: true });
  if (resolved.kind !== "file") {
    fail("GATE_RUNNER_PATH_ESCAPE", "p50.file is not a regular file inside the repository");
  }
  let source = null;
  let parseStatus = "UNKNOWN";
  try {
    source = fs.readFileSync(resolved.real, "utf8");
  } catch {
    fail("GATE_RUNNER_PATH_ESCAPE", "p50.file could not be read");
  }
  const region = findMatchingTestRegion(source, testId);
  if (!region) {
    parseStatus = "UNKNOWN";
  } else {
    const extracted = extractStringLiteralSet(region);
    parseStatus = extracted.status;
    const allowlist = extracted.allowlist;
    const diffNames = diffNameOnlyHead(repoRoot);
    const allow = new Set(allowlist);
    const missingFromAllowlist = parseStatus === "PARSED" ? diffNames.filter((n) => !allow.has(n)) : [];
    const p50ActualDiffConflict =
      parseStatus === "PARSED" ? missingFromAllowlist.length > 0 : null;
    return {
      p50ParseStatus: parseStatus,
      p50ActualDiffConflict,
      untrackedOutsideKnown: (gitSnapshot && gitSnapshot.unexpectedUntracked) || [],
      allowlist,
      missingFromAllowlist,
      diffNames,
    };
  }
  return {
    p50ParseStatus: parseStatus,
    p50ActualDiffConflict: null,
    untrackedOutsideKnown: (gitSnapshot && gitSnapshot.unexpectedUntracked) || [],
    allowlist: [],
    missingFromAllowlist: [],
  };
}

module.exports = {
  analyzeP50,
  findMatchingTestRegion,
  extractStringLiteralSet,
};
