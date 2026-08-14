/**
 * 로컬 JSON 파일 StoragePort.
 * Node 내장 fs/path/crypto만 사용한다.
 *
 * - 원자적 교체: tmp write + rename
 * - 프로세스 내 mutex + 파일 락 (openSync wx + JSON {pid, createdAt, operationId})
 * - EEXIST/in-process busy 시 짧은 Atomics.wait 재시도, maxWait 초과 시 StoreLockError (STORE_BUSY)
 * - 요청 경로에서 길게 동기 대기하지 않음. 짧은 재시도 후 STORE_BUSY. save는 이후 재시도 가능
 * - 손상 JSON은 CorruptedJsonError. 빈 배열로 덮어쓰지 않음
 * - 파일 없음: predictions=[], model=null
 * - 쓰기 전 .bak 백업. commitMaturedBatch / commitPredictions 실패 시 copyFileSync로 복구
 */

"use strict";

const fsNative = require("fs");
const path = require("path");
const crypto = require("crypto");
const { CorruptedJsonError, StoreLockError } = require("./errors");

// 요청 경로에서 길게 동기 대기하지 않음. 짧은 재시도 후 STORE_BUSY. save는 이후 재시도 가능.
const DEFAULT_LOCK_OPTIONS = Object.freeze({
  maxWaitMs: 30,
  retryMs: 5,
  staleMs: 15000,
});

function clone(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function recordIds(record) {
  const ids = [];
  if (record.predictionId) ids.push(String(record.predictionId));
  if (record.id) ids.push(String(record.id));
  const code = record.symbol || record.code;
  const date = record.baseTradingDate || record.date;
  if (code && date) ids.push(`${code}-${date}`);
  return ids;
}

function matchesId(record, id) {
  if (id == null) return false;
  const key = String(id);
  return recordIds(record).includes(key);
}

function isSettled(record) {
  return record.evaluationStatus === "EVALUATED" || record.status === "resolved";
}

function findIndex(preds, id) {
  return preds.findIndex((p) => matchesId(p, id));
}

function sleepSync(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err && err.code === "ESRCH") return false;
    if (err && err.code === "EPERM") return true;
    return null;
  }
}

function lockAgeMs(lockPath, parsed, stat, nowMs) {
  const fromMtime = stat && Number.isFinite(stat.mtimeMs) ? nowMs - stat.mtimeMs : Infinity;
  let fromCreated = Infinity;
  if (parsed && parsed.createdAt) {
    const created = Date.parse(parsed.createdAt);
    if (Number.isFinite(created)) fromCreated = nowMs - created;
  }
  return Math.min(fromMtime, fromCreated);
}

