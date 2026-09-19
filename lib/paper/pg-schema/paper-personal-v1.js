"use strict";

/**
 * GATE 12AK-R31 — dormant paper-personal-v1 PostgreSQL schema surface.
 * Reads SQL text from disk. Pure analyzers only.
 * No `pg` client. No network. No migration apply. No Paper/Live enablement.
 * Not wired into runtime migration.
 */

const fs = require("node:fs");
const path = require("node:path");

const SCHEMA_CONTRACT_ID = "paper-personal-v1";
const VERSION = 1;
const GATE_ID = "12AK-R31";
const SQL_FILE_NAME = "paper-personal-v1.sql";

const REQUIRED_TABLES = Object.freeze([
  "paper_schema_version",
  "paper_runtime_authority",
  "paper_account_state",
  "paper_position",
  "paper_order_intent",
  "paper_idempotency_record",
  "paper_execution_record",
  "paper_ledger_entry",
  "paper_kill_switch",
]);

const ORDER_INTENT_STATUSES = Object.freeze([
  "CREATED",
  "RISK_BLOCKED",
  "AWAITING_APPROVAL",
  "APPROVED",
  "EXECUTION_PENDING",
  "FILLED",
  "CANCELLED",
  "FAILED",
  "UNKNOWN",
]);

const EXECUTION_STATUSES = Object.freeze([
  "PENDING",
  "FILLED",
  "BLOCKED",
  "FAILED",
  "UNKNOWN",
]);

const IDEMPOTENCY_STATUSES = Object.freeze(["OPEN", "COMPLETED", "CONFLICT"]);

const LEDGER_ENTRY_TYPES = Object.freeze([
  "CASH_DEBIT",
  "CASH_CREDIT",
  "POSITION_INCREASE",
  "POSITION_DECREASE",
  "REALIZED_PNL",
  "FEE",
  "TAX",
  "ADJUSTMENT",
]);

const MARKETS = Object.freeze([
  "KOSPI",
  "KOSDAQ",
  "SYNTHETIC_KOSPI",
  "SYNTHETIC_KOSDAQ",
]);

const FORBIDDEN_FLOAT_TYPES = Object.freeze([
  "REAL",
  "DOUBLE PRECISION",
  "FLOAT",
  "FLOAT4",
  "FLOAT8",
  "MONEY",
]);

const LEGACY_RANGE_COLUMNS = Object.freeze([
  "external_reservation_id",
  "authority_generation_id",
  "range_start",
  "range_end",
  "range_state",
  "authority_store_id",
  "active_range_start",
  "active_range_end",
  "last_issued_fence",
  "current_active_fence",
]);

function sqlFilePath() {
  return path.join(__dirname, SQL_FILE_NAME);
}

function personalV1SqlFilePath() {
  return sqlFilePath();
}

function loadPersonalV1SchemaSql() {
  return fs.readFileSync(sqlFilePath(), "utf8");
}

function stripSqlComments(sql) {
  return String(sql || "")
    .replace(/\/\*[\s\S]*?\*\//g, "\n")
    .replace(/--[^\n]*/g, "\n");
}

function normalizeWs(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function extractCreateTableBody(sql, tableName) {
  const raw = String(sql || "");
  const re = new RegExp(
    "CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?" + tableName + "\\s*\\(",
    "i"
  );
  const m = re.exec(raw);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return raw.slice(m.index, i + 1);
    }
    i += 1;
  }
  return null;
}

function listCreateTableNames(sql) {
  const names = [];
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)/gi;
  let m;
  const src = stripSqlComments(sql);
  while ((m = re.exec(src)) !== null) names.push(m[1]);
  return names;
}

function hasColumn(tableSql, columnName) {
  if (!tableSql) return false;
  const re = new RegExp("(?:^|[,\\s(])" + columnName + "\\s+", "im");
  return re.test(tableSql);
}

