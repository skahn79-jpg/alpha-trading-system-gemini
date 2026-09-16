"use strict";

/**
 * GATE 12AK-R41 — money / BIGINT codecs.
 * Money stays decimal strings; BIGINT never goes through JS Number.
 */

const {
  PaperDbError,
  PAPER_DB_ERROR_CODES,
} = require("./paper-db-error");

const MONEY_RE = /^-?\d+(\.\d{1,4})?$/;
const BIGINT_STRING_RE = /^-?\d+$/;

/**
 * @param {unknown} value
 * @returns {string}
 */
function moneyToDecimalString(value) {
  if (typeof value !== "string") {
    throw new PaperDbError(
      PAPER_DB_ERROR_CODES.DB_NONFINITE_OR_INVALID_MONEY,
      "money must be a finite decimal string"
    );
  }
  if (!MONEY_RE.test(value)) {
    throw new PaperDbError(
      PAPER_DB_ERROR_CODES.DB_NONFINITE_OR_INVALID_MONEY,
      "money string is nonfinite or invalid"
    );
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {{ asBigInt: bigint, asString: string }}
 */
function bigintToCanonical(value) {
  if (typeof value === "number") {
    throw new PaperDbError(
      PAPER_DB_ERROR_CODES.DB_INVALID_BIGINT,
      "bigint must not be converted from Number"
    );
  }

  if (typeof value === "bigint") {
    return {
      asBigInt: value,
      asString: value.toString(),
    };
  }

  if (typeof value === "string" && BIGINT_STRING_RE.test(value)) {
    return {
      asBigInt: BigInt(value),
      asString: value,
    };
  }

  throw new PaperDbError(
    PAPER_DB_ERROR_CODES.DB_INVALID_BIGINT,
    "invalid bigint input"
  );
}

module.exports = {
  moneyToDecimalString,
  bigintToCanonical,
};
