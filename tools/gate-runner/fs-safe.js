"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { fail } = require("./errors");
const { stableStringify } = require("./json-safe");

let writeSeq = 0;

function nextSeq() {
  writeSeq += 1;
  return writeSeq;
}

function realpathOrEscape(target, label) {
  try {
    return fs.realpathSync(target);
  } catch {
    fail("GATE_RUNNER_PATH_ESCAPE", `${label || "path"} realpath failed`);
  }
}

function assertContained(rootReal, targetReal) {
  if (typeof rootReal !== "string" || typeof targetReal !== "string" || !rootReal || !targetReal) {
    fail("GATE_RUNNER_PATH_ESCAPE", "containment check failed");
  }
  if (targetReal === rootReal) return;
  const prefix = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  if (!targetReal.startsWith(prefix)) {
    fail("GATE_RUNNER_PATH_ESCAPE", "path escapes repository");
  }
}

function gatesDir(repoRoot) {
  const rootReal = realpathOrEscape(repoRoot, "repoRoot");
  return path.join(rootReal, ".gates");
}

function ensureGatesWritable(repoRoot) {
  const rootReal = realpathOrEscape(repoRoot, "repoRoot");
  const dir = path.join(rootReal, ".gates");
  if (!fs.existsSync(dir)) {
    fail("GATE_RUNNER_NOT_INITIALIZED", ".gates is missing");
  }
  let lst;
  try {
    lst = fs.lstatSync(dir);
  } catch {
    fail("GATE_RUNNER_PATH_ESCAPE", ".gates lstat failed");
  }
  const real = realpathOrEscape(dir, ".gates");
  assertContained(rootReal, real);
  if (lst.isSymbolicLink()) {
    assertContained(rootReal, real);
  }
  return real;
}

function isGlobPattern(userPath) {
  return typeof userPath === "string" && /[*?[\]]/.test(userPath);
}

function assertSafeRepoRelPattern(userPath, errorCode) {
  const code = errorCode || "GATE_RUNNER_INVALID_CONFIG";
  if (typeof userPath !== "string" || userPath.length === 0) {
    fail(code, "empty path");
  }
  if (userPath.includes("\0")) {
    fail("GATE_RUNNER_PATH_ESCAPE", "nul in path");
  }
  const raw = String(userPath);
  const asPosix = raw.replace(/\\/g, "/");
  if (path.isAbsolute(raw) || asPosix.startsWith("/") || raw.startsWith("\\")) {
    fail(code, "absolute path rejected");
  }
  if (/^[A-Za-z]:[\\/]/.test(raw)) {
    fail(code, "windows drive rejected");
  }
  const lower = asPosix.toLowerCase();
  if (lower.startsWith("file:") || asPosix.includes("://")) {
    fail(code, "url-like path rejected");
  }
  const parts = asPosix.split("/");
  if (parts.some((p) => p === "..")) {
    fail(code, "parent traversal rejected");
  }
  const norm = path.posix.normalize(asPosix);
  if (norm === ".." || norm.startsWith("../") || path.posix.isAbsolute(norm)) {
    fail(code, "path escapes repository");
  }
  return asPosix;
}

