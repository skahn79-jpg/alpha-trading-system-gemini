/**
 * GATE 12P Paper market-event identity v1.
 * Pure / process-local. No adapter, network, calendar, or financial mutation.
 *
 * open leftover: paper-runtime-loop.js / paper-execution-adapter.js require
 * isPosSafeInt(event.open) — positive safe integer. 0 / negative / NaN / Infinity rejected.
 */

"use strict";

const { createHash } = require("node:crypto");
const { encodeCanonical, deepCloneOwn, setOwn } = require("./paper-persistence-canonical");
const {
  isPlainObject,
  hasOwnRecordKey,
  isPosSafeInt,
} = require("./paper-account-state");

const DIGEST_PREFIX = "paper-market-event-v1:";
const SEQUENCE_RE = /^(0|[1-9][0-9]*)$/;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const EXCHANGE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-])(\d{2}):(\d{2})$/;

const PAPER_MARKETS = Object.freeze([
  "KOSPI",
  "KOSDAQ",
  "SYNTHETIC_KOSPI",
  "SYNTHETIC_KOSDAQ",
]);
const PAPER_MARKET_SET = new Set(PAPER_MARKETS);

const REQUIRED_FIELDS = Object.freeze([
  "eventId",
  "sequence",
  "market",
  "symbol",
  "tradingDate",
  "exchangeEventTime",
  "sourceGeneration",
  "open",
]);
const OPTIONAL_FIELDS = Object.freeze(["receivedAt"]);
const ALLOWED_FIELD_SET = new Set([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]);
const DIGEST_FIELDS = REQUIRED_FIELDS;

const CLASSIFICATION = Object.freeze({
  BASELINE_CANDIDATE: "BASELINE_CANDIDATE",
  ACCEPTABLE: "ACCEPTABLE",
  NOOP_DUPLICATE: "NOOP_DUPLICATE",
  IDENTITY_CONFLICT: "IDENTITY_CONFLICT",
  OUT_OF_ORDER: "OUT_OF_ORDER",
  SEQUENCE_GAP: "SEQUENCE_GAP",
});

const CONTROL = Object.freeze({
  PAUSE_STREAM: "PAUSE_STREAM",
  HALT_STREAM: "HALT_STREAM",
});

const ERROR = Object.freeze({
  PAPER_MARKET_EVENT_INVALID_INPUT: "PAPER_MARKET_EVENT_INVALID_INPUT",
  PAPER_MARKET_EVENT_UNKNOWN_FIELD: "PAPER_MARKET_EVENT_UNKNOWN_FIELD",
  PAPER_MARKET_EVENT_MISSING_FIELD: "PAPER_MARKET_EVENT_MISSING_FIELD",
  PAPER_MARKET_EVENT_INVALID_EVENT_ID: "PAPER_MARKET_EVENT_INVALID_EVENT_ID",
  PAPER_MARKET_EVENT_INVALID_SEQUENCE: "PAPER_MARKET_EVENT_INVALID_SEQUENCE",
  PAPER_MARKET_EVENT_INVALID_MARKET: "PAPER_MARKET_EVENT_INVALID_MARKET",
  PAPER_MARKET_EVENT_INVALID_SYMBOL: "PAPER_MARKET_EVENT_INVALID_SYMBOL",
  PAPER_MARKET_EVENT_INVALID_TRADING_DATE: "PAPER_MARKET_EVENT_INVALID_TRADING_DATE",
  PAPER_MARKET_EVENT_INVALID_EXCHANGE_EVENT_TIME: "PAPER_MARKET_EVENT_INVALID_EXCHANGE_EVENT_TIME",
  PAPER_MARKET_EVENT_INVALID_SOURCE_GENERATION: "PAPER_MARKET_EVENT_INVALID_SOURCE_GENERATION",
  PAPER_MARKET_EVENT_INVALID_OPEN: "PAPER_MARKET_EVENT_INVALID_OPEN",
  PAPER_MARKET_EVENT_STALE_COMMIT: "PAPER_MARKET_EVENT_STALE_COMMIT",
  PAPER_MARKET_EVENT_COMMIT_NOT_ALLOWED: "PAPER_MARKET_EVENT_COMMIT_NOT_ALLOWED",
  PAPER_MARKET_EVENT_INVALID_COMMIT: "PAPER_MARKET_EVENT_INVALID_COMMIT",
});

function sha256Hex(utf8Text) {
  return createHash("sha256").update(utf8Text, "utf8").digest("hex");
}

function fail(code, field) {
  const out = { ok: false, code: code, control: null };
  if (field !== undefined) out.field = field;
  return out;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isValidGregorianYmd(value) {
  if (typeof value !== "string" || !YMD_RE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year
    && dt.getUTCMonth() === month - 1
    && dt.getUTCDate() === day;
}

function isValidExchangeEventTime(value) {
  if (typeof value !== "string") return false;
  const matched = EXCHANGE_TIME_RE.exec(value);
  if (!matched) return false;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const hour = Number(matched[4]);
  const minute = Number(matched[5]);
  const second = Number(matched[6]);
  const offHour = Number(matched[8]);
  const offMinute = Number(matched[9]);
  const ymd = matched[1] + "-" + matched[2] + "-" + matched[3];
  if (!isValidGregorianYmd(ymd)) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (offHour > 23 || offMinute > 59) return false;
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  return true;
}

function freezeOwnTree(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) freezeOwnTree(value[i]);
    return Object.freeze(value);
  }
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i += 1) freezeOwnTree(value[keys[i]]);
  return Object.freeze(value);
}

