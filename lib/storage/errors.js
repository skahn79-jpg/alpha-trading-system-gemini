"use strict";

class CorruptedJsonError extends Error {
  constructor(message) {
    super(message);
    this.name = "CorruptedJsonError";
  }
}

class StoreLockError extends Error {
  constructor(message) {
    super(message);
    this.name = "StoreLockError";
    this.code = "STORE_BUSY";
  }
}

module.exports = { CorruptedJsonError, StoreLockError };