function resolveContainedPath(repoRoot, userPath, opts) {
  const options = opts || {};
  const mustExist = Boolean(options.mustExist);
  const allowGlob = Boolean(options.allowGlob);
  assertSafeRepoRelPattern(userPath, "GATE_RUNNER_PATH_ESCAPE");
  const rootReal = realpathOrEscape(repoRoot, "repoRoot");
  const resolvedGuess = path.resolve(rootReal, userPath);
  if (resolvedGuess !== rootReal) {
    const prefix = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
    if (!resolvedGuess.startsWith(prefix)) {
      fail("GATE_RUNNER_PATH_ESCAPE", "path escapes repository");
    }
  }
  const joined = path.join(rootReal, userPath);
  let lst;
  try {
    lst = fs.lstatSync(joined);
  } catch {
    if (allowGlob && isGlobPattern(userPath)) {
      return { kind: "glob", abs: joined, real: null, symlink: false };
    }
    if (mustExist) {
      fail("GATE_RUNNER_PATH_ESCAPE", "path does not exist");
    }
    return { kind: "missing", abs: joined, real: null, symlink: false };
  }
  if (lst.isSymbolicLink()) {
    const real = realpathOrEscape(joined, userPath);
    assertContained(rootReal, real);
    let st;
    try {
      st = fs.statSync(real);
    } catch {
      if (mustExist) fail("GATE_RUNNER_PATH_ESCAPE", "symlink target missing");
      return { kind: "symlink", abs: joined, real, symlink: true };
    }
    const kind = st.isFile() ? "file" : st.isDirectory() ? "dir" : "other";
    return { kind, abs: joined, real, symlink: true };
  }
  const real = realpathOrEscape(joined, userPath);
  assertContained(rootReal, real);
  const kind = lst.isFile() ? "file" : lst.isDirectory() ? "dir" : "other";
  return { kind, abs: joined, real, symlink: false };
}

function validateTestPathOperand(repoRoot, operand) {
  assertSafeRepoRelPattern(operand, "GATE_RUNNER_PATH_ESCAPE");
  const rootReal = realpathOrEscape(repoRoot, "repoRoot");
  const joined = path.join(rootReal, operand);
  let lst;
  try {
    lst = fs.lstatSync(joined);
  } catch {
    return;
  }
  if (lst.isSymbolicLink()) {
    const real = realpathOrEscape(joined, operand);
    assertContained(rootReal, real);
    return;
  }
  if (lst.isFile() || lst.isDirectory()) {
    const real = realpathOrEscape(joined, operand);
    assertContained(rootReal, real);
  }
}

const DEFAULT_SKIP_DIRS = new Set(["node_modules", ".git", ".gates"]);

function collectContainedCodeFiles(repoRoot, userPath, extSet) {
  const files = [];
  const escaped = [];
  const resolved = resolveContainedPath(repoRoot, userPath, { mustExist: false });
  if (resolved.kind === "missing" || resolved.kind === "glob") {
    return { files, escaped, missing: true };
  }
  const rootReal = realpathOrEscape(repoRoot, "repoRoot");
  const visited = new Set();
  const exts = extSet || new Set([".js", ".mjs", ".cjs", ".jsx", ".ts"]);

  function recordEscaped(abs) {
    escaped.push(path.relative(rootReal, abs).replace(/\\/g, "/") || abs);
  }

  function walkDir(dirReal) {
    let entries;
    try {
      entries = fs.readdirSync(dirReal, { withFileTypes: true });
    } catch {
      recordEscaped(dirReal);
      return;
    }
    for (const ent of entries) {
      if (DEFAULT_SKIP_DIRS.has(ent.name)) continue;
      visit(path.join(dirReal, ent.name));
    }
  }

  function visit(abs) {
    let lst;
    try {
      lst = fs.lstatSync(abs);
    } catch {
      recordEscaped(abs);
      return;
    }
    if (lst.isSymbolicLink()) {
      let real;
      try {
        real = fs.realpathSync(abs);
      } catch {
        recordEscaped(abs);
        return;
      }
      try {
        assertContained(rootReal, real);
      } catch {
        recordEscaped(abs);
        return;
      }
      if (visited.has(real)) return;
      visited.add(real);
      let st;
      try {
        st = fs.statSync(real);
      } catch {
        recordEscaped(abs);
        return;
      }
      if (st.isFile()) {
        if (exts.has(path.extname(real))) files.push(real);
        return;
      }
      if (st.isDirectory()) walkDir(real);
      return;
    }
    let real;
    try {
      real = fs.realpathSync(abs);
    } catch {
      recordEscaped(abs);
      return;
    }
    try {
      assertContained(rootReal, real);
    } catch {
      recordEscaped(abs);
      return;
    }
    if (visited.has(real)) return;
    visited.add(real);
    if (lst.isFile()) {
      if (exts.has(path.extname(real))) files.push(real);
      return;
    }
    if (lst.isDirectory()) walkDir(real);
  }

  if (!resolved.real) {
    return { files, escaped, missing: true };
  }
  visit(resolved.real);
  return { files, escaped, missing: false };
}

