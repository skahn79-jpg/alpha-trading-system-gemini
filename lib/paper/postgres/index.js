"use strict";

/**
 * GATE 12AK-R41 — public Paper PostgreSQL primitives surface.
 * Import-safe without env (config is lazy via getPaperRuntimeDatabaseConfig).
 */

const {
  PAPER_DB_ERROR_CODES,
  PaperDbError,
  mapPgError,
  sanitizePublicMessage,
} = require("./paper-db-error");

const {
  RUNTIME_SECRET_NAME,
  APPLICATION_ROLE_CONTRACT,
  getPaperRuntimeDatabaseConfig,
} = require("./runtime-db-config");

const { createPaperPgPool, endPaperPgPool } = require("./pg-pool");

const {
  BEGIN_SQL,
  ISOLATION_SQL,
  STATEMENT_TIMEOUT_SQL,
  COMMIT_SQL,
  ROLLBACK_SQL,
  withPaperTransaction,
} = require("./paper-transaction");

const { moneyToDecimalString, bigintToCanonical } = require("./paper-db-codec");

module.exports = {
  PAPER_DB_ERROR_CODES,
  PaperDbError,
  mapPgError,
  sanitizePublicMessage,
  RUNTIME_SECRET_NAME,
  APPLICATION_ROLE_CONTRACT,
  getPaperRuntimeDatabaseConfig,
  createPaperPgPool,
  endPaperPgPool,
  BEGIN_SQL,
  ISOLATION_SQL,
  STATEMENT_TIMEOUT_SQL,
  COMMIT_SQL,
  ROLLBACK_SQL,
  withPaperTransaction,
  moneyToDecimalString,
  bigintToCanonical,
};
