/**
 * 아카이브 정책 테스트. predictor 자동 실행 없음. 네트워크 없음.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  createArchivePolicy,
  planArchive,
  archiveEvaluatedRecords,
} = require("../lib/storage");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "alpha-arch-"));
}

function rec(id, status, extra = {}) {
  return {
    id,
    predictionId: id,
    code: "005930",
    evaluationStatus: status,
    status: status === "EVALUATED" ? "resolved" : "pending",
    evaluatedAt: extra.evaluatedAt || "2026-08-24T15:40:00+09:00",
    createdAt: extra.createdAt || "2026-08-14T15:40:00+09:00",
    ...extra,
  };
}

test("disabled no-op", () => {
  const records = [rec("a", "EVALUATED"), rec("b", "PENDING")];
  const policy = createArchivePolicy({ enabled: false, maxEvaluatedInActive: 0 });
  const plan = planArchive(records, policy, "2026-08-24T15:40:00+09:00");
  assert.equal(plan.toArchive.length, 0);
  assert.equal(plan.toKeep.length, 2);
  const dir = tmpDir();
  const activePath = path.join(dir, "ai-predictions.json");
  fs.writeFileSync(activePath, JSON.stringify(records, null, 2));
  const result = archiveEvaluatedRecords({
    activePath,
    archiveDir: path.join(dir, "archive"),
    records,
    policy,
  });
  assert.equal(result.archived, 0);
  assert.equal(JSON.parse(fs.readFileSync(activePath, "utf8")).length, 2);
});

test("EVALUATED만 이동", () => {
  const records = [
    rec("e1", "EVALUATED"),
    rec("e2", "EVALUATED", { status: "resolved" }),
    rec("p1", "PENDING"),
  ];
  const policy = createArchivePolicy({ enabled: true, maxEvaluatedInActive: 0, archiveDir: "x" });
  const plan = planArchive(records, policy);
  assert.equal(plan.toArchive.length, 2);
  assert.ok(plan.toArchive.every((r) => r.evaluationStatus === "EVALUATED"));
  assert.equal(plan.toKeep.length, 1);
  assert.equal(plan.toKeep[0].id, "p1");
});

test("pending류 보존", () => {
  const records = [
    rec("a", "PENDING"),
    rec("b", "CALENDAR_PENDING"),
    rec("c", "MODEL_UPDATE_PENDING"),
    rec("d", "PRICE_EVALUATED"),
    rec("e", "EVALUATED"),
  ];
  const policy = createArchivePolicy({ enabled: true, maxEvaluatedInActive: 0 });
  const plan = planArchive(records, policy);
  assert.equal(plan.toArchive.length, 1);
  assert.equal(plan.toArchive[0].id, "e");
  assert.equal(plan.toKeep.length, 4);
  assert.ok(plan.toKeep.every((r) => r.evaluationStatus !== "EVALUATED"));
});

test("실패 시 원본 유지", () => {
  const dir = tmpDir();
  const activePath = path.join(dir, "ai-predictions.json");
  const archiveDir = path.join(dir, "archive");
  const records = [rec("e1", "EVALUATED"), rec("p1", "PENDING")];
  fs.writeFileSync(activePath, JSON.stringify(records, null, 2));
  const policy = createArchivePolicy({
    enabled: true,
    maxEvaluatedInActive: 0,
    archiveDir,
  });
  const result = archiveEvaluatedRecords({
    activePath,
    archiveDir,
    records,
    policy,
    fsModule: {
      writeFileSync() { throw new Error("disk full"); },
    },
  });
  assert.equal(result.archived, 0);
  assert.equal(result.originalPreserved, true);
  const kept = JSON.parse(fs.readFileSync(activePath, "utf8"));
  assert.equal(kept.length, 2);
  assert.ok(kept.some((r) => r.id === "e1"));
});

test("월별 파일명 predictions-YYYY-MM.json", () => {
  const dir = tmpDir();
  const activePath = path.join(dir, "ai-predictions.json");
  const archiveDir = path.join(dir, "archive");
  const records = [
    rec("aug", "EVALUATED", { evaluatedAt: "2026-08-24T15:40:00+09:00" }),
    rec("sep", "EVALUATED", { evaluatedAt: "2026-09-01T15:40:00+09:00" }),
    rec("pend", "PENDING"),
  ];
  fs.writeFileSync(activePath, JSON.stringify(records, null, 2));
  const policy = createArchivePolicy({
    enabled: true,
    maxEvaluatedInActive: 0,
    archiveDir,
  });
  const result = archiveEvaluatedRecords({ activePath, archiveDir, records, policy });
  assert.equal(result.archived, 2);
  assert.equal(fs.existsSync(path.join(archiveDir, "predictions-2026-08.json")), true);
  assert.equal(fs.existsSync(path.join(archiveDir, "predictions-2026-09.json")), true);
  const active = JSON.parse(fs.readFileSync(activePath, "utf8"));
  assert.equal(active.length, 1);
  assert.equal(active[0].id, "pend");
  const aug = JSON.parse(fs.readFileSync(path.join(archiveDir, "predictions-2026-08.json"), "utf8"));
  assert.equal(aug[0].id, "aug");
});
