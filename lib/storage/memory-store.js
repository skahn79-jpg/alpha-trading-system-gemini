/**
 * 인메모리 StoragePort.
 * 외부에 반환하는 값은 복사본이다.
 * PRICE_EVALUATED / MODEL_UPDATE_PENDING 은 pending (isSettled 아님).
 */

"use strict";

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

function createMemoryStore({
  predictions,
  model,
  failOnWrite,
  onAfterPredictionsWrite,
  failNextModelWrite,
} = {}) {
  let preds = Array.isArray(predictions) ? clone(predictions) : [];
  let mdl = model === undefined ? null : clone(model);
  let predictionsWriteCount = 0;
  let modelWriteCount = 0;
  let failNextModel = !!failNextModelWrite;

  function writePredictions(next) {
    predictionsWriteCount += 1;
    if (failOnWrite && failOnWrite.predictions === predictionsWriteCount) {
      throw new Error("failOnWrite predictions");
    }
    preds = clone(next) || [];
    if (typeof onAfterPredictionsWrite === "function") {
      onAfterPredictionsWrite(predictionsWriteCount);
    }
  }

  function writeModel(nextModel) {
    modelWriteCount += 1;
    if (failNextModel) {
      failNextModel = false;
      throw new Error("failNextModelWrite");
    }
    if (failOnWrite && failOnWrite.model === modelWriteCount) {
      throw new Error("failOnWrite model");
    }
    mdl = clone(nextModel);
  }

  return {
    getPrediction(id) {
      const found = preds.find((p) => matchesId(p, id));
      return found ? clone(found) : null;
    },

    listPendingPredictions() {
      return preds.filter((p) => !isSettled(p)).map(clone);
    },

    savePrediction(record) {
      try {
        const copy = clone(record);
        const id = copy.predictionId || copy.id;
        const next = preds.map(clone);
        const idx = findIndex(next, id);
        if (idx >= 0) next[idx] = copy;
        else next.push(copy);
        writePredictions(next);
        return Promise.resolve();
      } catch (err) {
        return Promise.reject(err);
      }
    },

    updatePredictionEvaluation(id, evaluation) {
      const idx = findIndex(preds, id);
      if (idx < 0) return null;
      if (isSettled(preds[idx])) return clone(preds[idx]);
      const next = preds.map(clone);
      next[idx] = { ...clone(next[idx]), ...clone(evaluation) };
      writePredictions(next);
      return clone(next[idx]);
    },

    getModel() {
      return clone(mdl);
    },

    saveModel(nextModel) {
      try {
        writeModel(nextModel);
        return Promise.resolve();
      } catch (err) {
        return Promise.reject(err);
      }
    },

    listPredictions() {
      return preds.map(clone);
    },

    commitMaturedBatch(nextPredictions, nextModel) {
      try {
        writePredictions(nextPredictions);
        writeModel(nextModel);
        return Promise.resolve();
      } catch (err) {
        return Promise.reject(err);
      }
    },

    commitPredictions(nextPredictions) {
      try {
        writePredictions(nextPredictions);
        return Promise.resolve();
      } catch (err) {
        return Promise.reject(err);
      }
    },
  };
}

module.exports = { createMemoryStore };
