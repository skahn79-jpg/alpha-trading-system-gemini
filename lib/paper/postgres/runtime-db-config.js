"use strict";

/**
 * GATE 12AK-R41 — runtime Paper DB connection config parser.
 * Env name literal only: PAPER_DATABASE_URL_RUNTIME
 * Never reads migration-role connection secrets.
 * Module import must NOT throw.
 */

const {
  PaperDbError,
  PAPER_DB_ERROR_CODES,
} = require("./paper-db-error");

const RUNTIME_SECRET_NAME = "PAPER_DATABASE_URL_RUNTIME";
const APPLICATION_ROLE_CONTRACT = "paper_runtime";

const ALLOWED_SSL_MODES = new Set([
  "require",
  "verify-ca",
  "verify-full",
]);

const REJECTED_SSL_MODES = new Set(["disable", "allow", "prefer"]);

function configInvalid(message) {
  throw new PaperDbError(PAPER_DB_ERROR_CODES.DB_CONFIG_INVALID, message);
}

function readQueryParam(searchParams, name) {
  if (!searchParams || typeof searchParams.get !== "function") return null;
  const value = searchParams.get(name);
  return value == null ? null : String(value).toLowerCase();
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{
 *   connectionString: string,
 *   applicationRoleContract: 'paper_runtime',
 *   poolMax: 2,
 *   connectionTimeoutMillis: 5000,
 *   idleTimeoutMillis: 10000,
 *   statementTimeoutMs: 5000
 * }}
 */
function getPaperRuntimeDatabaseConfig(env) {
  const source = env && typeof env === "object" ? env : process.env;
  const raw = source[RUNTIME_SECRET_NAME];

  if (raw == null || String(raw).trim() === "") {
    configInvalid("PAPER_DATABASE_URL_RUNTIME is missing");
  }

  const connectionString = String(raw).trim();

  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    configInvalid("PAPER_DATABASE_URL_RUNTIME is not a valid URL");
  }

  const protocol = String(parsed.protocol || "").toLowerCase();
  if (protocol !== "postgres:" && protocol !== "postgresql:") {
    configInvalid("PAPER_DATABASE_URL_RUNTIME protocol must be postgres or postgresql");
  }

  const username = parsed.username ? decodeURIComponent(parsed.username) : "";
  if (!username) {
    configInvalid("PAPER_DATABASE_URL_RUNTIME username is required");
  }
  // Exact role match only — never rewrite username; never echo credentials.
  if (username !== APPLICATION_ROLE_CONTRACT) {
    configInvalid("runtime database role is invalid");
  }

  const hostname = parsed.hostname ? String(parsed.hostname) : "";
  if (!hostname) {
    configInvalid("PAPER_DATABASE_URL_RUNTIME hostname is required");
  }

  const database = parsed.pathname
    ? decodeURIComponent(parsed.pathname.replace(/^\//, ""))
    : "";
  if (!database) {
    configInvalid("PAPER_DATABASE_URL_RUNTIME database name is required");
  }

  const sslmode =
    readQueryParam(parsed.searchParams, "sslmode") ||
    readQueryParam(parsed.searchParams, "sslMode");

  if (!sslmode) {
    configInvalid(
      "PAPER_DATABASE_URL_RUNTIME sslmode is required (require|verify-ca|verify-full)"
    );
  }
  if (REJECTED_SSL_MODES.has(sslmode)) {
    configInvalid(
      "PAPER_DATABASE_URL_RUNTIME sslmode disable|allow|prefer is rejected"
    );
  }
  if (!ALLOWED_SSL_MODES.has(sslmode)) {
    configInvalid(
      "PAPER_DATABASE_URL_RUNTIME sslmode must be require|verify-ca|verify-full"
    );
  }

  return {
    connectionString,
    applicationRoleContract: APPLICATION_ROLE_CONTRACT,
    poolMax: 2,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    statementTimeoutMs: 5000,
  };
}

module.exports = {
  RUNTIME_SECRET_NAME,
  APPLICATION_ROLE_CONTRACT,
  getPaperRuntimeDatabaseConfig,
};
