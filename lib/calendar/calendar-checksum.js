/**
 * 캘린더 스냅샷 정규화·체크섬.
 * crypto builtin만 사용한다. 운영 KRX 공휴일 날짜를 포함하지 않는다.
 *
 * 정규화: UTF-8, BOM 없음, 객체 키 정렬, tradingDays 오름차순,
 * sessionExceptions 날짜순, sources 안정 정렬.
 * 날짜 YYYY-MM-DD, 시각 HH:mm:ss.
 * contentChecksum / metadataHash 는 입력에서 제외한다.
 */

"use strict";

const crypto = require("crypto");

const CANONICALIZATION_VERSION = "calendar-c14n-v1";
const CALENDAR_CANONICALIZATION_UNSUPPORTED = "CALENDAR_CANONICALIZATION_UNSUPPORTED";
const CALENDAR_VERSION_CONFLICT = "CALENDAR_VERSION_CONFLICT";
const CONTENT_CHECKSUM_MISMATCH = "CONTENT_CHECKSUM_MISMATCH";
const METADATA_HASH_MISMATCH = "METADATA_HASH_MISMATCH";

const CONTENT_EXCLUDED_KEYS = new Set([
  "contentChecksum",
  "metadataHash",
  "checksum",
  "generatedAt",
  "loaderTimestamp",
  "provenanceChecksum",
  "contentChecksumVerified",
  "metadataHashVerified",
  "verifiedAt",
]);

const METADATA_EXCLUDED_KEYS = new Set([
  "contentChecksum",
  "metadataHash",
  "checksum",
  "generatedAt",
  "loaderTimestamp",
  "provenanceChecksum",
  "contentChecksumVerified",
  "metadataHashVerified",
]);

const TIME_KEYS = new Set(["marketOpenTime", "marketCloseTime"]);

function makeCodeError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function assertCanonicalizationVersion(snapshot) {
  const version = snapshot && snapshot.canonicalizationVersion;
  if (version !== CANONICALIZATION_VERSION) {
    throw makeCodeError(
      CALENDAR_CANONICALIZATION_UNSUPPORTED,
      "canonicalizationVersion must be calendar-c14n-v1",
    );
  }
}

function normalizeTimeValue(value) {
  if (value == null) return value;
  if (typeof value !== "string") return value;
  if (/^\d{2}:\d{2}$/.test(value)) return `${value}:00`;
  return value;
}

function stripExcluded(value, parentKey, excludedKeys) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") {
    if (TIME_KEYS.has(parentKey)) return normalizeTimeValue(value);
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((item) => stripExcluded(item, parentKey, excludedKeys));
  }
  if (typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (excludedKeys.has(key)) continue;
      const next = stripExcluded(value[key], key, excludedKeys);
      if (next !== undefined) out[key] = next;
    }
    return out;
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(value);
}

function sortByDate(a, b) {
  const da = a && a.date != null ? String(a.date) : "";
  const db = b && b.date != null ? String(b.date) : "";
  if (da < db) return -1;
  if (da > db) return 1;
  return 0;
}

function sortSources(a, b) {
  const ra = a && a.sourceRef != null ? String(a.sourceRef) : "";
  const rb = b && b.sourceRef != null ? String(b.sourceRef) : "";
  if (ra < rb) return -1;
  if (ra > rb) return 1;
  const na = a && a.name != null ? String(a.name) : "";
  const nb = b && b.name != null ? String(b.name) : "";
  if (na < nb) return -1;
  if (na > nb) return 1;
  return 0;
}

function buildContentObject(snapshot) {
  const tradingDays = Array.isArray(snapshot.tradingDays)
    ? [...snapshot.tradingDays].map((d) => String(d)).sort()
    : [];
  const sessionExceptions = Array.isArray(snapshot.sessionExceptions)
    ? [...snapshot.sessionExceptions].sort(sortByDate)
    : [];
  const markets = Array.isArray(snapshot.markets)
    ? [...snapshot.markets].map((m) => (m == null ? m : String(m))).sort()
    : snapshot.markets;
  return stripExcluded({
    calendarId: snapshot.calendarId,
    calendarVersion: snapshot.calendarVersion,
    canonicalizationVersion: snapshot.canonicalizationVersion,
    coverage: snapshot.coverage,
    markets,
    sessionExceptions,
    tradingDays,
  }, null, CONTENT_EXCLUDED_KEYS);
}

