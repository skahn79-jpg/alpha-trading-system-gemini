"use strict";

/**
 * GATE 12AK-R41 — Paper PostgreSQL transaction helper.
 * Never uses pool.query for transaction statements.
 * Never auto-retries. No Promise.race timeout.
 */

const {
  PaperDbError,
  PAPER_DB_ERROR_CODES,
  mapPgError,
  sanitizePublicMessage,
} = require("./paper-db-error");

const BEGIN_SQL = "BEGIN";
const ISOLATION_SQL = "SET TRANSACTION ISOLATION LEVEL READ COMMITTED";
const STATEMENT_TIMEOUT_SQL = "SET LOCAL statement_timeout = '5000ms'";
const COMMIT_SQL = "COMMIT";
const ROLLBACK_SQL = "ROLLBACK";

/**
 * @param {{ connect: () => Promise<{ query: Function, release: Function }> }} pool
 * @param {(client: { query: Function, release: Function }) => Promise<*>|*} fn
 * @returns {Promise<*>}
 */
async function withPaperTransaction(pool, fn) {
  const client = await pool.connect();
  let released = false;

  function releaseOnce() {
    if (released) return;
    released = true;
    if (typeof client.release === "function") {
      client.release();
    }
  }

  let began = false;
  let commitAttempted = false;

  try {
    try {
      await client.query(BEGIN_SQL);
      began = true;
      await client.query(ISOLATION_SQL);
      await client.query(STATEMENT_TIMEOUT_SQL);
      const result = await fn(client);
      commitAttempted = true;
      try {
        await client.query(COMMIT_SQL);
      } catch (commitErr) {
        const rawMessage =
          commitErr &&
          typeof commitErr === "object" &&
          typeof commitErr.message === "string"
            ? commitErr.message
            : "commit failed";
        throw new PaperDbError(
          PAPER_DB_ERROR_CODES.DB_COMMIT_UNKNOWN,
          sanitizePublicMessage(rawMessage),
          { cause: commitErr }
        );
      }
      return result;
    } catch (err) {
      if (
        err instanceof PaperDbError &&
        err.code === PAPER_DB_ERROR_CODES.DB_COMMIT_UNKNOWN
      ) {
        throw err;
      }

      if (began && !commitAttempted) {
        try {
          await client.query(ROLLBACK_SQL);
        } catch (rollbackErr) {
          throw new PaperDbError(
            PAPER_DB_ERROR_CODES.DB_INTERNAL,
            "rollback failed after operation error",
            {
              cause: err,
              details: { rollbackCause: rollbackErr },
            }
          );
        }
      }

      throw mapPgError(err);
    }
  } finally {
    releaseOnce();
  }
}

module.exports = {
  BEGIN_SQL,
  ISOLATION_SQL,
  STATEMENT_TIMEOUT_SQL,
  COMMIT_SQL,
  ROLLBACK_SQL,
  withPaperTransaction,
};
