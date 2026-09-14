"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const personal = require("../lib/paper/pg-schema/paper-personal-v1");
const {
  SCHEMA_CONTRACT_ID,
  VERSION,
  GATE_ID,
  REQUIRED_TABLES,
  ORDER_INTENT_STATUSES,
  EXECUTION_STATUSES,
  IDEMPOTENCY_STATUSES,
  LEDGER_ENTRY_TYPES,
  FORBIDDEN_FLOAT_TYPES,
  LEGACY_RANGE_COLUMNS,
  sqlFilePath,
  loadPersonalV1SchemaSql,
  stripSqlComments,
  extractCreateTableBody,
  hasUniqueOnColumns,
  analyzePersonalV1Schema,
  assertPersonalV1SchemaContract,
} = personal;

const sql = loadPersonalV1SchemaSql();
const stripped = stripSqlComments(sql);
const analysis = analyzePersonalV1Schema(sql);

const I4_SQL_PATH = path.join(
  __dirname,
  "../lib/paper/pg-schema/paper-shared-authority-v1.sql"
);
const I4_EXPECTED_SHA256 =
  "22e63d3f7b096407d52785b995acf901b218965d733f9c68dbbb83b8ab48cdfa";

const INDEX_JS_PATH = path.join(__dirname, "../lib/paper/pg-schema/index.js");
const INDEX_EXPECTED_SHA256 =
  "623ba7e9b9f389b2dd8c5e0b306fa344d19c57b196e5821fb065a24bef5c3e38";

