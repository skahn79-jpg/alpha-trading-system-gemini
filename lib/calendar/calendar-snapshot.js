/**
 * 캘린더 스냅샷 검증·로드.
 * 손상 스냅샷을 빈 캘린더로 바꿔 성공시키지 않는다 (fail-closed).
 */

"use strict";

const {
  CANONICALIZATION_VERSION,
  verifySnapshotIntegrity,
  withChecksums,
  CALENDAR_CANONICALIZATION_UNSUPPORTED,
  CONTENT_CHECKSUM_MISMATCH,
  METADATA_HASH_MISMATCH,
  CALENDAR_VERSION_CONFLICT,
} = require("./calendar-checksum");
const {
  isWeekendUtcCivilDate,
} = require("./krx-calendar");
const {
  TIMEZONE_SEOUL,
  isKnownSessionType,
} = require("./session-schedule");
const {
  INVALID_DATE_FORMAT,
  INVALID_DATE_VALUE,
  COMPLETENESS,
  VERIFICATION_STATUS,
  parseCalendarDate,
  createCalendarProvider,
  createUnavailableCalendarProvider,
  assertCalendarAccess,
  LOAD_MODE,
  SYNTHETIC_FIXTURE_NOT_ALLOWED,
  TEST_VERIFICATION_STATUS_NOT_ALLOWED,
  SYNTHETIC_FIXTURE_CANNOT_BE_PRODUCTION_VERIFIED,
  PRODUCTION_NOT_ELIGIBLE,
} = require("./calendar-provider");

const CALENDAR_SCHEMA_INVALID = "CALENDAR_SCHEMA_INVALID";
const CALENDAR_DUPLICATE_DATE = "CALENDAR_DUPLICATE_DATE";
const CALENDAR_WEEKEND_TRADING_DAY = "CALENDAR_WEEKEND_TRADING_DAY";
const CALENDAR_DATE_OUT_OF_COVERAGE = "CALENDAR_DATE_OUT_OF_COVERAGE";
const CALENDAR_SESSION_CONFLICT = "CALENDAR_SESSION_CONFLICT";
const CALENDAR_SOURCE_CONFLICT = "CALENDAR_SOURCE_CONFLICT";

const COMPLETENESS_VALUES = new Set(Object.values(COMPLETENESS));
const VERIFICATION_VALUES = new Set(Object.values(VERIFICATION_STATUS));
const TIME_RE = /^\d{2}:\d{2}:\d{2}$/;

function fail(code, error) {
  return { ok: false, code, error: error || code };
}

function isValidClock(value) {
  if (!TIME_RE.test(value)) return false;
  const hh = Number(value.slice(0, 2));
  const mm = Number(value.slice(3, 5));
  const ss = Number(value.slice(6, 8));
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59 && ss >= 0 && ss <= 59;
}