function resolveRepoRelative(repoRoot, userPath) {
  if (typeof userPath !== "string" || userPath.length === 0) {
    fail("GATE_RUNNER_PATH_ESCAPE", "empty path");
  }
  if (path.isAbsolute(userPath)) {
    fail("GATE_RUNNER_PATH_ESCAPE", "absolute path rejected");
  }
  if (userPath.includes("\0")) {
    fail("GATE_RUNNER_PATH_ESCAPE", "nul in path");
  }
  assertSafeRepoRelPattern(userPath, "GATE_RUNNER_PATH_ESCAPE");
  const rootReal = realpathOrEscape(repoRoot, "repoRoot");
  const joined = path.join(rootReal, userPath);
  const resolved = realpathOrEscape(joined, userPath);
  assertContained(rootReal, resolved);
  return resolved;
}

const SAFE_PATH_COMPONENT_RE = /^[A-Za-z0-9_-]{1,128}$/;

function assertSafePathComponent(part) {
  if (typeof part !== "string" || part.length === 0) {
    fail("GATE_RUNNER_PATH_ESCAPE", "empty path component");
  }
  if (part === "." || part === ".." || part === "...") {
    fail("GATE_RUNNER_PATH_ESCAPE", "dot path component rejected");
  }
  if (part.includes("/") || part.includes("\\") || part.includes("\0") || part.includes("\n") || part.includes("\r")) {
    fail("GATE_RUNNER_PATH_ESCAPE", "unsafe path component");
  }
  if (!SAFE_PATH_COMPONENT_RE.test(part)) {
    fail("GATE_RUNNER_PATH_ESCAPE", "unsafe path component");
  }
  return part;
}

function ensureContainedDirectory(repoRoot, relativeParts) {
  const gatesReal = ensureGatesWritable(repoRoot);
  const parts = Array.isArray(relativeParts) ? relativeParts : [];
  let current = gatesReal;
  for (const part of parts) {
    assertSafePathComponent(part);
    const next = path.join(current, part);
    const prefix = current.endsWith(path.sep) ? current : current + path.sep;
    if (next === current || !next.startsWith(prefix)) {
      fail("GATE_RUNNER_PATH_ESCAPE", "path escapes .gates");
    }
    assertContained(gatesReal, next);
    let lst;
    try {
      lst = fs.lstatSync(next);
    } catch (err) {
      if (!err || err.code !== "ENOENT") {
        fail("GATE_RUNNER_PATH_ESCAPE", "lstat failed");
      }
      fs.mkdirSync(next);
      const createdReal = realpathOrEscape(next, part);
      assertContained(gatesReal, createdReal);
      current = createdReal;
      continue;
    }
    let real;
    if (lst.isSymbolicLink()) {
      real = realpathOrEscape(next, part);
      assertContained(gatesReal, real);
    } else {
      real = realpathOrEscape(next, part);
      assertContained(gatesReal, real);
    }
    let st;
    try {
      st = fs.statSync(real);
    } catch {
      fail("GATE_RUNNER_PATH_ESCAPE", "path is not a directory");
    }
    if (!st.isDirectory()) {
      fail("GATE_RUNNER_PATH_ESCAPE", "path is not a directory");
    }
    current = real;
  }
  return current;
}