function buildMetadataObject(snapshot) {
  const sources = Array.isArray(snapshot.sources)
    ? [...snapshot.sources].sort(sortSources)
    : [];
  let supersedes = snapshot.supersedes;
  if (Array.isArray(supersedes)) {
    supersedes = [...supersedes].map((v) => (v == null ? v : String(v))).sort();
  } else if (supersedes === undefined) {
    supersedes = null;
  }
  return stripExcluded({
    sources,
    supersedes,
    verifiedAt: snapshot.verifiedAt,
  }, null, METADATA_EXCLUDED_KEYS);
}

function canonicalizeCalendarContent(snapshot) {
  assertCanonicalizationVersion(snapshot);
  return stableStringify(buildContentObject(snapshot));
}

function canonicalizeCalendarMetadata(snapshot) {
  assertCanonicalizationVersion(snapshot);
  return stableStringify(buildMetadataObject(snapshot));
}

function sha256Utf8Hex(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function computeContentChecksum(snapshot) {
  return sha256Utf8Hex(canonicalizeCalendarContent(snapshot));
}

function computeMetadataHash(snapshot) {
  return sha256Utf8Hex(canonicalizeCalendarMetadata(snapshot));
}

function isSha256Hex(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function verifySnapshotIntegrity(snapshot) {
  try {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      return { ok: false, code: "CALENDAR_SCHEMA_INVALID", error: "snapshot must be an object" };
    }
    assertCanonicalizationVersion(snapshot);
    const contentChecksum = computeContentChecksum(snapshot);
    const metadataHash = computeMetadataHash(snapshot);
    if (snapshot.contentChecksum != null) {
      if (!isSha256Hex(snapshot.contentChecksum) || snapshot.contentChecksum !== contentChecksum) {
        return { ok: false, code: CONTENT_CHECKSUM_MISMATCH, error: "contentChecksum mismatch" };
      }
    }
    if (snapshot.metadataHash != null) {
      if (!isSha256Hex(snapshot.metadataHash) || snapshot.metadataHash !== metadataHash) {
        return { ok: false, code: METADATA_HASH_MISMATCH, error: "metadataHash mismatch" };
      }
    }
    return {
      ok: true,
      code: null,
      error: null,
      contentChecksum,
      metadataHash,
    };
  } catch (err) {
    if (err && err.code) {
      return { ok: false, code: err.code, error: err.message };
    }
    throw err;
  }
}

function withChecksums(snapshot) {
  const copy = { ...snapshot };
  delete copy.provenanceChecksum;
  copy.contentChecksum = computeContentChecksum(copy);
  copy.metadataHash = computeMetadataHash(copy);
  return copy;
}

function readContentChecksum(snapshot) {
  if (snapshot && isSha256Hex(snapshot.contentChecksum)) return snapshot.contentChecksum;
  return computeContentChecksum(snapshot);
}

function assertCompatibleVersion(snapshot, reference) {
  try {
    if (!snapshot || typeof snapshot !== "object") {
      return { ok: false, code: "CALENDAR_SCHEMA_INVALID", error: "snapshot must be an object" };
    }
    assertCanonicalizationVersion(snapshot);
    if (reference && typeof reference === "object") {
      if (reference.canonicalizationVersion != null) {
        assertCanonicalizationVersion(reference);
      }
      if (snapshot.calendarVersion === reference.calendarVersion) {
        const a = readContentChecksum(snapshot);
        const b = readContentChecksum(reference);
        if (a !== b) {
          return {
            ok: false,
            code: CALENDAR_VERSION_CONFLICT,
            error: "same calendarVersion with different contentChecksum",
          };
        }
      }
    }
    return { ok: true, code: null, error: null };
  } catch (err) {
    if (err && err.code) {
      return { ok: false, code: err.code, error: err.message };
    }
    throw err;
  }
}

module.exports = {
  CANONICALIZATION_VERSION,
  CALENDAR_CANONICALIZATION_UNSUPPORTED,
  CALENDAR_VERSION_CONFLICT,
  CONTENT_CHECKSUM_MISMATCH,
  METADATA_HASH_MISMATCH,
  canonicalizeCalendarContent,
  canonicalizeCalendarMetadata,
  computeContentChecksum,
  computeMetadataHash,
  verifySnapshotIntegrity,
  withChecksums,
  assertCompatibleVersion,
};