function requireCalendarDate(value, label) {
  if (typeof value !== "string") {
    return fail(INVALID_DATE_FORMAT, `${label} must be YYYY-MM-DD`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return fail(INVALID_DATE_FORMAT, `${label} INVALID_DATE_FORMAT`);
  }
  const parsed = parseCalendarDate(value);
  if (!parsed.ok) return fail(parsed.code, parsed.error);
  return { ok: true, date: parsed.date };
}

function findDuplicates(dates) {
  const seen = new Set();
  for (const d of dates) {
    if (seen.has(d)) return d;
    seen.add(d);
  }
  return null;
}

function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return fail(CALENDAR_SCHEMA_INVALID, "snapshot must be an object");
  }
  if (typeof snapshot.calendarId !== "string" || !snapshot.calendarId) {
    return fail(CALENDAR_SCHEMA_INVALID, "missing calendarId");
  }
  if (typeof snapshot.calendarVersion !== "string" || !snapshot.calendarVersion) {
    return fail(CALENDAR_SCHEMA_INVALID, "missing calendarVersion");
  }
  if (snapshot.canonicalizationVersion !== CANONICALIZATION_VERSION) {
    return fail(CALENDAR_CANONICALIZATION_UNSUPPORTED, "canonicalizationVersion must be calendar-c14n-v1");
  }

  const coverage = snapshot.coverage;
  if (!coverage || typeof coverage !== "object") {
    return fail(CALENDAR_SCHEMA_INVALID, "missing coverage");
  }
  const startCheck = requireCalendarDate(coverage.start, "coverage.start");
  if (!startCheck.ok) {
    if (startCheck.code === INVALID_DATE_FORMAT || startCheck.code === INVALID_DATE_VALUE) {
      return fail(CALENDAR_SCHEMA_INVALID, startCheck.error);
    }
    return startCheck;
  }
  const endCheck = requireCalendarDate(coverage.end, "coverage.end");
  if (!endCheck.ok) {
    if (endCheck.code === INVALID_DATE_FORMAT || endCheck.code === INVALID_DATE_VALUE) {
      return fail(CALENDAR_SCHEMA_INVALID, endCheck.error);
    }
    return endCheck;
  }
  if (startCheck.date > endCheck.date) {
    return fail(CALENDAR_SCHEMA_INVALID, "coverage start is after end");
  }
  if (!COMPLETENESS_VALUES.has(coverage.completeness)) {
    return fail(CALENDAR_SCHEMA_INVALID, "unknown completeness");
  }

  if (snapshot.verificationStatus != null && !VERIFICATION_VALUES.has(snapshot.verificationStatus)) {
    return fail(CALENDAR_SCHEMA_INVALID, "unknown verificationStatus");
  }

  if (!Array.isArray(snapshot.tradingDays)) {
    return fail(CALENDAR_SCHEMA_INVALID, "tradingDays must be an array");
  }
  if (snapshot.markets != null && !Array.isArray(snapshot.markets)) {
    return fail(CALENDAR_SCHEMA_INVALID, "markets must be an array");
  }
  if (snapshot.sessionExceptions != null && !Array.isArray(snapshot.sessionExceptions)) {
    return fail(CALENDAR_SCHEMA_INVALID, "sessionExceptions must be an array");
  }
  if (snapshot.sources != null && !Array.isArray(snapshot.sources)) {
    return fail(CALENDAR_SCHEMA_INVALID, "sources must be an array");
  }

  const tradingDays = [];
  for (const raw of snapshot.tradingDays) {
    const checked = requireCalendarDate(raw, "tradingDays");
    if (!checked.ok) return fail(checked.code, checked.error);
    tradingDays.push(checked.date);
  }
  const dupDay = findDuplicates(tradingDays);
  if (dupDay) {
    return fail(CALENDAR_DUPLICATE_DATE, `duplicate trading day ${dupDay}`);
  }
  for (const d of tradingDays) {
    if (isWeekendUtcCivilDate(d)) {
      return fail(CALENDAR_WEEKEND_TRADING_DAY, `weekend trading day ${d}`);
    }
    if (d < startCheck.date || d > endCheck.date) {
      return fail(CALENDAR_DATE_OUT_OF_COVERAGE, `trading day ${d} out of coverage`);
    }
  }

  const sessionExceptions = Array.isArray(snapshot.sessionExceptions) ? snapshot.sessionExceptions : [];
  const sessionDates = [];
  const tradingSet = new Set(tradingDays);
  for (const ex of sessionExceptions) {
    if (!ex || typeof ex !== "object") {
      return fail(CALENDAR_SCHEMA_INVALID, "session exception must be an object");
    }
    const checked = requireCalendarDate(ex.date, "sessionExceptions.date");
    if (!checked.ok) return fail(checked.code, checked.error);
    sessionDates.push(checked.date);
    if (checked.date < startCheck.date || checked.date > endCheck.date) {
      return fail(CALENDAR_DATE_OUT_OF_COVERAGE, `session exception ${checked.date} out of coverage`);
    }
    if (!tradingSet.has(checked.date)) {
      return fail(CALENDAR_SESSION_CONFLICT, `session exception on non-trading day ${checked.date}`);
    }
    if (ex.sessionType != null && !isKnownSessionType(ex.sessionType)) {
      return fail(CALENDAR_SCHEMA_INVALID, "unknown sessionType");
    }
    const hasTime = ex.marketOpenTime != null || ex.marketCloseTime != null;
    if (ex.marketOpenTime != null && !isValidClock(ex.marketOpenTime)) {
      return fail(CALENDAR_SCHEMA_INVALID, "bad marketOpenTime format");
    }
    if (ex.marketCloseTime != null && !isValidClock(ex.marketCloseTime)) {
      return fail(CALENDAR_SCHEMA_INVALID, "bad marketCloseTime format");
    }
    if (hasTime && ex.timezone != null && ex.timezone !== TIMEZONE_SEOUL) {
      return fail(CALENDAR_SCHEMA_INVALID, "timezone must be Asia/Seoul when time is present");
    }
    if (hasTime && (ex.timezone == null || ex.timezone === "")) {
      return fail(CALENDAR_SCHEMA_INVALID, "timezone must be Asia/Seoul when time is present");
    }
  }
  const dupSession = findDuplicates(sessionDates);
  if (dupSession) {
    return fail(CALENDAR_DUPLICATE_DATE, `duplicate session exception ${dupSession}`);
  }

  const sources = Array.isArray(snapshot.sources) ? snapshot.sources : [];
  const sourceRefs = new Set();
  for (const src of sources) {
    if (!src || typeof src !== "object") {
      return fail(CALENDAR_SCHEMA_INVALID, "source must be an object");
    }
    if (typeof src.sourceRef !== "string" || !src.sourceRef) {
      return fail(CALENDAR_SCHEMA_INVALID, "missing sourceRef");
    }
    sourceRefs.add(src.sourceRef);
  }
  if (snapshot.sourceConflict === true) {
    return fail(CALENDAR_SOURCE_CONFLICT, "snapshot.sourceConflict is true");
  }
  for (const ex of sessionExceptions) {
    if (ex.sourceRef != null && !sourceRefs.has(ex.sourceRef)) {
      return fail(CALENDAR_SOURCE_CONFLICT, `sourceRef ${ex.sourceRef} not in sources`);
    }
  }
  if (snapshot.sourceRef != null && !sourceRefs.has(snapshot.sourceRef)) {
    return fail(CALENDAR_SOURCE_CONFLICT, "snapshot.sourceRef not in sources");
  }

  const integrity = verifySnapshotIntegrity(snapshot);
  if (!integrity.ok) {
    return fail(integrity.code, integrity.error);
  }

  const normalized = {
    ...snapshot,
    coverage: {
      start: startCheck.date,
      end: endCheck.date,
      completeness: coverage.completeness,
    },
    tradingDays,
    sessionExceptions,
    sources,
    verificationStatus: snapshot.verificationStatus || VERIFICATION_STATUS.PENDING,
    contentChecksum: integrity.contentChecksum,
    metadataHash: integrity.metadataHash,
    contentChecksumVerified: true,
    metadataHashVerified: true,
  };
  delete normalized.provenanceChecksum;

  return { ok: true, snapshot: normalized, code: null, error: null };
}

