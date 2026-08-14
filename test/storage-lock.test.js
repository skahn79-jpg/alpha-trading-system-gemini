/**
 * JSON 파일 스토어 락 테스트. 네트워크 없음.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const { createJsonFileStore, StoreLockError } = require("../lib/storage");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "alpha-lock-"));
}

function makeStore(dir, extra = {}) {
  return createJsonFileStore({
    predictionsPath: path.join(dir, "ai-predictions.json"),
    modelPath: path.join(dir, "ai-model.json"),
    ...extra,
  });
}

function rec(id) {
  return { id, predictionId: id, code: id, date: "2026-08-14" };
}

function assertStoreBusy(fn) {
  let err;
  try {
    const ret = fn();
    if (ret && typeof ret.then === "function") {
      throw new Error("expected sync StoreLockError, got Promise");
    }
    throw new Error("expected StoreLockError");
  } catch (e) {
    if (e && (e.message === "expected StoreLockError" || e.message === "expected sync StoreLockError, got Promise")) {
      throw e;
    }
    err = e;
  }
  assert.equal(err.name, "StoreLockError");
  assert.ok(err instanceof StoreLockError);
  assert.equal(err.code, "STORE_BUSY");
  return err;
}

function spawnLockHolder(predictionsPath, modelPath, holdMs) {
  const storePath = path.join(__dirname, "../lib/storage/json-file-store.js");
  return spawn(process.execPath, ["-e", `
    const { createJsonFileStore } = require(${JSON.stringify(storePath)});
    const store = createJsonFileStore({
      predictionsPath: ${JSON.stringify(predictionsPath)},
      modelPath: ${JSON.stringify(modelPath)},
    });
    store.holdLockSync(() => {
      process.stdout.write("locked\\n");
      const sab = new SharedArrayBuffer(4);
      Atomics.wait(new Int32Array(sab), 0, 0, ${Number(holdMs)});
    });
  `], { stdio: ["ignore", "pipe", "pipe"] });
}

function waitLocked(child) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("child lock timeout")), 3000);
    child.stdout.on("data", (buf) => {
      if (String(buf).includes("locked")) {
        clearTimeout(t);
        resolve();
      }
    });
    child.on("error", reject);
  });
}

test("순차 저장 둘 다 성공", async () => {
  const dir = tmpDir();
  const store = makeStore(dir);
  await store.savePrediction(rec("a"));
  await store.savePrediction(rec("b"));
  const all = store.listPredictions();
  assert.equal(all.length, 2);
});

test("기본 옵션 + 살아 있는 lock → STORE_BUSY, unlink 후 저장 성공", async () => {
  const dir = tmpDir();
  const predictionsPath = path.join(dir, "ai-predictions.json");
  const lockPath = `${predictionsPath}.lock`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify({
    pid: process.pid,
    createdAt: new Date().toISOString(),
    operationId: "live-default",
  }));
  const store = makeStore(dir);
  const t0 = Date.now();
  assertStoreBusy(() => store.savePrediction(rec("busy")));
  assert.ok(Date.now() - t0 < 200);
  fs.unlinkSync(lockPath);
  await store.savePrediction(rec("after-unlock"));
  assert.equal(store.listPredictions().length, 1);
});

test("child_process 경합 시 STORE_BUSY 빠른 실패, 종료 후 저장 성공", async () => {
  const dir = tmpDir();
  const predictionsPath = path.join(dir, "ai-predictions.json");
  const modelPath = path.join(dir, "ai-model.json");
  const child = spawnLockHolder(predictionsPath, modelPath, 400);
  await waitLocked(child);

  const store = makeStore(dir);
  const t0 = Date.now();
  assertStoreBusy(() => store.savePrediction(rec("busy")));
  assert.ok(Date.now() - t0 < 200);

  await new Promise((resolve) => child.on("close", resolve));
  await store.savePrediction(rec("after-wait"));
  assert.equal(store.listPredictions().length, 1);
});

test("살아 있는 PID lock 삭제 안 함 + timeout", async () => {
  const dir = tmpDir();
  const predictionsPath = path.join(dir, "ai-predictions.json");
  const lockPath = `${predictionsPath}.lock`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify({
    pid: process.pid,
    createdAt: new Date(Date.now() - 60000).toISOString(),
    operationId: "live-lock",
  }));
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(lockPath, old, old);

  const store = makeStore(dir, { lockOptions: { maxWaitMs: 120, retryMs: 30, staleMs: 15 } });
  assertStoreBusy(() => store.savePrediction(rec("x")));
  assert.equal(fs.existsSync(lockPath), true);
  const kept = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  assert.equal(kept.pid, process.pid);
});

test("죽은 pid 999999999 복구 후 저장 성공", async () => {
  const dir = tmpDir();
  const predictionsPath = path.join(dir, "ai-predictions.json");
  const lockPath = `${predictionsPath}.lock`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify({
    pid: 999999999,
    createdAt: new Date(Date.now() - 60000).toISOString(),
    operationId: "dead-lock",
  }));
  const logs = [];
  const orig = console.log;
  console.log = (...args) => { logs.push(args.map(String).join(" ")); };
  try {
    const store = makeStore(dir);
    await store.savePrediction(rec("recovered"));
  } finally {
    console.log = orig;
  }
  assert.equal(makeStore(dir).listPredictions().length, 1);
  assert.ok(logs.some((l) => l.includes("stale-lock-recovered")));
  assert.ok(logs.some((l) => l.includes("999999999")));
  assert.equal(logs.some((l) => l.includes("ai-predictions")), false);
});

test("잘못된 JSON 오래되면 복구 / 최근이면 금지", async () => {
  const dir = tmpDir();
  const predictionsPath = path.join(dir, "ai-predictions.json");
  const lockPath = `${predictionsPath}.lock`;
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(lockPath, "not-json");
  const recentStore = makeStore(dir, { lockOptions: { maxWaitMs: 80, retryMs: 20, staleMs: 15000 } });
  assertStoreBusy(() => recentStore.savePrediction(rec("recent")));
  assert.equal(fs.existsSync(lockPath), true);

  const old = new Date(Date.now() - 30000);
  fs.utimesSync(lockPath, old, old);
  const oldStore = makeStore(dir, { lockOptions: { maxWaitMs: 500, retryMs: 20, staleMs: 15000 } });
  await oldStore.savePrediction(rec("old-malformed"));
  assert.equal(oldStore.listPredictions()[0].id, "old-malformed");
});

test("재시도 후 성공", async () => {
  const dir = tmpDir();
  const predictionsPath = path.join(dir, "ai-predictions.json");
  const modelPath = path.join(dir, "ai-model.json");
  const child = spawnLockHolder(predictionsPath, modelPath, 12);
  await waitLocked(child);
  const store = makeStore(dir);
  await store.savePrediction(rec("retry-ok"));
  assert.equal(store.listPredictions().length, 1);
  await new Promise((resolve) => child.on("close", resolve));
});

test("최대 대기시간 초과", async () => {
  const dir = tmpDir();
  const predictionsPath = path.join(dir, "ai-predictions.json");
  const lockPath = `${predictionsPath}.lock`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify({
    pid: process.pid,
    createdAt: new Date().toISOString(),
    operationId: "wait",
  }));
  const store = makeStore(dir, { lockOptions: { maxWaitMs: 60, retryMs: 20, staleMs: 15000 } });
  const t0 = Date.now();
  const err = assertStoreBusy(() => store.savePrediction(rec("timeout")));
  assert.equal(err.code, "STORE_BUSY");
  assert.ok(Date.now() - t0 >= 60);
});

test("lock unlink throw", async () => {
  const dir = tmpDir();
  const store = makeStore(dir, {
    fsModule: {
      unlinkSync(p) {
        if (String(p).endsWith(".lock")) throw new Error("unlink lock fail");
        return fs.unlinkSync(p);
      },
    },
  });
  await assert.rejects(() => store.savePrediction(rec("u")), (err) => {
    assert.match(String(err.message), /unlink lock fail/);
    return true;
  });
});