function sha256File(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

test("R31-01 personal-v1 SQL exists and is loadable", () => {
  assert.equal(path.basename(sqlFilePath()), "paper-personal-v1.sql");
  assert.equal(fs.existsSync(sqlFilePath()), true);
  assert.equal(typeof sql, "string");
  assert.ok(sql.length > 500);
  assert.match(sql, /DORMANT/i);
  assert.match(sql, /DO NOT EXECUTE/i);
  assert.match(sql, /12AK-R31/);
});

test("R31-02 historical I4 SQL unchanged (sha256)", () => {
  assert.equal(fs.existsSync(I4_SQL_PATH), true);
  assert.equal(sha256File(I4_SQL_PATH), I4_EXPECTED_SHA256);
  assert.equal(sha256File(INDEX_JS_PATH), INDEX_EXPECTED_SHA256);
});

test("R31-03 schema contract id/version present", () => {
  assert.equal(SCHEMA_CONTRACT_ID, "paper-personal-v1");
  assert.equal(VERSION, 1);
  assert.equal(GATE_ID, "12AK-R31");
  assert.match(sql, /SCHEMA_CONTRACT_ID:\s*paper-personal-v1/);
  assert.match(sql, /VERSION:\s*1/);
  assert.equal(analysis.headerContractId, true);
  assert.ok(analysis.tables.paper_schema_version);
  assert.match(
    analysis.tables.paper_schema_version,
    /schema_id\s+TEXT/i
  );
});

test("R31-04 runtime singleton table present", () => {
  const t = analysis.tables.paper_runtime_authority;
  assert.ok(t);
  assert.match(t, /authority_id\s+TEXT/i);
  assert.match(t, /active_process_generation_id\s+UUID/i);
  assert.match(t, /lease_expires_at\s+TIMESTAMPTZ/i);
  assert.match(t, /revision\s+BIGINT/i);
  assert.match(sql, /INSERT\s+INTO\s+paper_runtime_authority/i);
  assert.match(sql, /'paper-runtime-v1'/);
});

test("R31-05 account table present", () => {
  const t = analysis.tables.paper_account_state;
  assert.ok(t);
  assert.match(t, /paper_account_id\s+UUID/i);
  assert.match(t, /cash\s+NUMERIC\s*\(\s*20\s*,\s*4\s*\)/i);
  assert.match(t, /realized_pnl\s+NUMERIC\s*\(\s*20\s*,\s*4\s*\)/i);
  assert.match(t, /revision\s+BIGINT/i);
});

test("R31-06 position composite PK exact", () => {
  const t = analysis.tables.paper_position;
  assert.ok(t);
  assert.equal(
    hasUniqueOnColumns(t, ["paper_account_id", "market", "symbol"]),
    true
  );
  assert.match(
    t,
    /PRIMARY\s+KEY\s*\(\s*paper_account_id\s*,\s*market\s*,\s*symbol\s*\)/i
  );
});

test("R31-07 execution UNIQUE(order_intent_id)", () => {
  const t = analysis.tables.paper_execution_record;
  assert.ok(t);
  assert.equal(hasUniqueOnColumns(t, ["order_intent_id"]), true);
  assert.match(t, /UNIQUE\s*\(\s*order_intent_id\s*\)/i);
});

test("R31-08 idempotency composite PK exact", () => {
  const t = analysis.tables.paper_idempotency_record;
  assert.ok(t);
  assert.equal(
    hasUniqueOnColumns(t, ["paper_account_id", "idempotency_key"]),
    true
  );
  assert.match(
    t,
    /PRIMARY\s+KEY\s*\(\s*paper_account_id\s*,\s*idempotency_key\s*\)/i
  );
  for (const s of IDEMPOTENCY_STATUSES) {
    assert.match(t, new RegExp("'" + s + "'"));
  }
});

test("R31-09 kill switch initial state disabled", () => {
  assert.ok(analysis.tables.paper_kill_switch);
  assert.equal(analysis.hasKillSwitchDisabledBootstrap, true);
  assert.match(sql, /'paper-kill-v1'/);
  assert.match(sql, /'EXECUTION_DISABLED'/);
  assert.equal(/'EXECUTION_ALLOWED'\s*,\s*0/.test(sql), false);
});

test("R31-10 money columns contain NUMERIC(20,4)", () => {
  assert.ok(analysis.numericMoneyCount >= 6);
  assert.match(stripped, /NUMERIC\s*\(\s*20\s*,\s*4\s*\)/i);
  const account = analysis.tables.paper_account_state;
  assert.match(account, /cash\s+NUMERIC\s*\(\s*20\s*,\s*4\s*\)/i);
});

test("R31-11 no FLOAT/REAL/DOUBLE/MONEY", () => {
  assert.deepEqual(analysis.forbiddenFloatTypesFound, []);
  for (const t of FORBIDDEN_FLOAT_TYPES) {
    const re = new RegExp("\\b" + t.replace(" ", "\\s+") + "\\b", "i");
    assert.equal(re.test(stripped), false, t);
  }
});

test("R31-12 ledger unique expression index exists", () => {
  assert.equal(analysis.hasLedgerUniqueExpressionIndex, true);
  assert.match(
    stripped,
    /CREATE\s+UNIQUE\s+INDEX\s+uq_paper_ledger_execution_effect/i
  );
  assert.match(stripped, /COALESCE\s*\(\s*market\s*,\s*''\s*\)/i);
  assert.match(stripped, /COALESCE\s*\(\s*symbol\s*,\s*''\s*\)/i);
});

test("R31-13 no ledger ON DELETE CASCADE", () => {
  assert.equal(analysis.hasUnsafeCascade, false);
  assert.equal(/\bON\s+DELETE\s+CASCADE\b/i.test(stripped), false);
  const ledger = analysis.tables.paper_ledger_entry;
  assert.match(ledger, /ON\s+DELETE\s+RESTRICT/i);
});

test("R31-14 no account bootstrap data", () => {
  assert.equal(analysis.hasAccountBootstrapInsert, false);
  assert.equal(/INSERT\s+INTO\s+paper_account_state\b/i.test(stripped), false);
});

test("R31-15 no Dynamo/range/fence personal-v1 columns", () => {
  assert.deepEqual(analysis.legacyRangeColumnsFound, []);
  for (const c of LEGACY_RANGE_COLUMNS) {
    assert.equal(new RegExp("\\b" + c + "\\b", "i").test(stripped), false, c);
  }
  assert.equal(/dynamo|DynamoDB|aws-sdk/i.test(stripped), false);
});

test("R31-16 no runtime migration reachability introduced", () => {
  const personalJs = fs.readFileSync(
    path.join(__dirname, "../lib/paper/pg-schema/paper-personal-v1.js"),
    "utf8"
  );
  assert.equal(/require\(['"]pg['"]\)/.test(personalJs), false);
  assert.equal(/\.query\(|\.connect\(|createPool/i.test(personalJs), false);
  assert.equal(/migrate|applySchema|runMigration/i.test(personalJs), false);
  // index.js must remain I4-only (no personal-v1 wiring)
  const indexJs = fs.readFileSync(INDEX_JS_PATH, "utf8");
  assert.equal(/paper-personal-v1/.test(indexJs), false);
  assert.equal(sha256File(INDEX_JS_PATH), INDEX_EXPECTED_SHA256);
});

test("R31-17 no CREATE EXTENSION needed for UUID", () => {
  assert.equal(analysis.hasExtension, false);
  assert.equal(/\bCREATE\s+EXTENSION\b/i.test(stripped), false);
  assert.equal(/uuid-ossp|pgcrypto/i.test(stripped), false);
});

test("R31-18 no DROP/TRUNCATE", () => {
  assert.equal(analysis.hasDrop, false);
  assert.equal(analysis.hasTruncate, false);
  assert.equal(/\bDROP\s+(TABLE|SCHEMA|INDEX)\b/i.test(stripped), false);
  assert.equal(/\bTRUNCATE\b/i.test(stripped), false);
});

test("R31-19 no Paper/Live enablement change + dormant contract assert", () => {
  assert.match(sql, /NO Paper\/Live enablement|DO NOT EXECUTE/i);
  const a = assertPersonalV1SchemaContract(sql);
  assert.equal(a.schemaContractId, "paper-personal-v1");
  assert.equal(a.version, 1);
  assert.throws(() => assertPersonalV1SchemaContract("-- empty\n"), (e) => {
    return e && e.code === "PERSONAL_V1_SCHEMA_CONTRACT_INVALID";
  });
  // eligibility flags not flipped by this dormant artifact
  assert.equal(/\bPAPER_ELIGIBLE\s*[:=]\s*TRUE\b/i.test(sql), false);
  assert.equal(/\bLIVE_ELIGIBLE\s*[:=]\s*TRUE\b/i.test(sql), false);
});

test("R31-20 expected bootstrap rows only (schema/runtime/kill)", () => {
  assert.equal(analysis.hasSchemaVersionBootstrap, true);
  assert.equal(analysis.hasRuntimeAuthorityBootstrap, true);
  assert.equal(analysis.hasKillSwitchDisabledBootstrap, true);
  assert.equal(analysis.hasAccountBootstrapInsert, false);
  const inserts = stripped.match(/INSERT\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi) || [];
  const targets = inserts.map((s) => s.replace(/INSERT\s+INTO\s+/i, "").toLowerCase()).sort();
  assert.deepEqual(targets, [
    "paper_kill_switch",
    "paper_runtime_authority",
    "paper_schema_version",
  ]);
  // plain CREATE TABLE (no IF NOT EXISTS) and plain INSERT (no ON CONFLICT)
  assert.equal(analysis.hasIfNotExists, false);
  assert.equal(analysis.hasOnConflictNothing, false);
  assert.deepEqual([...analysis.createTableNames].sort(), [...REQUIRED_TABLES].sort());
  for (const s of ORDER_INTENT_STATUSES) {
    assert.match(analysis.tables.paper_order_intent, new RegExp("'" + s + "'"));
  }
  for (const s of EXECUTION_STATUSES) {
    assert.match(analysis.tables.paper_execution_record, new RegExp("'" + s + "'"));
  }
  for (const s of LEDGER_ENTRY_TYPES) {
    assert.match(analysis.tables.paper_ledger_entry, new RegExp("'" + s + "'"));
  }
});


// ---------------------------------------------------------------------------
// GATE 12AK-R31-R2 — close R31-R1 MEDIUM test-lock gaps (test-only)
// Scoped to extractCreateTableBody / analysis.tables so remote substring hits fail.
// ---------------------------------------------------------------------------

test("R31-21 MEDIUM1 request_digest CHAR(64)+hex on paper_order_intent", () => {
  const t = analysis.tables.paper_order_intent;
  assert.ok(t, "paper_order_intent DDL missing");
  // column + length + NOT NULL must be bound inside this table body
  assert.match(
    t,
    /request_digest\s+CHAR\s*\(\s*64\s*\)\s+NOT\s+NULL/i
  );
  // exact approved hex CHECK (do not invent a different regex)
  assert.match(
    t,
    /CHECK\s*\(\s*request_digest\s*~\s*'\^\[0-9a-fA-F\]\{64\}\$'\s*\)/
  );
  // named constraint present in approved SQL
  assert.match(t, /paper_order_intent_digest_hex_chk/i);
});

test("R31-22 MEDIUM1 request_digest CHAR(64)+hex on paper_idempotency_record", () => {
  const t = analysis.tables.paper_idempotency_record;
  assert.ok(t, "paper_idempotency_record DDL missing");
  assert.match(
    t,
    /request_digest\s+CHAR\s*\(\s*64\s*\)\s+NOT\s+NULL/i
  );
  assert.match(
    t,
    /CHECK\s*\(\s*request_digest\s*~\s*'\^\[0-9a-fA-F\]\{64\}\$'\s*\)/
  );
  assert.match(t, /paper_idempotency_record_digest_hex_chk/i);
  // both contracted tables independently locked (not a single global hit)
  assert.match(
    analysis.tables.paper_order_intent,
    /request_digest\s+CHAR\s*\(\s*64\s*\)\s+NOT\s+NULL/i
  );
});

test("R31-23 MEDIUM2 FILLED payload CHECK on paper_execution_record", () => {
  const t = analysis.tables.paper_execution_record;
  assert.ok(t, "paper_execution_record DDL missing");
  assert.match(t, /paper_execution_record_filled_payload_chk/i);
  // status='FILLED' implies qty>0, price NOT NULL, executed_at NOT NULL
  assert.match(
    t,
    /CHECK\s*\(\s*status\s*<>\s*'FILLED'\s*OR\s*\(\s*executed_quantity\s*>\s*0\s*AND\s*executed_price\s+IS\s+NOT\s+NULL\s*AND\s*executed_at\s+IS\s+NOT\s+NULL\s*\)\s*\)/i
  );
});

test("R31-24 MEDIUM2 non-FILLED payload CHECK on paper_execution_record", () => {
  const t = analysis.tables.paper_execution_record;
  assert.ok(t, "paper_execution_record DDL missing");
  assert.match(t, /paper_execution_record_nonfilled_payload_chk/i);
  // approved SQL also locks executed_at IS NULL for non-FILLED
  assert.match(
    t,
    /CHECK\s*\(\s*status\s*=\s*'FILLED'\s*OR\s*\(\s*executed_quantity\s*=\s*0\s*AND\s*executed_price\s+IS\s+NULL\s*AND\s*executed_at\s+IS\s+NULL\s*\)\s*\)/i
  );
});

test("R31-25 MEDIUM3 symbol BTRIM/empty/whitespace scoped CHECKs", () => {
  // Must fail if BTRIM equality removed while leaving other symbol checks.
  // Scope per table — not a global BTRIM include.
  for (const name of ["paper_position", "paper_order_intent"]) {
    const t = analysis.tables[name];
    assert.ok(t, name + " DDL missing");
    assert.match(
      t,
      /symbol\s*=\s*BTRIM\s*\(\s*symbol\s*\)/i,
      name + " missing symbol = BTRIM(symbol)"
    );
    assert.match(t, /symbol\s*<>\s*''/, name + " missing empty-symbol reject");
    // SQL literal: symbol !~ '\s'  (backslash-s inside quotes)
    assert.match(
      t,
      /symbol\s*!~\s*'\\s'/,
      name + " missing embedded-whitespace reject"
    );
  }
  // ledger duplicates the canonical contract when symbol is non-NULL
  const ledger = analysis.tables.paper_ledger_entry;
  assert.ok(ledger);
  assert.match(
    ledger,
    /symbol\s*=\s*BTRIM\s*\(\s*symbol\s*\)/i
  );
  assert.match(ledger, /symbol\s*<>\s*''/);
  assert.match(ledger, /symbol\s*!~\s*'\\s'/);
});

test("R31-26 LOW1 runtime bootstrap revision=0 bound to INSERT", () => {
  // Bind zero to the runtime bootstrap INSERT specifically (not any unrelated 0).
  const m = stripped.match(
    /INSERT\s+INTO\s+paper_runtime_authority\s*\([\s\S]*?\)\s*VALUES\s*\([\s\S]*?\)\s*;/i
  );
  assert.ok(m, "paper_runtime_authority INSERT missing");
  const ins = m[0];
  assert.match(ins, /'paper-runtime-v1'/);
  assert.match(
    ins,
    /VALUES\s*\(\s*'paper-runtime-v1'\s*,\s*NULL\s*,\s*NULL\s*,\s*0\s*,\s*NULL\s*,\s*clock_timestamp\s*\(\s*\)\s*\)/i
  );
  // preserve lease/generation NULL + revision 0 lock
  assert.match(ins, /active_process_generation_id/i);
  assert.match(ins, /lease_expires_at/i);
  assert.match(ins, /revision/i);
});