function collectCheckConstraints(tableSql) {
  if (!tableSql) return [];
  const out = [];
  const re = /CHECK\s*\(/gi;
  let m;
  while ((m = re.exec(tableSql)) !== null) {
    let i = m.index + m[0].length;
    let depth = 1;
    const start = m.index;
    while (i < tableSql.length) {
      const ch = tableSql[i];
      if (ch === "(") depth += 1;
      else if (ch === ")") {
        depth -= 1;
        if (depth === 0) {
          out.push(normalizeWs(tableSql.slice(start, i + 1)));
          break;
        }
      }
      i += 1;
    }
  }
  return out;
}

function hasUniqueOnColumns(tableSql, columns) {
  if (!tableSql) return false;
  const checks = [];
  const uniqRe = /UNIQUE\s*\(([^)]+)\)/gi;
  let m;
  while ((m = uniqRe.exec(tableSql)) !== null) {
    checks.push(m[1].split(",").map((s) => s.trim().toLowerCase()));
  }
  const pkRe = /PRIMARY\s+KEY\s*\(([^)]+)\)/gi;
  while ((m = pkRe.exec(tableSql)) !== null) {
    checks.push(m[1].split(",").map((s) => s.trim().toLowerCase()));
  }
  const want = columns.map((c) => c.toLowerCase());
  return checks.some((cols) => {
    if (cols.length !== want.length) return false;
    for (let i = 0; i < want.length; i += 1) {
      if (cols[i] !== want[i]) return false;
    }
    return true;
  });
}

function analyzePersonalV1Schema(sqlText) {
  const sql = String(sqlText || "");
  const stripped = stripSqlComments(sql);
  const tables = {};
  for (let i = 0; i < REQUIRED_TABLES.length; i += 1) {
    const name = REQUIRED_TABLES[i];
    tables[name] = extractCreateTableBody(sql, name);
  }

  const forbiddenFloat = FORBIDDEN_FLOAT_TYPES.filter((t) => {
    const re = new RegExp("\\b" + t.replace(" ", "\\s+") + "\\b", "i");
    return re.test(stripped);
  });

  const legacyCols = LEGACY_RANGE_COLUMNS.filter((c) => {
    const re = new RegExp("\\b" + c + "\\b", "i");
    return re.test(stripped);
  });

  const hasIfNotExists = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i.test(stripped);
  const hasOnConflictNothing = /ON\s+CONFLICT\s+DO\s+NOTHING/i.test(stripped);
  const hasCascade = /ON\s+DELETE\s+CASCADE/i.test(stripped);
  const hasDrop = /\bDROP\s+(TABLE|SCHEMA|INDEX)\b/i.test(stripped);
  const hasTruncate = /\bTRUNCATE\b/i.test(stripped);
  const hasExtension = /\bCREATE\s+EXTENSION\b/i.test(stripped);
  const hasProcedure =
    /\bCREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE)\b/i.test(stripped);
  const hasTrigger = /\bCREATE\s+(CONSTRAINT\s+)?TRIGGER\b/i.test(stripped);
  const hasDynamo = /dynamo|aws-sdk|@aws-sdk|DynamoDB/i.test(stripped);

  const ledgerIndex =
    /CREATE\s+UNIQUE\s+INDEX\s+uq_paper_ledger_execution_effect\b/i.test(stripped) &&
    /COALESCE\s*\(\s*market\s*,\s*''\s*\)/i.test(stripped) &&
    /COALESCE\s*\(\s*symbol\s*,\s*''\s*\)/i.test(stripped);

  const killBootstrap =
    /INSERT\s+INTO\s+paper_kill_switch[\s\S]*'paper-kill-v1'[\s\S]*'EXECUTION_DISABLED'/i.test(
      sql
    );

  const schemaBootstrap =
    /INSERT\s+INTO\s+paper_schema_version[\s\S]*'paper-personal-v1'[\s\S]*,\s*1\s*,/i.test(
      sql
    );

  const runtimeBootstrap =
    /INSERT\s+INTO\s+paper_runtime_authority[\s\S]*'paper-runtime-v1'/i.test(sql) &&
    /revision[\s\S]*0/i.test(sql);

  const accountInsert =
    /INSERT\s+INTO\s+paper_account_state\b/i.test(stripped);

  const numericMoneyCount = (stripped.match(/NUMERIC\s*\(\s*20\s*,\s*4\s*\)/gi) || [])
    .length;

  return Object.freeze({
    schemaContractId: SCHEMA_CONTRACT_ID,
    version: VERSION,
    gateId: GATE_ID,
    headerDormant: /DORMANT/i.test(sql) && /DO NOT EXECUTE/i.test(sql),
    headerGate: /12AK-R31/i.test(sql),
    headerContractId: /paper-personal-v1/.test(sql),
    createTableNames: listCreateTableNames(sql),
    tables,
    forbiddenFloatTypesFound: forbiddenFloat,
    legacyRangeColumnsFound: legacyCols,
    hasIfNotExists,
    hasOnConflictNothing,
    hasUnsafeCascade: hasCascade,
    hasDrop,
    hasTruncate,
    hasExtension,
    hasProcedure,
    hasTrigger,
    hasDynamo,
    hasLedgerUniqueExpressionIndex: ledgerIndex,
    hasKillSwitchDisabledBootstrap: killBootstrap,
    hasSchemaVersionBootstrap: schemaBootstrap,
    hasRuntimeAuthorityBootstrap: runtimeBootstrap,
    hasAccountBootstrapInsert: accountInsert,
    numericMoneyCount,
    positionHasCompositePk: hasUniqueOnColumns(tables.paper_position, [
      "paper_account_id",
      "market",
      "symbol",
    ]),
    executionHasIntentUnique: hasUniqueOnColumns(tables.paper_execution_record, [
      "order_intent_id",
    ]),
    idempotencyHasCompositePk: hasUniqueOnColumns(tables.paper_idempotency_record, [
      "paper_account_id",
      "idempotency_key",
    ]),
  });
}