function createJsonFileStore({
  predictionsPath,
  modelPath,
  fsModule,
  lockOptions,
  failOnWrite,
  onAfterPredictionsWrite,
  failNextModelWrite,
} = {}) {
  if (!predictionsPath || !modelPath) {
    throw new TypeError("predictionsPath and modelPath are required");
  }

  const fs = { ...fsNative, ...(fsModule || {}) };
  const lockPath = `${predictionsPath}.lock`;
  const lockOpts = { ...DEFAULT_LOCK_OPTIONS, ...(lockOptions || {}) };
  let inProcessLocked = false;
  let predictionsWriteCount = 0;
  let modelWriteCount = 0;
  let failNextModel = !!failNextModelWrite;

  function ensureDir(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  function readLockMeta() {
    let stat;
    try {
      stat = fs.statSync(lockPath);
    } catch (err) {
      if (err && err.code === "ENOENT") return { missing: true };
      throw err;
    }
    let parsed = null;
    let malformed = false;
    try {
      const raw = fs.readFileSync(lockPath, "utf8");
      parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        parsed = null;
        malformed = true;
      }
    } catch {
      malformed = true;
      parsed = null;
    }
    return { missing: false, stat, parsed, malformed };
  }

  function recoverStaleLock(meta) {
    const pid = meta.parsed && typeof meta.parsed.pid === "number" ? meta.parsed.pid : undefined;
    try {
      fs.unlinkSync(lockPath);
    } catch (err) {
      if (err && err.code === "ENOENT") return true;
      throw err;
    }
    console.log(JSON.stringify({
      event: "stale-lock-recovered",
      pid: pid === undefined ? null : pid,
      operationId: (meta.parsed && meta.parsed.operationId) || null,
      createdAt: (meta.parsed && meta.parsed.createdAt) || null,
    }));
    return true;
  }

  function tryRecoverLock() {
    const meta = readLockMeta();
    if (meta.missing) return true;

    const nowMs = Date.now();
    const age = lockAgeMs(lockPath, meta.parsed, meta.stat, nowMs);
    const stale = age > lockOpts.staleMs;
    const pid = meta.parsed && typeof meta.parsed.pid === "number" ? meta.parsed.pid : undefined;
    const alive = pid !== undefined ? isProcessAlive(pid) : null;

    if (alive === true) return false;
    if (alive === null && pid !== undefined) return false;
    if (alive === false) return recoverStaleLock(meta);
    if (stale && (alive === false || pid === undefined)) return recoverStaleLock(meta);
    return false;
  }

  function withStoreLock(fn) {
    const start = Date.now();
    for (;;) {
      if (inProcessLocked) {
        if (Date.now() - start >= lockOpts.maxWaitMs) {
          throw new StoreLockError("store is locked");
        }
        sleepSync(lockOpts.retryMs);
        continue;
      }

      inProcessLocked = true;
      let fd;
      try {
        ensureDir(predictionsPath);
        try {
          fd = fs.openSync(lockPath, "wx");
        } catch (err) {
          inProcessLocked = false;
          if (err && err.code === "EEXIST") {
            let recovered = false;
            try {
              recovered = tryRecoverLock();
            } catch (recoverErr) {
              if (Date.now() - start >= lockOpts.maxWaitMs) {
                throw new StoreLockError("store is locked");
              }
              throw recoverErr;
            }
            if (Date.now() - start >= lockOpts.maxWaitMs) {
              throw new StoreLockError("store is locked");
            }
            if (!recovered) sleepSync(lockOpts.retryMs);
            continue;
          }
          throw err;
        }

        const payload = JSON.stringify({
          pid: process.pid,
          createdAt: new Date().toISOString(),
          operationId: crypto.randomUUID(),
        });
        fs.writeFileSync(lockPath, payload, "utf8");
        return fn();
      } finally {
        if (fd !== undefined) {
          try { fs.closeSync(fd); } catch { /* ignore */ }
          try {
            fs.unlinkSync(lockPath);
          } catch (err) {
            inProcessLocked = false;
            throw err;
          }
        }
        inProcessLocked = false;
      }
    }
  }

  function atomicWrite(filePath, contents) {
    ensureDir(filePath);
    const tmpPath = `${filePath}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(tmpPath, contents, "utf8");
    try {
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      throw err;
    }
  }

  function backupIfExists(filePath) {
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, `${filePath}.bak`);
    }
  }

  function restoreFromBak(filePath, hadOriginal) {
    const bakPath = `${filePath}.bak`;
    if (hadOriginal && fs.existsSync(bakPath)) {
      fs.copyFileSync(bakPath, filePath);
      return;
    }
    if (!hadOriginal && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    }
  }

  function parseJsonFile(filePath, kind) {
    let raw;
    try {
      raw = fs.readFileSync(filePath, "utf8");
    } catch (err) {
      if (err && err.code === "ENOENT") return undefined;
      throw err;
    }
    try {
      return JSON.parse(raw);
    } catch {
      throw new CorruptedJsonError(`corrupted ${kind} JSON: ${filePath}`);
    }
  }

  function readPredictionsUnlocked() {
    if (!fs.existsSync(predictionsPath)) return [];
    const data = parseJsonFile(predictionsPath, "predictions");
    if (!Array.isArray(data)) {
      throw new CorruptedJsonError(`predictions must be an array: ${predictionsPath}`);
    }
    return data;
  }

  function readModelUnlocked() {
    if (!fs.existsSync(modelPath)) return null;
    const data = parseJsonFile(modelPath, "model");
    if (data === null || Array.isArray(data) || typeof data !== "object") {
      throw new CorruptedJsonError(`model must be a non-null object: ${modelPath}`);
    }
    return data;
  }

  function writePredictionsUnlocked(preds) {
    predictionsWriteCount += 1;
    backupIfExists(predictionsPath);
    if (failOnWrite && failOnWrite.predictions === predictionsWriteCount) {
      throw new Error("failOnWrite predictions");
    }
    atomicWrite(predictionsPath, JSON.stringify(preds, null, 2));
    if (typeof onAfterPredictionsWrite === "function") {
      onAfterPredictionsWrite(predictionsWriteCount);
    }
  }

  function writeModelUnlocked(nextModel) {
    modelWriteCount += 1;
    backupIfExists(modelPath);
    if (failNextModel) {
      failNextModel = false;
      throw new Error("failNextModelWrite");
    }
    if (failOnWrite && failOnWrite.model === modelWriteCount) {
      throw new Error("failOnWrite model");
    }
    atomicWrite(modelPath, JSON.stringify(nextModel, null, 2));
  }

  return {
    getPrediction(id) {
      const found = readPredictionsUnlocked().find((p) => matchesId(p, id));
      return found ? clone(found) : null;
    },

    listPendingPredictions() {
      return readPredictionsUnlocked().filter((p) => !isSettled(p)).map(clone);
    },

    savePrediction(record) {
      try {
        withStoreLock(() => {
          const preds = readPredictionsUnlocked();
          const copy = clone(record);
          const id = copy.predictionId || copy.id;
          const idx = findIndex(preds, id);
          if (idx >= 0) preds[idx] = copy;
          else preds.push(copy);
          writePredictionsUnlocked(preds);
        });
        return Promise.resolve();
      } catch (err) {
        if (err instanceof StoreLockError || (err && err.code === "STORE_BUSY")) {
          throw err;
        }
        return Promise.reject(err);
      }
    },

    updatePredictionEvaluation(id, evaluation) {
      return withStoreLock(() => {
        const preds = readPredictionsUnlocked();
        const idx = findIndex(preds, id);
        if (idx < 0) return null;
        if (isSettled(preds[idx])) return clone(preds[idx]);
        preds[idx] = { ...clone(preds[idx]), ...clone(evaluation) };
        writePredictionsUnlocked(preds);
        return clone(preds[idx]);
      });
    },

    getModel() {
      return clone(readModelUnlocked());
    },

    saveModel(nextModel) {
      try {
        withStoreLock(() => {
          writeModelUnlocked(clone(nextModel));
        });
        return Promise.resolve();
      } catch (err) {
        return Promise.reject(err);
      }
    },

    listPredictions() {
      return readPredictionsUnlocked().map(clone);
    },

    commitMaturedBatch(nextPredictions, nextModel) {
      const predCopy = clone(nextPredictions) || [];
      const modelCopy = clone(nextModel);
      try {
        withStoreLock(() => {
          const hadPred = fs.existsSync(predictionsPath);
          const hadModel = fs.existsSync(modelPath);
          try {
            writePredictionsUnlocked(predCopy);
            writeModelUnlocked(modelCopy);
          } catch (err) {
            try { restoreFromBak(predictionsPath, hadPred); } catch { /* still throw original */ }
            try { restoreFromBak(modelPath, hadModel); } catch { /* still throw original */ }
            throw err;
          }
        });
        return Promise.resolve();
      } catch (err) {
        return Promise.reject(err);
      }
    },

    commitPredictions(nextPredictions) {
      const predCopy = clone(nextPredictions) || [];
      try {
        withStoreLock(() => {
          const hadPred = fs.existsSync(predictionsPath);
          try {
            writePredictionsUnlocked(predCopy);
          } catch (err) {
            try { restoreFromBak(predictionsPath, hadPred); } catch { /* still throw original */ }
            throw err;
          }
        });
        return Promise.resolve();
      } catch (err) {
        return Promise.reject(err);
      }
    },

    holdLockSync(fn) {
      return withStoreLock(() => fn());
    },
  };
}

module.exports = { createJsonFileStore };
