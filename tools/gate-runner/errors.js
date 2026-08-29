"use strict";

const ERROR_EXIT = Object.freeze({
  GATE_RUNNER_INVALID_ARGUMENT: 2,
  GATE_RUNNER_NOT_INITIALIZED: 2,
  GATE_RUNNER_ALREADY_INITIALIZED: 2,
  GATE_RUNNER_INVALID_CONFIG: 2,
  GATE_RUNNER_INVALID_STATE: 2,
  GATE_RUNNER_BUSY: 2,
  GATE_RUNNER_GIT_ERROR: 3,
  GATE_RUNNER_POLICY_VIOLATION: 1,
  GATE_RUNNER_TEST_FAILED: 1,
  GATE_RUNNER_TEST_RESULT_UNKNOWN: 1,
  GATE_RUNNER_TEST_TIMEOUT: 1,
  GATE_RUNNER_TEST_OUTPUT_TRUNCATED: 1,
  GATE_RUNNER_SAFETY_FAILED: 1,
  GATE_RUNNER_HARD_STOP: 1,
  GATE_RUNNER_REPORT_EXISTS: 2,
  GATE_RUNNER_PATH_ESCAPE: 2,
  GATE_RUNNER_SECRET_INGEST_DENIED: 2,
  GATE_RUNNER_P50_PARSE_UNKNOWN: 1,
});

const ERROR_CODES = Object.freeze(Object.keys(ERROR_EXIT));

class GateRunnerError extends Error {
  constructor(code, message, extras) {
    super(message || code);
    this.name = "GateRunnerError";
    this.code = code;
    this.exitCode = Object.prototype.hasOwnProperty.call(ERROR_EXIT, code)
      ? ERROR_EXIT[code]
      : 3;
    if (extras && typeof extras === "object") {
      for (const key of Object.keys(extras)) {
        if (key === "name" || key === "code" || key === "message" || key === "exitCode") continue;
        this[key] = extras[key];
      }
    }
  }
}

function fail(code, message, extras) {
  throw new GateRunnerError(code, message, extras);
}

function isGateRunnerError(err) {
  return Boolean(err && err.name === "GateRunnerError" && typeof err.code === "string");
}

function exitCodeForVerdict(machineVerdict) {
  if (machineVerdict === "PASS" || machineVerdict === "PASS_WITH_NOTES") return 0;
  if (
    machineVerdict === "FAIL" ||
    machineVerdict === "REVIEW_REQUIRED" ||
    machineVerdict === "HARD_STOP"
  ) {
    return 1;
  }
  return 1;
}

module.exports = {
  ERROR_EXIT,
  ERROR_CODES,
  GateRunnerError,
  fail,
  isGateRunnerError,
  exitCodeForVerdict,
};