function getStreamState(root, market, symbol, sourceGeneration) {
  const bySymbol = root.get(market);
  if (bySymbol == null) return null;
  const byGeneration = bySymbol.get(symbol);
  if (byGeneration == null) return null;
  const state = byGeneration.get(sourceGeneration);
  return state == null ? null : state;
}

function setStreamState(root, market, symbol, sourceGeneration, state) {
  let bySymbol = root.get(market);
  if (bySymbol == null) {
    bySymbol = new Map();
    root.set(market, bySymbol);
  }
  let byGeneration = bySymbol.get(symbol);
  if (byGeneration == null) {
    byGeneration = new Map();
    bySymbol.set(symbol, byGeneration);
  }
  byGeneration.set(sourceGeneration, state);
}

function canonicalizePaperMarketEvent(raw) {
  if (!isPlainObject(raw)) {
    return fail(ERROR.PAPER_MARKET_EVENT_INVALID_INPUT, "event");
  }

  const ownKeys = Object.keys(raw);
  for (let i = 0; i < ownKeys.length; i += 1) {
    const key = ownKeys[i];
    if (!ALLOWED_FIELD_SET.has(key)) {
      return fail(ERROR.PAPER_MARKET_EVENT_UNKNOWN_FIELD, key);
    }
  }

  for (let i = 0; i < REQUIRED_FIELDS.length; i += 1) {
    const key = REQUIRED_FIELDS[i];
    if (!hasOwnRecordKey(raw, key)) {
      return fail(ERROR.PAPER_MARKET_EVENT_MISSING_FIELD, key);
    }
  }

  const eventId = raw.eventId;
  if (!isNonEmptyString(eventId)) {
    return fail(ERROR.PAPER_MARKET_EVENT_INVALID_EVENT_ID, "eventId");
  }

  const sequence = raw.sequence;
  if (typeof sequence !== "string" || !SEQUENCE_RE.test(sequence)) {
    return fail(ERROR.PAPER_MARKET_EVENT_INVALID_SEQUENCE, "sequence");
  }

  const market = raw.market;
  if (typeof market !== "string" || !PAPER_MARKET_SET.has(market)) {
    return fail(ERROR.PAPER_MARKET_EVENT_INVALID_MARKET, "market");
  }

  const symbol = raw.symbol;
  if (!isNonEmptyString(symbol)) {
    return fail(ERROR.PAPER_MARKET_EVENT_INVALID_SYMBOL, "symbol");
  }

  const tradingDate = raw.tradingDate;
  if (!isValidGregorianYmd(tradingDate)) {
    return fail(ERROR.PAPER_MARKET_EVENT_INVALID_TRADING_DATE, "tradingDate");
  }

  const exchangeEventTime = raw.exchangeEventTime;
  if (!isValidExchangeEventTime(exchangeEventTime)) {
    return fail(ERROR.PAPER_MARKET_EVENT_INVALID_EXCHANGE_EVENT_TIME, "exchangeEventTime");
  }

  const sourceGeneration = raw.sourceGeneration;
  if (!isNonEmptyString(sourceGeneration)) {
    return fail(ERROR.PAPER_MARKET_EVENT_INVALID_SOURCE_GENERATION, "sourceGeneration");
  }

  const open = raw.open;
  if (!isPosSafeInt(open)) {
    return fail(ERROR.PAPER_MARKET_EVENT_INVALID_OPEN, "open");
  }

  const identityFields = {};
  for (let i = 0; i < DIGEST_FIELDS.length; i += 1) {
    const key = DIGEST_FIELDS[i];
    setOwn(identityFields, key, raw[key]);
  }

  let digest;
  try {
    digest = DIGEST_PREFIX + sha256Hex(encodeCanonical(identityFields));
  } catch (_err) {
    return fail(ERROR.PAPER_MARKET_EVENT_INVALID_INPUT, "event");
  }

  const event = {};
  for (let i = 0; i < REQUIRED_FIELDS.length; i += 1) {
    const key = REQUIRED_FIELDS[i];
    setOwn(event, key, deepCloneOwn(raw[key]));
  }
  if (hasOwnRecordKey(raw, "receivedAt")) {
    setOwn(event, "receivedAt", deepCloneOwn(raw.receivedAt));
  }
  setOwn(event, "digest", digest);

  return {
    ok: true,
    code: null,
    event: freezeOwnTree(event),
    digest: digest,
  };
}

function isWeakKey(value) {
  return value != null && (typeof value === "object" || typeof value === "function");
}

