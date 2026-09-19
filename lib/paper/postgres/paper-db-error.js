"use strict";

/**
 * GATE 12AK-R41 — Paper PostgreSQL repository error taxonomy + SQLSTATE mapper.
 * No network. No secrets in public messages.
 */

const PAPER_DB_ERROR_CODES = Object.freeze({
  DB_UNAVAILABLE: "DB_UNAVAILABLE",
  DB_TIMEOUT: "DB_TIMEOUT",
  DB_CONSTRAINT_VIOLATION: "DB_CONSTRAINT_VIOLATION",
  DB_REVISION_CONFLICT: "DB_REVISION_CONFLICT",
  DB_IDEMPOTENCY_CONFLICT: "DB_IDEMPOTENCY_CONFLICT",
  DB_AUTHORITY_CONFLICT: "DB_AUTHORITY_CONFLICT",
  DB_LEASE_CONFLICT: "DB_LEASE_CONFLICT",
  DB_KILL_SWITCH_BLOCKED: "DB_KILL_SWITCH_BLOCKED",
  DB_COMMIT_UNKNOWN: "DB_COMMIT_UNKNOWN",
  DB_SCHEMA_MISMATCH: "DB_SCHEMA_MISMATCH",
  DB_NONFINITE_OR_INVALID_MONEY: "DB_NONFINITE_OR_INVALID_MONEY",
  DB_INVALID_BIGINT: "DB_INVALID_BIGINT",
  DB_INTERNAL: "DB_INTERNAL",
  DB_CONFIG_INVALID: "DB_CONFIG_INVALID",
});

function sanitizePublicMessage(message) {
  if (message == null) return "database error";
  let text = String(message);
  text = text.replace(/(?:postgres(?:ql)?:\/\/)[^\s]+/gi, "[redacted]");
  text = text.replace(/password[=:]\s*\S+/gi, "password=[redacted]");
  text = text.replace(/\/\/([^:@/\s]+):([^@/\s]+)@/g, "//$1:[redacted]@");
  return text;
}

class PaperDbError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ sqlState?: string|null, constraint?: string|null, cause?: unknown, details?: object|null }} [opts]
   */
  constructor(code, message, opts) {
    const options = opts && typeof opts === "object" ? opts : {};
    super(sanitizePublicMessage(message || code));
    this.name = "PaperDbError";
    this.code = code;
    this.sqlState =
      options.sqlState === undefined || options.sqlState === null
        ? null
        : String(options.sqlState);
    this.constraint =
      options.constraint === undefined || options.constraint === null
        ? null
        : String(options.constraint);
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
    this.details =
      options.details && typeof options.details === "object"
        ? options.details
        : null;
  }
}

function extractSqlState(err) {
  if (!err || typeof err !== "object") return null;
  if (typeof err.code === "string" && /^[0-9A-Z]{5}$/i.test(err.code)) {
    return err.code.toUpperCase();
  }
  if (typeof err.sqlState === "string" && /^[0-9A-Z]{5}$/i.test(err.sqlState)) {
    return err.sqlState.toUpperCase();
  }
  return null;
}

/**
 * Map a node-postgres / driver error into PaperDbError.
 * 23505 maps to DB_IDEMPOTENCY_CONFLICT only when context.intent === 'idempotency'.
 *
 * @param {unknown} err
 * @param {{ intent?: string }} [context]
 * @returns {PaperDbError}
 */
function mapPgError(err, context) {
  if (err instanceof PaperDbError) {
    return err;
  }

  const ctx = context && typeof context === "object" ? context : {};
  const sqlState = extractSqlState(err);
  const constraint =
    err && typeof err === "object" && err.constraint != null
      ? String(err.constraint)
      : null;
  const rawMessage =
    err && typeof err === "object" && typeof err.message === "string"
      ? err.message
      : "database error";
  const safeMessage = sanitizePublicMessage(rawMessage);

  let code = PAPER_DB_ERROR_CODES.DB_INTERNAL;

  if (sqlState) {
    if (sqlState.startsWith("08") || sqlState === "57P01") {
      code = PAPER_DB_ERROR_CODES.DB_UNAVAILABLE;
    } else if (sqlState === "57014") {
      code = PAPER_DB_ERROR_CODES.DB_TIMEOUT;
    } else if (sqlState === "40001" || sqlState === "40P01") {
      code = PAPER_DB_ERROR_CODES.DB_AUTHORITY_CONFLICT;
    } else if (
      sqlState === "23505" ||
      sqlState === "23503" ||
      sqlState === "23514"
    ) {
      if (sqlState === "23505" && ctx.intent === "idempotency") {
        code = PAPER_DB_ERROR_CODES.DB_IDEMPOTENCY_CONFLICT;
      } else {
        code = PAPER_DB_ERROR_CODES.DB_CONSTRAINT_VIOLATION;
      }
    }
  }

  return new PaperDbError(code, safeMessage, {
    sqlState,
    constraint,
    cause: err,
  });
}

module.exports = {
  PAPER_DB_ERROR_CODES,
  PaperDbError,
  mapPgError,
  sanitizePublicMessage,
};
