"use strict";

const { createMemoryStore } = require("./memory-store");
const { createJsonFileStore } = require("./json-file-store");
const { CorruptedJsonError, StoreLockError } = require("./errors");
const {
  createArchivePolicy,
  planArchive,
  archiveEvaluatedRecords,
} = require("./archive");

module.exports = {
  createMemoryStore,
  createJsonFileStore,
  CorruptedJsonError,
  StoreLockError,
  createArchivePolicy,
  planArchive,
  archiveEvaluatedRecords,
};