function createPaperMarketEventTracker() {
  const lastByTuple = new Map();
  const commitCapability = new WeakMap();
  const issuedNonCommittable = new WeakSet();

  function getLast(market, symbol, sourceGeneration) {
    return getStreamState(lastByTuple, market, symbol, sourceGeneration);
  }

  function classify(raw) {
    const canonical = canonicalizePaperMarketEvent(raw);
    if (!canonical.ok) return canonical;
    const event = canonical.event;
    const digest = canonical.digest;
    const last = getLast(event.market, event.symbol, event.sourceGeneration);
    const seq = BigInt(event.sequence);

    let classification;
    let control = null;

    if (last == null) {
      classification = CLASSIFICATION.BASELINE_CANDIDATE;
    } else {
      const lastSeq = BigInt(last.sequence);
      if (seq === lastSeq) {
        if (digest === last.digest) {
          classification = CLASSIFICATION.NOOP_DUPLICATE;
        } else {
          classification = CLASSIFICATION.IDENTITY_CONFLICT;
          control = CONTROL.HALT_STREAM;
        }
      } else if (seq < lastSeq) {
        classification = CLASSIFICATION.OUT_OF_ORDER;
        control = CONTROL.PAUSE_STREAM;
      } else if (seq === lastSeq + 1n) {
        classification = CLASSIFICATION.ACCEPTABLE;
      } else {
        classification = CLASSIFICATION.SEQUENCE_GAP;
        control = CONTROL.PAUSE_STREAM;
      }
    }

    const committable = classification === CLASSIFICATION.BASELINE_CANDIDATE
      || classification === CLASSIFICATION.ACCEPTABLE;

    const result = freezeOwnTree({
      ok: true,
      code: null,
      classification: classification,
      control: control,
      committable: committable,
      digest: digest,
      sequence: event.sequence,
      event: event,
      lastSequence: last == null ? null : last.sequence,
      lastDigest: last == null ? null : last.digest,
    });

    if (committable) {
      commitCapability.set(result, {
        market: event.market,
        symbol: event.symbol,
        sourceGeneration: event.sourceGeneration,
        sequence: event.sequence,
        digest: digest,
        expectedLastSeq: last == null ? null : last.sequence,
        expectedLastDigest: last == null ? null : last.digest,
        keyRevision: last == null ? 0 : last.keyRevision,
      });
    } else {
      issuedNonCommittable.add(result);
    }

    return result;
  }

  function commit(classification) {
    if (!isWeakKey(classification)) {
      return fail(ERROR.PAPER_MARKET_EVENT_INVALID_COMMIT, "classification");
    }
    if (issuedNonCommittable.has(classification)) {
      issuedNonCommittable.delete(classification);
      return fail(ERROR.PAPER_MARKET_EVENT_COMMIT_NOT_ALLOWED, "classification");
    }
    if (!commitCapability.has(classification)) {
      return fail(ERROR.PAPER_MARKET_EVENT_INVALID_COMMIT, "classification");
    }

    const meta = commitCapability.get(classification);
    commitCapability.delete(classification);

    const last = getLast(meta.market, meta.symbol, meta.sourceGeneration);
    const expectedRev = last == null ? 0 : last.keyRevision;
    const actualSeq = last == null ? null : last.sequence;
    const actualDigest = last == null ? null : last.digest;

    if (meta.keyRevision !== expectedRev
      || meta.expectedLastSeq !== actualSeq
      || meta.expectedLastDigest !== actualDigest) {
      return fail(ERROR.PAPER_MARKET_EVENT_STALE_COMMIT, "classification");
    }

    const nextRev = expectedRev + 1;
    setStreamState(lastByTuple, meta.market, meta.symbol, meta.sourceGeneration, {
      sequence: meta.sequence,
      digest: meta.digest,
      keyRevision: nextRev,
    });
    return {
      ok: true,
      code: null,
      advanced: true,
      lastSequence: meta.sequence,
      lastDigest: meta.digest,
    };
  }

  function inspect(query) {
    const src = isPlainObject(query) ? query : {};
    const market = hasOwnRecordKey(src, "market") ? src.market : undefined;
    const symbol = hasOwnRecordKey(src, "symbol") ? src.symbol : undefined;
    const sourceGeneration = hasOwnRecordKey(src, "sourceGeneration") ? src.sourceGeneration : undefined;
    if (typeof market !== "string" || typeof symbol !== "string" || typeof sourceGeneration !== "string") {
      return { lastSequence: null, lastDigest: null, keyRevision: 0 };
    }
    const last = getLast(market, symbol, sourceGeneration);
    if (last == null) {
      return { lastSequence: null, lastDigest: null, keyRevision: 0 };
    }
    return {
      lastSequence: last.sequence,
      lastDigest: last.digest,
      keyRevision: last.keyRevision,
    };
  }

  return Object.freeze({
    classify: classify,
    commit: commit,
    inspect: inspect,
  });
}

module.exports = {
  canonicalizePaperMarketEvent,
  createPaperMarketEventTracker,
  CLASSIFICATION,
  CONTROL,
  ERROR,
  PAPER_MARKETS,
  DIGEST_PREFIX,
};