function loadFailure(result) {
  return {
    ok: false,
    provider: createUnavailableCalendarProvider({ code: result.code }),
    code: result.code,
    error: result.error,
    providerStatus: "UNAVAILABLE",
  };
}

function loadCalendarSnapshot(snapshot, opts) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return loadFailure(validateSnapshot(snapshot));
  }
  const access = assertCalendarAccess(snapshot, opts);
  if (!access.ok) {
    return loadFailure(access);
  }
  const validated = validateSnapshot(snapshot);
  if (!validated.ok) {
    return loadFailure(validated);
  }
  return {
    ok: true,
    provider: createCalendarProvider(validated.snapshot, opts),
    code: null,
    error: null,
  };
}

module.exports = {
  CALENDAR_SCHEMA_INVALID,
  CALENDAR_DUPLICATE_DATE,
  CALENDAR_WEEKEND_TRADING_DAY,
  CALENDAR_DATE_OUT_OF_COVERAGE,
  CALENDAR_SESSION_CONFLICT,
  CALENDAR_SOURCE_CONFLICT,
  CONTENT_CHECKSUM_MISMATCH,
  METADATA_HASH_MISMATCH,
  CALENDAR_VERSION_CONFLICT,
  CALENDAR_CANONICALIZATION_UNSUPPORTED,
  INVALID_DATE_FORMAT,
  INVALID_DATE_VALUE,
  LOAD_MODE,
  SYNTHETIC_FIXTURE_NOT_ALLOWED,
  TEST_VERIFICATION_STATUS_NOT_ALLOWED,
  SYNTHETIC_FIXTURE_CANNOT_BE_PRODUCTION_VERIFIED,
  PRODUCTION_NOT_ELIGIBLE,
  validateSnapshot,
  loadCalendarSnapshot,
  withChecksums,
};
