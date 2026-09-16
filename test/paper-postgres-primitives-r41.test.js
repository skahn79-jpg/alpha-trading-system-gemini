"use strict";

/**
 * GATE 12AK-R41 — Paper PostgreSQL primitives (mock pool/client, zero network).
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const postgresRoot = path.join(__dirname, "..", "lib", "paper", "postgres");

const {
  PAPER_DB_ERROR_CODES,
  PaperDbError,
  mapPgError,
  sanitizePublicMessage,
  RUNTIME_SECRET_NAME,
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
} = require("../lib/paper/postgres");

const DUMMY_URL =
  "postgresql://paper_runtime:dummy-pass@db.example.internal:5432/alpha_trading_paper?sslmode=require";

function makePgErr(code, message, extra) {
  const err = new Error(message || "pg error");
  err.code = code;
  if (extra && extra.constraint) err.constraint = extra.constraint;
  return err;
}

function createMockClient(queryImpl) {
  const client = {
    releaseCount: 0,
    queries: [],
    async query(sql, params) {
      client.queries.push({ sql, params });
      if (typeof queryImpl === "function") {
        return queryImpl(sql, params, client);
      }
      return { rows: [] };
    },
    release() {
      client.releaseCount += 1;
    },
  };
  return client;
}

function createMockPool(client, opts) {
  const options = opts || {};
  return {
    connectCount: 0,
    queryCount: 0,
    async connect() {
      this.connectCount += 1;
      if (typeof options.onConnect === "function") {
        await options.onConnect();
      }
      return client;
    },
    async query() {
      this.queryCount += 1;
      throw new Error("pool.query must not be used by withPaperTransaction");
    },
  };
}

describe("GATE 12AK-R41 paper postgres primitives", () => {
  describe("C config / pool", () => {
    it("C1 missing PAPER_DATABASE_URL_RUNTIME → DB_CONFIG_INVALID", () => {
      assert.throws(
        () => getPaperRuntimeDatabaseConfig({}),
        (err) =>
          err instanceof PaperDbError &&
          err.code === PAPER_DB_ERROR_CODES.DB_CONFIG_INVALID
      );
    });

    it("C2 module import with env absent → no throw", () => {
      const prev = process.env.PAPER_DATABASE_URL_RUNTIME;
      delete process.env.PAPER_DATABASE_URL_RUNTIME;
      try {
        assert.doesNotThrow(() => {
          require("../lib/paper/postgres");
        });
      } finally {
        if (prev !== undefined) process.env.PAPER_DATABASE_URL_RUNTIME = prev;
      }
    });

    it("C3 runtime URL parsed without logging secret", () => {
      const cfg = getPaperRuntimeDatabaseConfig({
        PAPER_DATABASE_URL_RUNTIME: DUMMY_URL,
      });
      assert.equal(cfg.connectionString, DUMMY_URL);
      assert.equal(cfg.poolMax, 2);
      assert.match(cfg.connectionString, /sslmode=require/);
      assert.equal(cfg.applicationRoleContract, "paper_runtime");
      try {
        getPaperRuntimeDatabaseConfig({
          PAPER_DATABASE_URL_RUNTIME:
            "postgresql://paper_runtime:dummy-pass@/alpha_trading_paper?sslmode=require",
        });
        assert.fail("expected throw");
      } catch (err) {
        assert.ok(err instanceof PaperDbError);
        assert.equal(err.code, PAPER_DB_ERROR_CODES.DB_CONFIG_INVALID);
        assert.doesNotMatch(err.message, /dummy-pass/);
        assert.doesNotMatch(String(err), /dummy-pass/);
      }
    });

    it("C4 migration secret not consumed / not in sources", () => {
      const cfg = getPaperRuntimeDatabaseConfig({
        PAPER_DATABASE_URL_RUNTIME: DUMMY_URL,
        PAPER_DATABASE_URL_MIGRATION:
          "postgresql://migrator:secret-mig@db.example.internal:5432/alpha_trading_paper?sslmode=require",
      });
      assert.equal(cfg.connectionString, DUMMY_URL);
      assert.doesNotMatch(cfg.connectionString, /secret-mig/);

      const files = fs.readdirSync(postgresRoot).filter((f) => f.endsWith(".js"));
      for (const f of files) {
        const text = fs.readFileSync(path.join(postgresRoot, f), "utf8");
        assert.doesNotMatch(
          text,
          /PAPER_DATABASE_URL_MIGRATION/,
          f + " must not reference PAPER_DATABASE_URL_MIGRATION"
        );
      }
    });

    it("C5 invalid runtime URL rejected safely", () => {
      assert.throws(
        () =>
          getPaperRuntimeDatabaseConfig({
            PAPER_DATABASE_URL_RUNTIME: "not-a-url",
          }),
        (err) =>
          err instanceof PaperDbError &&
          err.code === PAPER_DB_ERROR_CODES.DB_CONFIG_INVALID &&
          !String(err.message).includes("dummy-pass")
      );

      assert.throws(
        () =>
          getPaperRuntimeDatabaseConfig({
            PAPER_DATABASE_URL_RUNTIME:
              "postgresql://paper_runtime:dummy-pass@db.example.internal:5432/alpha_trading_paper?sslmode=disable",
          }),
        (err) =>
          err instanceof PaperDbError &&
          err.code === PAPER_DB_ERROR_CODES.DB_CONFIG_INVALID &&
          !String(err.message).includes("dummy-pass")
      );

      assert.throws(
        () =>
          getPaperRuntimeDatabaseConfig({
            PAPER_DATABASE_URL_RUNTIME:
              "postgresql://paper_runtime:dummy-pass@db.example.internal:5432/alpha_trading_paper?sslmode=prefer",
          }),
        (err) =>
          err instanceof PaperDbError &&
          err.code === PAPER_DB_ERROR_CODES.DB_CONFIG_INVALID
      );
    });

    it("C6 pool max = 2", () => {
      let captured = null;
      class FakePool {
        constructor(opts) {
          captured = opts;
        }
      }
      const cfg = getPaperRuntimeDatabaseConfig({
        PAPER_DATABASE_URL_RUNTIME: DUMMY_URL,
      });
      createPaperPgPool(cfg, { Pool: FakePool });
      assert.equal(captured.max, 2);
    });

    it("C7 connectionTimeoutMillis = 5000", () => {
      let captured = null;
      class FakePool {
        constructor(opts) {
          captured = opts;
        }
      }
      const cfg = getPaperRuntimeDatabaseConfig({
        PAPER_DATABASE_URL_RUNTIME: DUMMY_URL,
      });
      createPaperPgPool(cfg, { Pool: FakePool });
      assert.equal(captured.connectionTimeoutMillis, 5000);
    });

    it("ROLE-1 paper_runtime accepted", () => {
      const cfg = getPaperRuntimeDatabaseConfig({
        PAPER_DATABASE_URL_RUNTIME: DUMMY_URL,
      });
      assert.equal(cfg.applicationRoleContract, "paper_runtime");
      assert.equal(cfg.connectionString, DUMMY_URL);
    });

    it("ROLE-2 paper_migration rejected", () => {
      assert.throws(
        () =>
          getPaperRuntimeDatabaseConfig({
            PAPER_DATABASE_URL_RUNTIME:
              "postgresql://paper_migration:mig-secret@db.example.internal:5432/alpha_trading_paper?sslmode=require",
          }),
        (err) =>
          err instanceof PaperDbError &&
          err.code === PAPER_DB_ERROR_CODES.DB_CONFIG_INVALID &&
          /runtime database role is invalid/.test(err.message)
      );
    });

    it("ROLE-3 arbitrary_user rejected", () => {
      assert.throws(
        () =>
          getPaperRuntimeDatabaseConfig({
            PAPER_DATABASE_URL_RUNTIME:
              "postgresql://arbitrary_user:arb-secret@db.example.internal:5432/alpha_trading_paper?sslmode=require",
          }),
        (err) =>
          err instanceof PaperDbError &&
          err.code === PAPER_DB_ERROR_CODES.DB_CONFIG_INVALID &&
          /runtime database role is invalid/.test(err.message)
      );
    });

    it("ROLE-4 postgres/admin-like rejected", () => {
      for (const user of ["postgres", "admin", "Paper_Runtime", "PAPER_RUNTIME"]) {
        assert.throws(
          () =>
            getPaperRuntimeDatabaseConfig({
              PAPER_DATABASE_URL_RUNTIME:
                "postgresql://" +
                encodeURIComponent(user) +
                ":admin-secret@db.example.internal:5432/alpha_trading_paper?sslmode=require",
            }),
          (err) =>
            err instanceof PaperDbError &&
            err.code === PAPER_DB_ERROR_CODES.DB_CONFIG_INVALID &&
            /runtime database role is invalid/.test(err.message),
          "expected reject for role: " + user
        );
      }
    });

    it("ROLE-5 wrong-role error is secret-safe", () => {
      const secretPass = "super-secret-pass-xyz";
      const fullUrl =
        "postgresql://paper_migration:" +
        secretPass +
        "@db.example.internal:5432/alpha_trading_paper?sslmode=require";
      try {
        getPaperRuntimeDatabaseConfig({
          PAPER_DATABASE_URL_RUNTIME: fullUrl,
        });
        assert.fail("expected throw");
      } catch (err) {
        assert.ok(err instanceof PaperDbError);
        assert.equal(err.code, PAPER_DB_ERROR_CODES.DB_CONFIG_INVALID);
        const publicText = String(err.message) + " " + String(err);
        assert.doesNotMatch(publicText, new RegExp(secretPass));
        assert.doesNotMatch(publicText, /postgresql:\/\//i);
        assert.doesNotMatch(publicText, /paper_migration/);
        assert.doesNotMatch(publicText, /db\.example\.internal/);
        assert.doesNotMatch(publicText, /super-secret/);
        assert.match(err.message, /runtime database role is invalid/);
      }
    });

    it("ROLE-6 import without env still safe", () => {
      const prevRuntime = process.env.PAPER_DATABASE_URL_RUNTIME;
      const prevMigration = process.env.PAPER_DATABASE_URL_MIGRATION;
      delete process.env.PAPER_DATABASE_URL_RUNTIME;
      delete process.env.PAPER_DATABASE_URL_MIGRATION;
      try {
        const id = require.resolve("../lib/paper/postgres/runtime-db-config");
        delete require.cache[id];
        assert.doesNotThrow(() => {
          require("../lib/paper/postgres/runtime-db-config");
        });
      } finally {
        if (prevRuntime !== undefined) {
          process.env.PAPER_DATABASE_URL_RUNTIME = prevRuntime;
        }
        if (prevMigration !== undefined) {
          process.env.PAPER_DATABASE_URL_MIGRATION = prevMigration;
        }
      }
    });

    it("ROLE-7 PAPER_DATABASE_URL_MIGRATION unconsumed", () => {
      const migUrl =
        "postgresql://paper_migration:secret-mig-role7@db.example.internal:5432/alpha_trading_paper?sslmode=require";
      const cfg = getPaperRuntimeDatabaseConfig({
        PAPER_DATABASE_URL_RUNTIME: DUMMY_URL,
        PAPER_DATABASE_URL_MIGRATION: migUrl,
      });
      assert.equal(cfg.connectionString, DUMMY_URL);
      assert.doesNotMatch(cfg.connectionString, /secret-mig-role7/);
      assert.doesNotMatch(cfg.connectionString, /paper_migration/);

      const src = fs.readFileSync(
        path.join(postgresRoot, "runtime-db-config.js"),
        "utf8"
      );
      assert.doesNotMatch(src, /PAPER_DATABASE_URL_MIGRATION/);
    });

    it("C8 idleTimeoutMillis = 10000", () => {
      let captured = null;
      class FakePool {
        constructor(opts) {
          captured = opts;
        }
      }
      const cfg = getPaperRuntimeDatabaseConfig({
        PAPER_DATABASE_URL_RUNTIME: DUMMY_URL,
      });
      createPaperPgPool(cfg, { Pool: FakePool });
      assert.equal(captured.idleTimeoutMillis, 10000);
      assert.equal(captured.connectionString, DUMMY_URL);
    });
  });

  describe("T transaction matrix", () => {
    it("T1 success: connect → BEGIN → ISOLATION → SET LOCAL → callback → COMMIT → release", async () => {
      const client = createMockClient();
      const pool = createMockPool(client);
      let seenClient = null;
      const result = await withPaperTransaction(pool, async (c) => {
        seenClient = c;
        return 42;
      });
      assert.equal(result, 42);
      assert.equal(seenClient, client);
      assert.deepEqual(
        client.queries.map((q) => q.sql),
        [BEGIN_SQL, ISOLATION_SQL, STATEMENT_TIMEOUT_SQL, COMMIT_SQL]
      );
      assert.equal(client.releaseCount, 1);
      assert.equal(pool.connectCount, 1);
    });

    it("T2 callback error: ROLLBACK → release; mapped error", async () => {
      const client = createMockClient();
      const pool = createMockPool(client);
      const boom = makePgErr("23505", "duplicate key");
      await assert.rejects(
        () =>
          withPaperTransaction(pool, async () => {
            throw boom;
          }),
        (err) =>
          err instanceof PaperDbError &&
          err.code === PAPER_DB_ERROR_CODES.DB_CONSTRAINT_VIOLATION &&
          err.sqlState === "23505"
      );
      assert.deepEqual(
        client.queries.map((q) => q.sql),
        [BEGIN_SQL, ISOLATION_SQL, STATEMENT_TIMEOUT_SQL, ROLLBACK_SQL]
      );
      assert.equal(client.releaseCount, 1);
    });

    it("T3 BEGIN failure: error mapped, release", async () => {
      const client = createMockClient(async (sql) => {
        if (sql === BEGIN_SQL) throw makePgErr("08006", "connection failure");
        return { rows: [] };
      });
      const pool = createMockPool(client);
      await assert.rejects(
        () => withPaperTransaction(pool, async () => "nope"),
        (err) =>
          err instanceof PaperDbError &&
          err.code === PAPER_DB_ERROR_CODES.DB_UNAVAILABLE &&
          err.sqlState === "08006"
      );
      assert.deepEqual(
        client.queries.map((q) => q.sql),
        [BEGIN_SQL]
      );
      assert.equal(client.releaseCount, 1);
    });

    it("T4 SET LOCAL (or isolation) failure: ROLLBACK attempted, release", async () => {
      const client = createMockClient(async (sql) => {
        if (sql === ISOLATION_SQL) throw makePgErr("57014", "canceling statement");
        return { rows: [] };
      });
      const pool = createMockPool(client);
      await assert.rejects(
        () => withPaperTransaction(pool, async () => "nope"),
        (err) =>
          err instanceof PaperDbError &&
          err.code === PAPER_DB_ERROR_CODES.DB_TIMEOUT
      );
      assert.deepEqual(
        client.queries.map((q) => q.sql),
        [BEGIN_SQL, ISOLATION_SQL, ROLLBACK_SQL]
      );
      assert.equal(client.releaseCount, 1);

      const client2 = createMockClient(async (sql) => {
        if (sql === STATEMENT_TIMEOUT_SQL)
          throw makePgErr("08000", "connection exception");
        return { rows: [] };
      });
      const pool2 = createMockPool(client2);
      await assert.rejects(
        () => withPaperTransaction(pool2, async () => "nope"),
        (err) =>
          err instanceof PaperDbError &&
          err.code === PAPER_DB_ERROR_CODES.DB_UNAVAILABLE
      );
      assert.deepEqual(
        client2.queries.map((q) => q.sql),
        [BEGIN_SQL, ISOLATION_SQL, STATEMENT_TIMEOUT_SQL, ROLLBACK_SQL]
      );
      assert.equal(client2.releaseCount, 1);
    });

    it("T5 COMMIT failure: DB_COMMIT_UNKNOWN, no callback replay, no ROLLBACK", async () => {
      let callbackCount = 0;
      const client = createMockClient(async (sql) => {
        if (sql === COMMIT_SQL) throw makePgErr("08006", "commit network blip");
        return { rows: [] };
      });
      const pool = createMockPool(client);
      await assert.rejects(
        () =>
          withPaperTransaction(pool, async () => {
            callbackCount += 1;
            return "ok";
          }),
        (err) =>
          err instanceof PaperDbError &&
          err.code === PAPER_DB_ERROR_CODES.DB_COMMIT_UNKNOWN
      );
      assert.equal(callbackCount, 1);
      assert.ok(!client.queries.some((q) => q.sql === ROLLBACK_SQL));
      assert.deepEqual(
        client.queries.map((q) => q.sql),
        [BEGIN_SQL, ISOLATION_SQL, STATEMENT_TIMEOUT_SQL, COMMIT_SQL]
      );
      assert.equal(client.releaseCount, 1);
    });

    it("T6 ROLLBACK failure: DB_INTERNAL with cause + details.rollbackCause", async () => {
      const opErr = new Error("callback failed");
      const rollbackErr = makePgErr("08006", "rollback also failed");
      const client = createMockClient(async (sql) => {
        if (sql === ROLLBACK_SQL) throw rollbackErr;
        return { rows: [] };
      });
      const pool = createMockPool(client);
      await assert.rejects(
        () =>
          withPaperTransaction(pool, async () => {
            throw opErr;
          }),
        (err) => {
          assert.ok(err instanceof PaperDbError);
          assert.equal(err.code, PAPER_DB_ERROR_CODES.DB_INTERNAL);
          assert.equal(err.cause, opErr);
          assert.ok(err.details && err.details.rollbackCause === rollbackErr);
          return true;
        }
      );
      assert.equal(client.releaseCount, 1);
    });

    it("T7 client release exactly once", async () => {
      const client = createMockClient();
      const pool = createMockPool(client);
      await withPaperTransaction(pool, async () => "x");
      assert.equal(client.releaseCount, 1);

      const client2 = createMockClient(async (sql) => {
        if (sql === BEGIN_SQL) throw makePgErr("08006", "fail");
        return { rows: [] };
      });
      const pool2 = createMockPool(client2);
      await assert.rejects(() => withPaperTransaction(pool2, async () => 1));
      assert.equal(client2.releaseCount, 1);
    });

    it("T8 callback receives pinned client", async () => {
      const client = createMockClient();
      const pool = createMockPool(client);
      await withPaperTransaction(pool, async (c) => {
        assert.equal(c, client);
        await c.query("SELECT 1");
      });
      assert.ok(client.queries.some((q) => q.sql === "SELECT 1"));
    });

    it("T9 no pool.query used for transaction statements", async () => {
      const client = createMockClient();
      const pool = createMockPool(client);
      await withPaperTransaction(pool, async () => "ok");
      assert.equal(pool.queryCount, 0);
      assert.ok(client.queries.length >= 4);
    });

    it("T10 no automatic retry (callback invoked once)", async () => {
      let calls = 0;
      const client = createMockClient(async (sql) => {
        if (sql === COMMIT_SQL) throw makePgErr("40001", "serialization");
        return { rows: [] };
      });
      const pool = createMockPool(client);
      await assert.rejects(
        () =>
          withPaperTransaction(pool, async () => {
            calls += 1;
          }),
        (err) =>
          err instanceof PaperDbError &&
          err.code === PAPER_DB_ERROR_CODES.DB_COMMIT_UNKNOWN
      );
      assert.equal(calls, 1);
    });
  });

  describe("E errors", () => {
    it("E1 23505 generic → DB_CONSTRAINT_VIOLATION", () => {
      const err = mapPgError(makePgErr("23505", "duplicate"));
      assert.equal(err.code, PAPER_DB_ERROR_CODES.DB_CONSTRAINT_VIOLATION);
    });

    it("E2 23503 → DB_CONSTRAINT_VIOLATION", () => {
      assert.equal(
        mapPgError(makePgErr("23503", "fk")).code,
        PAPER_DB_ERROR_CODES.DB_CONSTRAINT_VIOLATION
      );
    });

    it("E3 23514 → DB_CONSTRAINT_VIOLATION", () => {
      assert.equal(
        mapPgError(makePgErr("23514", "check")).code,
        PAPER_DB_ERROR_CODES.DB_CONSTRAINT_VIOLATION
      );
    });

    it("E4 40001 → DB_AUTHORITY_CONFLICT", () => {
      assert.equal(
        mapPgError(makePgErr("40001", "serialization")).code,
        PAPER_DB_ERROR_CODES.DB_AUTHORITY_CONFLICT
      );
    });

    it("E5 40P01 → DB_AUTHORITY_CONFLICT", () => {
      assert.equal(
        mapPgError(makePgErr("40P01", "deadlock")).code,
        PAPER_DB_ERROR_CODES.DB_AUTHORITY_CONFLICT
      );
    });

    it("E6 57014 → DB_TIMEOUT", () => {
      assert.equal(
        mapPgError(makePgErr("57014", "timeout")).code,
        PAPER_DB_ERROR_CODES.DB_TIMEOUT
      );
    });

    it("E7 08xxx → DB_UNAVAILABLE", () => {
      assert.equal(
        mapPgError(makePgErr("08006", "conn")).code,
        PAPER_DB_ERROR_CODES.DB_UNAVAILABLE
      );
      assert.equal(
        mapPgError(makePgErr("08000", "conn")).code,
        PAPER_DB_ERROR_CODES.DB_UNAVAILABLE
      );
    });

    it("E8 57P01 → DB_UNAVAILABLE", () => {
      assert.equal(
        mapPgError(makePgErr("57P01", "admin shutdown")).code,
        PAPER_DB_ERROR_CODES.DB_UNAVAILABLE
      );
    });

    it("E9 unknown → DB_INTERNAL", () => {
      assert.equal(
        mapPgError(makePgErr("99999", "mystery")).code,
        PAPER_DB_ERROR_CODES.DB_INTERNAL
      );
      assert.equal(
        mapPgError(new Error("plain")).code,
        PAPER_DB_ERROR_CODES.DB_INTERNAL
      );
    });

    it("E10 public error output contains no DB URL/password", () => {
      const raw = new Error(
        "connect to postgresql://paper_runtime:dummy-pass@db.example.internal:5432/alpha_trading_paper failed password=dummy-pass"
      );
      raw.code = "08006";
      const err = mapPgError(raw);
      assert.doesNotMatch(err.message, /dummy-pass/);
      assert.doesNotMatch(err.message, /postgresql:\/\/[^\s]*dummy-pass/);
      assert.match(err.message, /\[redacted\]/);
      assert.equal(
        sanitizePublicMessage(
          "postgresql://u:secret@host/db password=secret"
        ).includes("secret"),
        false
      );
    });

    it("23505 + context.intent==='idempotency' → DB_IDEMPOTENCY_CONFLICT", () => {
      const err = mapPgError(makePgErr("23505", "dup"), {
        intent: "idempotency",
      });
      assert.equal(err.code, PAPER_DB_ERROR_CODES.DB_IDEMPOTENCY_CONFLICT);
    });
  });

  describe("M money codec", () => {
    it("M1 exact decimal string preserved", () => {
      assert.equal(moneyToDecimalString("123.4567"), "123.4567");
      assert.equal(moneyToDecimalString("-10.5"), "-10.5");
      assert.equal(moneyToDecimalString("0"), "0");
    });

    it("M2 invalid decimal rejected", () => {
      assert.throws(
        () => moneyToDecimalString("1.23456"),
        (err) =>
          err instanceof PaperDbError &&
          err.code === PAPER_DB_ERROR_CODES.DB_NONFINITE_OR_INVALID_MONEY
      );
      assert.throws(
        () => moneyToDecimalString("1e3"),
        (err) =>
          err.code === PAPER_DB_ERROR_CODES.DB_NONFINITE_OR_INVALID_MONEY
      );
      assert.throws(
        () => moneyToDecimalString(""),
        (err) =>
          err.code === PAPER_DB_ERROR_CODES.DB_NONFINITE_OR_INVALID_MONEY
      );
    });

    it("M3 nonfinite/Number rejected", () => {
      assert.throws(
        () => moneyToDecimalString(NaN),
        (err) =>
          err.code === PAPER_DB_ERROR_CODES.DB_NONFINITE_OR_INVALID_MONEY
      );
      assert.throws(
        () => moneyToDecimalString(Infinity),
        (err) =>
          err.code === PAPER_DB_ERROR_CODES.DB_NONFINITE_OR_INVALID_MONEY
      );
      assert.throws(
        () => moneyToDecimalString(12.34),
        (err) =>
          err.code === PAPER_DB_ERROR_CODES.DB_NONFINITE_OR_INVALID_MONEY
      );
    });

    it("M4 no JS Number money conversion", () => {
      assert.throws(
        () => moneyToDecimalString(100),
        (err) =>
          err instanceof PaperDbError &&
          err.code === PAPER_DB_ERROR_CODES.DB_NONFINITE_OR_INVALID_MONEY
      );
    });
  });

  describe("B bigint codec", () => {
    it("B1 BIGINT string preserved", () => {
      const r = bigintToCanonical("9007199254740993");
      assert.equal(r.asString, "9007199254740993");
      assert.equal(r.asBigInt, 9007199254740993n);
    });

    it("B2 JS BigInt accepted", () => {
      const r = bigintToCanonical(42n);
      assert.equal(r.asBigInt, 42n);
      assert.equal(r.asString, "42");
    });

    it("B3 > MAX_SAFE_INTEGER exact", () => {
      const s = "9007199254740993";
      const r = bigintToCanonical(s);
      assert.ok(r.asBigInt > BigInt(Number.MAX_SAFE_INTEGER));
      assert.equal(r.asBigInt.toString(), s);
      assert.equal(r.asString, s);
    });

    it("B4 invalid integer / Number rejected", () => {
      assert.throws(
        () => bigintToCanonical(42),
        (err) =>
          err instanceof PaperDbError &&
          err.code === PAPER_DB_ERROR_CODES.DB_INVALID_BIGINT
      );
      assert.throws(
        () => bigintToCanonical("12.3"),
        (err) => err.code === PAPER_DB_ERROR_CODES.DB_INVALID_BIGINT
      );
      assert.throws(
        () => bigintToCanonical("1e2"),
        (err) => err.code === PAPER_DB_ERROR_CODES.DB_INVALID_BIGINT
      );
      assert.throws(
        () => bigintToCanonical(null),
        (err) => err.code === PAPER_DB_ERROR_CODES.DB_INVALID_BIGINT
      );
    });
  });

  describe("misc helpers", () => {
    it("endPaperPgPool calls end when present", async () => {
      let ended = 0;
      await endPaperPgPool({
        async end() {
          ended += 1;
        },
      });
      assert.equal(ended, 1);
      await endPaperPgPool(null);
    });

    it("RUNTIME_SECRET_NAME is PAPER_DATABASE_URL_RUNTIME", () => {
      assert.equal(RUNTIME_SECRET_NAME, "PAPER_DATABASE_URL_RUNTIME");
    });

    it("PaperDbError already mapped is returned as-is", () => {
      const original = new PaperDbError(
        PAPER_DB_ERROR_CODES.DB_TIMEOUT,
        "already"
      );
      assert.equal(mapPgError(original), original);
    });
  });
});