function mapDestUnderGates(gatesReal, repoRoot, destAbs) {
  try {
    assertContained(gatesReal, destAbs);
    return destAbs;
  } catch (first) {
    const gatesLexical = path.resolve(repoRoot, ".gates");
    const prefix = gatesLexical.endsWith(path.sep) ? gatesLexical : gatesLexical + path.sep;
    if (destAbs === gatesLexical || destAbs.startsWith(prefix)) {
      const rel = path.relative(gatesLexical, destAbs);
      const mapped = rel === "" ? gatesReal : path.join(gatesReal, rel);
      assertContained(gatesReal, mapped);
      return mapped;
    }
    throw first;
  }
}

function assertUnderGates(repoRoot, destPath) {
  const gatesReal = ensureGatesWritable(repoRoot);
  const destAbs = mapDestUnderGates(gatesReal, repoRoot, path.resolve(destPath));
  const destDir = path.dirname(destAbs);
  const rel = path.relative(gatesReal, destDir);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    fail("GATE_RUNNER_PATH_ESCAPE", "write parent escapes .gates");
  }
  const parts = rel === "" ? [] : rel.split(path.sep).filter((p) => p && p !== ".");
  if (parts.length > 0) {
    ensureContainedDirectory(repoRoot, parts);
  }
  if (fs.existsSync(destAbs)) {
    const destReal = realpathOrEscape(destAbs, "write dest");
    assertContained(gatesReal, destReal);
  }
}

function atomicWriteFile(repoRoot, destPath, data) {
  if (typeof destPath !== "string" || destPath.length === 0) {
    fail("GATE_RUNNER_PATH_ESCAPE", "empty dest path");
  }
  assertUnderGates(repoRoot, destPath);
  const dir = path.dirname(destPath);
  const tmp = path.join(dir, `.atomic.${process.pid}.${nextSeq()}`);
  const flags = fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY;
  const nofollow = fs.constants.O_NOFOLLOW ? flags | fs.constants.O_NOFOLLOW : flags;
  let fd;
  try {
    fd = fs.openSync(tmp, nofollow, 0o644);
  } catch (err) {
    if (err && err.code === "ELOOP") {
      fail("GATE_RUNNER_PATH_ESCAPE", "symlink temp rejected");
    }
    throw err;
  }
  try {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
    fs.writeFileSync(fd, buf);
    fs.fsyncSync(fd);
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      /* ignore */
    }
  }
  try {
    fs.renameSync(tmp, destPath);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    if (err && err.code === "EXDEV") {
      fail("GATE_RUNNER_GIT_ERROR", "EXDEV rename not allowed");
    }
    throw err;
  }
}

function acquireLock(repoRoot, command) {
  ensureGatesWritable(repoRoot);
  const lockPath = path.join(gatesDir(repoRoot), "runner.lock");
  const flags = fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY;
  let fd;
  try {
    fd = fs.openSync(lockPath, flags, 0o644);
  } catch (err) {
    if (err && err.code === "EEXIST") {
      fail("GATE_RUNNER_BUSY", "runner lock exists");
    }
    throw err;
  }
  try {
    const body = stableStringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      command: command || null,
    });
    fs.writeFileSync(fd, body);
  } catch (err) {
    try {
      fs.closeSync(fd);
    } catch {
      /* ignore */
    }
    throw err;
  }
  return { fd, lockPath };
}

function releaseLock(lock) {
  if (!lock) return;
  if (lock.fd != null) {
    try {
      fs.closeSync(lock.fd);
    } catch {
      /* ignore */
    }
    lock.fd = null;
  }
  if (lock.lockPath) {
    try {
      fs.unlinkSync(lock.lockPath);
    } catch {
      /* ignore */
    }
  }
}

module.exports = {
  resolveRepoRelative,
  assertSafeRepoRelPattern,
  assertSafePathComponent,
  resolveContainedPath,
  validateTestPathOperand,
  collectContainedCodeFiles,
  isGlobPattern,
  assertContained,
  atomicWriteFile,
  acquireLock,
  releaseLock,
  gatesDir,
  ensureGatesWritable,
  ensureContainedDirectory,
  realpathOrEscape,
};