function assertPersonalV1SchemaContract(sqlText) {
  const a = analyzePersonalV1Schema(
    sqlText == null ? loadPersonalV1SchemaSql() : sqlText
  );
  const errors = [];
  if (a.schemaContractId !== "paper-personal-v1") errors.push("SCHEMA_CONTRACT_ID");
  if (a.version !== 1) errors.push("VERSION");
  if (!a.headerDormant) errors.push("DORMANT_HEADER");
  if (!a.headerGate) errors.push("GATE_HEADER");
  for (let i = 0; i < REQUIRED_TABLES.length; i += 1) {
    const t = REQUIRED_TABLES[i];
    if (!a.tables[t]) errors.push("MISSING_TABLE:" + t);
  }
  if (a.forbiddenFloatTypesFound.length) errors.push("FLOAT_TYPES");
  if (a.legacyRangeColumnsFound.length) errors.push("LEGACY_RANGE");
  if (a.hasIfNotExists) errors.push("IF_NOT_EXISTS");
  if (a.hasOnConflictNothing) errors.push("ON_CONFLICT_DO_NOTHING");
  if (a.hasUnsafeCascade) errors.push("UNSAFE_CASCADE");
  if (a.hasDrop || a.hasTruncate) errors.push("DESTRUCTIVE_DDL");
  if (a.hasExtension) errors.push("CREATE_EXTENSION");
  if (a.hasProcedure) errors.push("STORED_PROCEDURE");
  if (a.hasTrigger) errors.push("TRIGGER");
  if (a.hasDynamo) errors.push("DYNAMO");
  if (!a.hasLedgerUniqueExpressionIndex) errors.push("LEDGER_UNIQUE_INDEX");
  if (!a.hasKillSwitchDisabledBootstrap) errors.push("KILL_BOOTSTRAP");
  if (!a.hasSchemaVersionBootstrap) errors.push("SCHEMA_BOOTSTRAP");
  if (!a.hasRuntimeAuthorityBootstrap) errors.push("RUNTIME_BOOTSTRAP");
  if (a.hasAccountBootstrapInsert) errors.push("ACCOUNT_BOOTSTRAP");
  if (!a.positionHasCompositePk) errors.push("POSITION_PK");
  if (!a.executionHasIntentUnique) errors.push("EXECUTION_UQ");
  if (!a.idempotencyHasCompositePk) errors.push("IDEMPOTENCY_PK");
  if (errors.length) {
    const err = new Error("PERSONAL_V1_SCHEMA_CONTRACT_INVALID: " + errors.join(","));
    err.code = "PERSONAL_V1_SCHEMA_CONTRACT_INVALID";
    err.errors = errors;
    throw err;
  }
  return a;
}

module.exports = {
  SCHEMA_CONTRACT_ID,
  VERSION,
  GATE_ID,
  SQL_FILE_NAME,
  REQUIRED_TABLES,
  ORDER_INTENT_STATUSES,
  EXECUTION_STATUSES,
  IDEMPOTENCY_STATUSES,
  LEDGER_ENTRY_TYPES,
  MARKETS,
  FORBIDDEN_FLOAT_TYPES,
  LEGACY_RANGE_COLUMNS,
  sqlFilePath,
  personalV1SqlFilePath: sqlFilePath,
  loadPersonalV1SchemaSql,
  stripSqlComments,
  extractCreateTableBody,
  listCreateTableNames,
  hasColumn,
  collectCheckConstraints,
  hasUniqueOnColumns,
  analyzePersonalV1Schema,
  assertPersonalV1SchemaContract,
};
