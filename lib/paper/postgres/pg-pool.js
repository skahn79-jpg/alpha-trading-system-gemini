"use strict";

/**
 * GATE 12AK-R41 — Paper PostgreSQL pool factory.
 * No connect on import. FakePool injectable via options.Pool.
 */

/**
 * @param {{
 *   connectionString: string,
 *   poolMax?: number,
 *   connectionTimeoutMillis?: number,
 *   idleTimeoutMillis?: number
 * }} config
 * @param {{ Pool?: new (opts: object) => object }} [options]
 * @returns {object}
 */
function createPaperPgPool(config, options) {
  const opts = options && typeof options === "object" ? options : {};
  const PoolCtor = opts.Pool || require("pg").Pool;

  const cfg = config && typeof config === "object" ? config : {};
  const max = cfg.poolMax != null ? Number(cfg.poolMax) : 2;
  const connectionTimeoutMillis =
    cfg.connectionTimeoutMillis != null
      ? Number(cfg.connectionTimeoutMillis)
      : 5000;
  const idleTimeoutMillis =
    cfg.idleTimeoutMillis != null ? Number(cfg.idleTimeoutMillis) : 10000;

  return new PoolCtor({
    connectionString: cfg.connectionString,
    max,
    connectionTimeoutMillis,
    idleTimeoutMillis,
  });
}

/**
 * @param {{ end?: () => Promise<void>|void }|null|undefined} pool
 * @returns {Promise<void>}
 */
async function endPaperPgPool(pool) {
  if (!pool || typeof pool.end !== "function") return;
  await pool.end();
}

module.exports = {
  createPaperPgPool,
  endPaperPgPool,
};
