/**
 * 평가 완료 예측 로그 로컬 아카이브.
 * 기본 enabled=false. predictor 경로에서 자동 실행하지 않는다.
 * PENDING / CALENDAR_PENDING / MODEL_UPDATE_PENDING / PRICE_EVALUATED 는 아카이브·삭제 금지.
 */

"use strict";

const fsNative = require("fs");
const path = require("path");
const crypto = require("crypto");

const PENDING_STATUSES = new Set([
  "PENDING",
  "CALENDAR_PENDING",
  "MODEL_UPDATE_PENDING",
  "PRICE_EVALUATED",
]);

function createArchivePolicy({
  enabled = false,
  maxEvaluatedInActive = 5000,
  maxActiveBytes = 2_000_000,
  retentionDays = null,
  archiveDir,
} = {}) {
  return {
    enabled: !!enabled,
    maxEvaluatedInActive,
    maxActiveBytes,
    retentionDays: retentionDays == null ? null : retentionDays,
    archiveDir: archiveDir || null,
  };
}

function isArchivable(record) {
  if (!record || typeof record !== "object") return false;
  if (PENDING_STATUSES.has(record.evaluationStatus)) return false;
  return record.evaluationStatus === "EVALUATED" || record.status === "resolved";
}

function recordMonthKey(record) {
  const raw = record.evaluatedAt || record.createdAt || record.date || record.baseTradingDate || "";
  const s = String(raw);
  const m = s.match(/^(\d{4})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}`;
  return "unknown";
}

function sortOldestFirst(a, b) {
  const ka = String(a.evaluatedAt || a.createdAt || a.date || a.baseTradingDate || "");
  const kb = String(b.evaluatedAt || b.createdAt || b.date || b.baseTradingDate || "");
  return ka.localeCompare(kb);
}

function planArchive(records, policy, now) {
  const list = Array.isArray(records) ? records : [];
  const pol = policy || createArchivePolicy();
  if (!pol.enabled) {
    return {
      toArchive: [],
      toKeep: list.slice(),
      files: {},
      now: now || null,
    };
  }

  const keep = [];
  const evaluated = [];
  for (const r of list) {
    if (isArchivable(r)) evaluated.push(r);
    else keep.push(r);
  }

  evaluated.sort(sortOldestFirst);
  let overflow = 0;
  if (Number.isInteger(pol.maxEvaluatedInActive) && evaluated.length > pol.maxEvaluatedInActive) {
    overflow = evaluated.length - pol.maxEvaluatedInActive;
  }

  const activeBytes = Buffer.byteLength(JSON.stringify(list), "utf8");
  if (Number.isFinite(pol.maxActiveBytes) && activeBytes > pol.maxActiveBytes && overflow < evaluated.length) {
    let bytes = activeBytes;
    let idx = overflow;
    while (idx < evaluated.length && bytes > pol.maxActiveBytes) {
      bytes -= Buffer.byteLength(JSON.stringify(evaluated[idx]), "utf8");
      idx += 1;
    }
    overflow = idx;
  }

  const toArchive = evaluated.slice(0, overflow);
  const remainEvaluated = evaluated.slice(overflow);
  const files = {};
  for (const r of toArchive) {
    const key = recordMonthKey(r);
    if (!files[key]) files[key] = [];
    files[key].push(r);
  }

  return {
    toArchive,
    toKeep: keep.concat(remainEvaluated),
    files,
    now: now || null,
  };
}

function atomicWrite(fs, filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmpPath, contents, "utf8");
  try {
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

function archiveFileName(yearMonth) {
  return `predictions-${yearMonth}.json`;
}

function archiveEvaluatedRecords({
  activePath,
  archiveDir,
  records,
  policy,
  fsModule,
} = {}) {
  const fs = { ...fsNative, ...(fsModule || {}) };
  const pol = policy || createArchivePolicy({ archiveDir });
  const list = Array.isArray(records) ? records : [];
  const dir = pol.archiveDir || archiveDir;

  if (!pol.enabled) {
    return { archived: 0, kept: list.length, files: [] };
  }
  if (!activePath || !dir) {
    throw new TypeError("activePath and archiveDir are required");
  }

  const plan = planArchive(list, { ...pol, archiveDir: dir });
  if (plan.toArchive.length === 0) {
    return { archived: 0, kept: plan.toKeep.length, files: [] };
  }

  const written = [];
  try {
    for (const [yearMonth, monthRecords] of Object.entries(plan.files)) {
      const filePath = path.join(dir, archiveFileName(yearMonth));
      let existing = [];
      if (fs.existsSync(filePath)) {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        existing = Array.isArray(parsed) ? parsed : [];
      }
      atomicWrite(fs, filePath, JSON.stringify(existing.concat(monthRecords), null, 2));
      written.push(filePath);
    }
    atomicWrite(fs, activePath, JSON.stringify(plan.toKeep, null, 2));
  } catch (err) {
    return { archived: 0, kept: list.length, files: [], error: err, originalPreserved: true };
  }

  return { archived: plan.toArchive.length, kept: plan.toKeep.length, files: written };
}

module.exports = {
  createArchivePolicy,
  planArchive,
  archiveEvaluatedRecords,
};
