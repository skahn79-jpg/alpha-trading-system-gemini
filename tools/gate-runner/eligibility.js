"use strict";

const fs = require("node:fs");
const { classifyJs, buildMask } = require("./safety-scanner");
const { collectContainedCodeFiles } = require("./fs-safe");

const CODE_EXTS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts"]);

const PAPER_FLAG_RE = /\bpaperEligible\b\s*[:=]\s*true\b/g;
const LIVE_FLAG_RE = /\bliveEligible\b\s*[:=]\s*true\b/g;
const PAPER_BRACKET_RE = /\[\s*(['"])paperEligible\1\s*\]\s*=\s*true\b/g;
const LIVE_BRACKET_RE = /\[\s*(['"])liveEligible\1\s*\]\s*=\s*true\b/g;
const NONLITERAL_ASSIGN_RE = /\b(?:paperEligible|liveEligible)\b\s*=(?!=)\s*(?!true\b)(?!false\b)/g;
const NONLITERAL_PROP_RE = /\b(?:paperEligible|liveEligible)\b\s*:\s*(?!true\b)(?!false\b)/g;
const COMPUTED_TRUE_RE = /\]\s*=\s*true\b/g;
const FLAG_MENTION_RE = /\b(?:paperEligible|liveEligible)\b/;

function kindAt(mask, index) {
  const k = mask[index];
  if (k === 47) return "comment";
  if (k === 115) return "string";
  return "code";
}

function scanRegex(source, mask, regex) {
  const re = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
  const out = [];
  let m;
  while ((m = re.exec(source))) {
    out.push({ index: m.index, text: m[0], kind: kindAt(mask, m.index) });
    if (m.index === re.lastIndex) re.lastIndex += 1;
  }
  return out;
}

function evaluateFlag(source, mask, flagRe, bracketRe) {
  let executable = false;
  let commentOrString = false;
  const bracketCloseIndices = [];
  for (const hit of scanRegex(source, mask, flagRe)) {
    if (hit.kind === "code") executable = true;
    else commentOrString = true;
  }
  for (const hit of scanRegex(source, mask, bracketRe)) {
    const closeOffset = hit.text.indexOf("]");
    if (closeOffset >= 0) bracketCloseIndices.push(hit.index + closeOffset);
    if (hit.kind === "code") executable = true;
    else commentOrString = true;
  }
  return { executable, commentOrString, bracketCloseIndices };
}

function hasCodeMatch(source, mask, regex) {
  for (const hit of scanRegex(source, mask, regex)) {
    if (hit.kind === "code") return true;
  }
  return false;
}

function hasComputedTrue(source, mask, literalCloseIndices) {
  if (!FLAG_MENTION_RE.test(source)) return false;
  for (const hit of scanRegex(source, mask, COMPUTED_TRUE_RE)) {
    if (hit.kind !== "code") continue;
    if (literalCloseIndices.has(hit.index)) continue;
    return true;
  }
  return false;
}

function collectScanFiles(repoRoot, roots, findings) {
  const files = [];
  const seen = new Set();
  const list = Array.isArray(roots) ? roots : [];
  for (const rel of list) {
    if (typeof rel !== "string" || rel.length === 0) continue;
    let collected;
    try {
      collected = collectContainedCodeFiles(repoRoot, rel, CODE_EXTS);
    } catch (err) {
      findings.push({
        code: "ELIGIBILITY_SCAN_FAILED",
        severity: "MEDIUM",
        message: "eligibility scan root rejected",
        root: rel,
        cause: err && typeof err.code === "string" ? err.code : "GATE_RUNNER_PATH_ESCAPE",
      });
      continue;
    }
    for (const escapedPath of collected.escaped) {
      findings.push({
        code: "ELIGIBILITY_ESCAPED_SYMLINK",
        severity: "MEDIUM",
        message: "eligibility scan child symlink escapes repository",
        file: escapedPath,
      });
    }
    if (collected.missing) continue;
    for (const file of collected.files) {
      if (seen.has(file)) continue;
      seen.add(file);
      files.push(file);
    }
  }
  return files;
}

function scanEligibility(repoRoot, config) {
  const expectedPaper = Boolean(config && config.eligibility && config.eligibility.paperEligibleExpected);
  const expectedLive = Boolean(config && config.eligibility && config.eligibility.liveEligibleExpected);
  const roots = (config && config.eligibility && config.eligibility.scanRoots) || [];
  const findings = [];
  let paperEligible = false;
  let liveEligible = false;
  let hardStop = false;

  const files = collectScanFiles(repoRoot, roots, findings);

  for (const file of files) {
    let src;
    try {
      src = fs.readFileSync(file, "utf8");
    } catch {
      findings.push({
        code: "ELIGIBILITY_READ_FAILED",
        severity: "MEDIUM",
        message: "failed to read eligibility scan file",
        file,
      });
      continue;
    }
    const cls = classifyJs(src);
    if (!cls.parseOk) {
      findings.push({
        code: "ELIGIBILITY_PARSE_FAILED",
        severity: "MEDIUM",
        message: "eligibility parse failed",
        file,
      });
    }
    const { mask } = buildMask(src);
    const paperHits = evaluateFlag(src, mask, PAPER_FLAG_RE, PAPER_BRACKET_RE);
    const liveHits = evaluateFlag(src, mask, LIVE_FLAG_RE, LIVE_BRACKET_RE);

    if (paperHits.executable) {
      paperEligible = true;
      if (expectedPaper === false) {
        findings.push({
          code: "ELIGIBILITY_PAPER_TRUE",
          severity: "BLOCKER",
          message: "executable paperEligible:true while expected false",
          file,
        });
      }
    } else if (paperHits.commentOrString) {
      findings.push({
        code: "ELIGIBILITY_PAPER_COMMENT",
        severity: "MEDIUM",
        message: "paperEligible true mentioned only in comment or string",
        file,
      });
    }

    if (liveHits.executable) {
      liveEligible = true;
      hardStop = true;
      if (expectedLive === false) {
        findings.push({
          code: "ELIGIBILITY_LIVE_TRUE",
          severity: "BLOCKER",
          message: "executable liveEligible:true while expected false",
          file,
          hardStop: true,
        });
        findings.push({
          code: "GATE_RUNNER_HARD_STOP",
          severity: "BLOCKER",
          message: "liveEligible true is a hard stop",
          file,
          hardStop: true,
        });
      }
    } else if (liveHits.commentOrString) {
      findings.push({
        code: "ELIGIBILITY_LIVE_COMMENT",
        severity: "MEDIUM",
        message: "liveEligible true mentioned only in comment or string",
        file,
      });
    }

    if (
      hasCodeMatch(src, mask, NONLITERAL_ASSIGN_RE) ||
      hasCodeMatch(src, mask, NONLITERAL_PROP_RE)
    ) {
      findings.push({
        code: "ELIGIBILITY_NONLITERAL",
        severity: "MEDIUM",
        message: "eligibility flag set from a non-literal value",
        file,
      });
    }

    const literalCloseIndices = new Set(
      paperHits.bracketCloseIndices.concat(liveHits.bracketCloseIndices)
    );
    if (hasComputedTrue(src, mask, literalCloseIndices)) {
      findings.push({
        code: "ELIGIBILITY_COMPUTED",
        severity: "MEDIUM",
        message: "computed property assigned true in file mentioning eligibility flags",
        file,
      });
    }
  }

  return { paperEligible, liveEligible, findings, hardStop };
}

module.exports = {
  scanEligibility,
};
