"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const {
  createPaperOperationalConfigSnapshot,
  ERROR,
  SCHEMA_VERSION,
  DIGEST_PREFIX,
  OPERATING_MODE,
} = require("../lib/paper/paper-operational-config");
const {
  createPaperApprovalManager,
} = require("../lib/paper/paper-approval-manager");

function validConfig(over) {
  const config = {
    schemaVersion: "paper-operational-config-v1",
    operatingMode: "MODE_A_SINGLE_PROCESS_EPHEMERAL",
    supportedMarkets: ["KOSPI"],
    marketPolicyVersion: "paper-market-timezone-v1",
    identityPolicyVersion: "paper-market-event-v1",
    calendarPolicy: {
      calendarDatasetId: null,
      calendarVersion: null,
      coverageStatus: "PENDING",
      sessionTypeAllowlist: ["REGULAR_SESSION"],
    },
    approvalPolicy: {
      approvalModel: "EXPLICIT_ONE_TIME",
      oneTimePolicy: true,
      pendingLimit: 1,
      approvalTtlMs: 60000,
      allowedApproverRoles: ["PAPER_OPERATOR"],
    },
    riskPolicy: {
      riskPolicyVersion: "risk-v1",
      maxOrderNotional: 1000000,
      maxPositionNotional: 2000000,
      allowedMarkets: ["KOSPI"],
      allowedSymbols: ["005930"],
    },
    costPolicy: {
      costPolicyVersion: "cost-v1",
      policies: [{ policyId: "p1" }],
      brokerChannel: "SYNTHETIC_ONLINE",
      currency: "KRW",
    },
    killSwitchPolicy: {
      initialExecutionState: "DISABLED_EXECUTION",
      scope: "PROCESS",
    },
    resourcePolicy: {
      maxActiveSessions: 10,
      maxTerminalSessionRecords: 10,
      maxApprovalRecords: 10,
      maxEventTrackerEntries: 10,
    },
  };
  if (over && typeof over === "object") {
    const keys = Object.keys(over);
    for (let i = 0; i < keys.length; i += 1) {
      config[keys[i]] = over[keys[i]];
    }
  }
  return config;
}

function makeClock(start) {
  let t = start;
  return {
    now() {
      return t;
    },
    add(n) {
      t += n;
    },
  };
}

test("F01 valid snapshot ok + configSnapshotId prefix", () => {
  const result = createPaperOperationalConfigSnapshot(validConfig());
  assert.equal(result.ok, true);
  assert.equal(typeof result.configSnapshotId, "string");
  assert.equal(result.configSnapshotId.startsWith(DIGEST_PREFIX), true);
  assert.equal(result.snapshot.configSnapshotId, result.configSnapshotId);
  assert.equal(result.snapshot.schemaVersion, SCHEMA_VERSION);
  assert.equal(result.snapshot.operatingMode, OPERATING_MODE);
  assert.equal(result.snapshot.killSwitchPolicy.initialExecutionState, "DISABLED_EXECUTION");
  assert.equal(result.snapshot.killSwitchPolicy.scope, "PROCESS");
});

test("F02 caller configSnapshotId UNKNOWN", () => {
  const result = createPaperOperationalConfigSnapshot(validConfig({
    configSnapshotId: "paper-operational-config-v1:caller",
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_UNKNOWN_FIELD);
  assert.equal(result.field, "configSnapshotId");
});

test("F03 unknown field foo", () => {
  const result = createPaperOperationalConfigSnapshot(validConfig({ foo: 1 }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_UNKNOWN_FIELD);
  assert.equal(result.field, "foo");
});

test("F04 prototype inherited schemaVersion 0 (Object.create)", () => {
  const own = validConfig();
  delete own.schemaVersion;
  const raw = Object.assign(Object.create({ schemaVersion: SCHEMA_VERSION }), own);
  const result = createPaperOperationalConfigSnapshot(raw);
  assert.equal(result.ok, false);
});

test("F05 deep mutation isolation freeze", () => {
  const input = validConfig();
  const result = createPaperOperationalConfigSnapshot(input);
  assert.equal(result.ok, true);
  input.approvalPolicy.approvalTtlMs = 1;
  input.supportedMarkets.push("KOSDAQ");
  assert.equal(result.snapshot.approvalPolicy.approvalTtlMs, 60000);
  assert.deepEqual(result.snapshot.supportedMarkets, ["KOSPI"]);
  try {
    result.snapshot.approvalPolicy.approvalTtlMs = 1;
  } catch (_ignored) {
    // frozen
  }
  assert.equal(result.snapshot.approvalPolicy.approvalTtlMs, 60000);
  assert.equal(Object.isFrozen(result.snapshot), true);
});

test("F06 MODE_B reject INVALID_OPERATING_MODE", () => {
  const result = createPaperOperationalConfigSnapshot(validConfig({
    operatingMode: "MODE_B",
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_OPERATING_MODE);
});

test("F07 paperEligible true UNKNOWN", () => {
  const result = createPaperOperationalConfigSnapshot(validConfig({
    paperEligible: true,
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_UNKNOWN_FIELD);
  assert.equal(result.field, "paperEligible");
});

test("F08 liveEligible UNKNOWN", () => {
  const result = createPaperOperationalConfigSnapshot(validConfig({
    liveEligible: false,
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_UNKNOWN_FIELD);
  assert.equal(result.field, "liveEligible");
});

test("F09 liveEnabled UNKNOWN", () => {
  const result = createPaperOperationalConfigSnapshot(validConfig({
    liveEnabled: false,
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_UNKNOWN_FIELD);
  assert.equal(result.field, "liveEnabled");
});

test("F10 duplicate markets reject", () => {
  const result = createPaperOperationalConfigSnapshot(validConfig({
    supportedMarkets: ["KOSPI", "KOSPI"],
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_MARKET);
});

test("F11 FOO market reject", () => {
  const result = createPaperOperationalConfigSnapshot(validConfig({
    supportedMarkets: ["FOO"],
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_MARKET);
});

test("F12 PENDING stays PENDING not VERIFIED", () => {
  const result = createPaperOperationalConfigSnapshot(validConfig());
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.calendarPolicy.coverageStatus, "PENDING");
  assert.notEqual(result.snapshot.calendarPolicy.coverageStatus, "VERIFIED");
});

test("F13 VERIFIED without calendarVersion reject", () => {
  const config = validConfig();
  config.calendarPolicy = {
    calendarDatasetId: null,
    calendarVersion: null,
    coverageStatus: "VERIFIED",
    sessionTypeAllowlist: ["REGULAR_SESSION"],
  };
  const result = createPaperOperationalConfigSnapshot(config);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_CALENDAR_POLICY);
});

test("F14 oneTimePolicy false reject", () => {
  const config = validConfig();
  config.approvalPolicy = {
    approvalModel: "EXPLICIT_ONE_TIME",
    oneTimePolicy: false,
    pendingLimit: 1,
    approvalTtlMs: 60000,
    allowedApproverRoles: ["PAPER_OPERATOR"],
  };
  const result = createPaperOperationalConfigSnapshot(config);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_APPROVAL_POLICY);
});

test("F15 TTL 1 ok", () => {
  const config = validConfig();
  config.approvalPolicy = {
    approvalModel: "EXPLICIT_ONE_TIME",
    oneTimePolicy: true,
    pendingLimit: 1,
    approvalTtlMs: 1,
    allowedApproverRoles: ["PAPER_OPERATOR"],
  };
  const result = createPaperOperationalConfigSnapshot(config);
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.approvalPolicy.approvalTtlMs, 1);
});

test("F16 TTL 86400000 ok", () => {
  const config = validConfig();
  config.approvalPolicy = {
    approvalModel: "EXPLICIT_ONE_TIME",
    oneTimePolicy: true,
    pendingLimit: 1,
    approvalTtlMs: 86400000,
    allowedApproverRoles: ["PAPER_OPERATOR"],
  };
  const result = createPaperOperationalConfigSnapshot(config);
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.approvalPolicy.approvalTtlMs, 86400000);
});

test("F17 TTL 0 INVALID_TTL", () => {
  const config = validConfig();
  config.approvalPolicy = {
    approvalModel: "EXPLICIT_ONE_TIME",
    oneTimePolicy: true,
    pendingLimit: 1,
    approvalTtlMs: 0,
    allowedApproverRoles: ["PAPER_OPERATOR"],
  };
  const result = createPaperOperationalConfigSnapshot(config);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_TTL);
});

test("F18 TTL 86400001 INVALID_TTL", () => {
  const config = validConfig();
  config.approvalPolicy = {
    approvalModel: "EXPLICIT_ONE_TIME",
    oneTimePolicy: true,
    pendingLimit: 1,
    approvalTtlMs: 86400001,
    allowedApproverRoles: ["PAPER_OPERATOR"],
  };
  const result = createPaperOperationalConfigSnapshot(config);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_TTL);
});

test("F19 maxOrderNotional string 100 reject", () => {
  const config = validConfig();
  config.riskPolicy = {
    riskPolicyVersion: "risk-v1",
    maxOrderNotional: "100",
    maxPositionNotional: 2000000,
    allowedMarkets: ["KOSPI"],
    allowedSymbols: ["005930"],
  };
  const result = createPaperOperationalConfigSnapshot(config);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_RISK_POLICY);
});

test("F20 currency USD reject", () => {
  const config = validConfig();
  config.costPolicy = {
    costPolicyVersion: "cost-v1",
    policies: [{ policyId: "p1" }],
    brokerChannel: "SYNTHETIC_ONLINE",
    currency: "USD",
  };
  const result = createPaperOperationalConfigSnapshot(config);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_COST_POLICY);
});

test("F21 brokerChannel not SYNTHETIC_ONLINE reject", () => {
  const config = validConfig();
  config.costPolicy = {
    costPolicyVersion: "cost-v1",
    policies: [{ policyId: "p1" }],
    brokerChannel: "LIVE_ONLINE",
    currency: "KRW",
  };
  const result = createPaperOperationalConfigSnapshot(config);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_COST_POLICY);
});

test("F22 omit killSwitch MISSING", () => {
  const config = validConfig();
  delete config.killSwitchPolicy;
  const result = createPaperOperationalConfigSnapshot(config);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_MISSING_FIELD);
});

test("F23 initialExecutionState OPEN reject", () => {
  const config = validConfig();
  config.killSwitchPolicy = {
    initialExecutionState: "OPEN",
    scope: "PROCESS",
  };
  const result = createPaperOperationalConfigSnapshot(config);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_KILL_SWITCH);
});

test("F24 ENABLED reject", () => {
  const config = validConfig();
  config.killSwitchPolicy = {
    initialExecutionState: "ENABLED_EXECUTION",
    scope: "PROCESS",
  };
  const result = createPaperOperationalConfigSnapshot(config);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_KILL_SWITCH);
});

test("F25 resource 0 reject", () => {
  const config = validConfig();
  config.resourcePolicy = {
    maxActiveSessions: 0,
    maxTerminalSessionRecords: 10,
    maxApprovalRecords: 10,
    maxEventTrackerEntries: 10,
  };
  const result = createPaperOperationalConfigSnapshot(config);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_RESOURCE_POLICY);
});

test("F26 resource 10001 reject", () => {
  const config = validConfig();
  config.resourcePolicy = {
    maxActiveSessions: 10001,
    maxTerminalSessionRecords: 10,
    maxApprovalRecords: 10,
    maxEventTrackerEntries: 10,
  };
  const result = createPaperOperationalConfigSnapshot(config);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_RESOURCE_POLICY);
});

test("F27 resource 1 and 10000 ok", () => {
  const low = validConfig();
  low.resourcePolicy = {
    maxActiveSessions: 1,
    maxTerminalSessionRecords: 1,
    maxApprovalRecords: 1,
    maxEventTrackerEntries: 1,
  };
  const high = validConfig();
  high.resourcePolicy = {
    maxActiveSessions: 10000,
    maxTerminalSessionRecords: 10000,
    maxApprovalRecords: 10000,
    maxEventTrackerEntries: 10000,
  };
  assert.equal(createPaperOperationalConfigSnapshot(low).ok, true);
  assert.equal(createPaperOperationalConfigSnapshot(high).ok, true);
});

test("F28 unknown gapPolicy field reject", () => {
  const result = createPaperOperationalConfigSnapshot(validConfig({
    gapPolicy: "FILL",
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_UNKNOWN_FIELD);
  assert.equal(result.field, "gapPolicy");
});

test("F29 no hotReload on snapshot", () => {
  const result = createPaperOperationalConfigSnapshot(validConfig());
  assert.equal(result.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(result.snapshot, "hotReload"), false);
  assert.equal(typeof result.snapshot.hotReload, "undefined");
});

test("F30 insertion order same ID", () => {
  const a = {
    resourcePolicy: {
      maxActiveSessions: 10,
      maxTerminalSessionRecords: 10,
      maxApprovalRecords: 10,
      maxEventTrackerEntries: 10,
    },
    killSwitchPolicy: {
      initialExecutionState: "DISABLED_EXECUTION",
      scope: "PROCESS",
    },
    costPolicy: {
      costPolicyVersion: "cost-v1",
      policies: [{ policyId: "p1" }],
      brokerChannel: "SYNTHETIC_ONLINE",
      currency: "KRW",
    },
    riskPolicy: {
      riskPolicyVersion: "risk-v1",
      maxOrderNotional: 1000000,
      maxPositionNotional: 2000000,
      allowedMarkets: ["KOSPI"],
      allowedSymbols: ["005930"],
    },
    approvalPolicy: {
      approvalModel: "EXPLICIT_ONE_TIME",
      oneTimePolicy: true,
      pendingLimit: 1,
      approvalTtlMs: 60000,
      allowedApproverRoles: ["PAPER_OPERATOR"],
    },
    calendarPolicy: {
      calendarDatasetId: null,
      calendarVersion: null,
      coverageStatus: "PENDING",
      sessionTypeAllowlist: ["REGULAR_SESSION"],
    },
    identityPolicyVersion: "paper-market-event-v1",
    marketPolicyVersion: "paper-market-timezone-v1",
    supportedMarkets: ["KOSPI"],
    operatingMode: "MODE_A_SINGLE_PROCESS_EPHEMERAL",
    schemaVersion: "paper-operational-config-v1",
  };
  const first = createPaperOperationalConfigSnapshot(a);
  const second = createPaperOperationalConfigSnapshot(validConfig());
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.configSnapshotId, second.configSnapshotId);
});

test("F31 ttl change different ID", () => {
  const a = validConfig();
  const b = validConfig();
  b.approvalPolicy = {
    approvalModel: "EXPLICIT_ONE_TIME",
    oneTimePolicy: true,
    pendingLimit: 1,
    approvalTtlMs: 59999,
    allowedApproverRoles: ["PAPER_OPERATOR"],
  };
  const first = createPaperOperationalConfigSnapshot(a);
  const second = createPaperOperationalConfigSnapshot(b);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.configSnapshotId, second.configSnapshotId);
});

test("F32 kbApiKey SECRET_FORBIDDEN", () => {
  const result = createPaperOperationalConfigSnapshot(validConfig({
    kbApiKey: "dummy",
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_SECRET_FORBIDDEN);
  assert.equal(result.field, "kbApiKey");
});

test("F33 kbSecret forbidden", () => {
  const result = createPaperOperationalConfigSnapshot(validConfig({
    kbSecret: "dummy",
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_SECRET_FORBIDDEN);
  assert.equal(result.field, "kbSecret");
});

test("F34 liveBrokerToken forbidden", () => {
  const result = createPaperOperationalConfigSnapshot(validConfig({
    liveBrokerToken: "dummy",
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_SECRET_FORBIDDEN);
  assert.equal(result.field, "liveBrokerToken");
});

test("F35 password forbidden", () => {
  const result = createPaperOperationalConfigSnapshot(validConfig({
    password: "dummy",
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_SECRET_FORBIDDEN);
  assert.equal(result.field, "password");
});

test("F36 accessToken forbidden", () => {
  const result = createPaperOperationalConfigSnapshot(validConfig({
    accessToken: "dummy",
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_SECRET_FORBIDDEN);
  assert.equal(result.field, "accessToken");
});

test("F37 source scan no paperEligible: true", () => {
  const src = readFileSync(join(__dirname, "../lib/paper/paper-operational-config.js"), "utf8");
  assert.equal(src.includes("paperEligible: true"), false);
});

test("F38 adapterPolicy omit ok", () => {
  const result = createPaperOperationalConfigSnapshot(validConfig());
  assert.equal(result.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(result.snapshot, "adapterPolicy"), false);
});

test("F39 adapterPolicy {maxEventAgeMs:1,maxReceiveLagMs:1} ok", () => {
  const result = createPaperOperationalConfigSnapshot(validConfig({
    adapterPolicy: { maxEventAgeMs: 1, maxReceiveLagMs: 1 },
  }));
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.adapterPolicy.maxEventAgeMs, 1);
  assert.equal(result.snapshot.adapterPolicy.maxReceiveLagMs, 1);
});

test("F40 adapterPolicy maxEventAgeMs 0 reject", () => {
  const result = createPaperOperationalConfigSnapshot(validConfig({
    adapterPolicy: { maxEventAgeMs: 0, maxReceiveLagMs: 1 },
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_ADAPTER_POLICY);
});

test("F41 digest field UNKNOWN", () => {
  const result = createPaperOperationalConfigSnapshot(validConfig({
    digest: "caller",
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_UNKNOWN_FIELD);
  assert.equal(result.field, "digest");
});

test("F42 null input SNAPSHOT_REQUIRED", () => {
  const result = createPaperOperationalConfigSnapshot(null);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_SNAPSHOT_REQUIRED);
});

test("F43 empty supportedMarkets reject", () => {
  const result = createPaperOperationalConfigSnapshot(validConfig({
    supportedMarkets: [],
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_MARKET);
});

test("F44 sessionTypeAllowlist not exactly REGULAR_SESSION reject", () => {
  const config = validConfig();
  config.calendarPolicy = {
    calendarDatasetId: null,
    calendarVersion: null,
    coverageStatus: "PENDING",
    sessionTypeAllowlist: ["PRE_MARKET"],
  };
  const result = createPaperOperationalConfigSnapshot(config);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_CALENDAR_POLICY);
});

test("F45 pendingLimit 2 reject", () => {
  const config = validConfig();
  config.approvalPolicy = {
    approvalModel: "EXPLICIT_ONE_TIME",
    oneTimePolicy: true,
    pendingLimit: 2,
    approvalTtlMs: 60000,
    allowedApproverRoles: ["PAPER_OPERATOR"],
  };
  const result = createPaperOperationalConfigSnapshot(config);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_APPROVAL_POLICY);
});

test("F46 allowedApproverRoles ADMIN reject", () => {
  const config = validConfig();
  config.approvalPolicy = {
    approvalModel: "EXPLICIT_ONE_TIME",
    oneTimePolicy: true,
    pendingLimit: 1,
    approvalTtlMs: 60000,
    allowedApproverRoles: ["ADMIN"],
  };
  const result = createPaperOperationalConfigSnapshot(config);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_APPROVAL_POLICY);
});

test("F47 duplicate PAPER_OPERATOR reject", () => {
  const config = validConfig();
  config.approvalPolicy = {
    approvalModel: "EXPLICIT_ONE_TIME",
    oneTimePolicy: true,
    pendingLimit: 1,
    approvalTtlMs: 60000,
    allowedApproverRoles: ["PAPER_OPERATOR", "PAPER_OPERATOR"],
  };
  const result = createPaperOperationalConfigSnapshot(config);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_APPROVAL_POLICY);
});

test("F48 NaN maxOrderNotional reject", () => {
  const config = validConfig();
  config.riskPolicy = {
    riskPolicyVersion: "risk-v1",
    maxOrderNotional: Number.NaN,
    maxPositionNotional: 2000000,
    allowedMarkets: ["KOSPI"],
    allowedSymbols: ["005930"],
  };
  const result = createPaperOperationalConfigSnapshot(config);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_RISK_POLICY);
});

test("F49 Infinity resource reject", () => {
  const config = validConfig();
  config.resourcePolicy = {
    maxActiveSessions: Infinity,
    maxTerminalSessionRecords: 10,
    maxApprovalRecords: 10,
    maxEventTrackerEntries: 10,
  };
  const result = createPaperOperationalConfigSnapshot(config);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_RESOURCE_POLICY);
});

test("F50 KOSPI+KOSDAQ unique ok", () => {
  const result = createPaperOperationalConfigSnapshot(validConfig({
    supportedMarkets: ["KOSPI", "KOSDAQ"],
  }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.snapshot.supportedMarkets, ["KOSPI", "KOSDAQ"]);
});

test("F51 no reload method", () => {
  const result = createPaperOperationalConfigSnapshot(validConfig());
  assert.equal(result.ok, true);
  assert.equal(typeof result.snapshot.reload, "undefined");
  assert.equal(typeof result.reload, "undefined");
  assert.equal(typeof createPaperOperationalConfigSnapshot.reload, "undefined");
});

test("F52 CROSS snapshot.configSnapshotId usable as approval subject configSnapshotId", () => {
  const snap = createPaperOperationalConfigSnapshot(validConfig());
  assert.equal(snap.ok, true);
  const mgr = createPaperApprovalManager({
    clock: makeClock(1_000_000),
    approvalTtlMs: 60_000,
  });
  const issued = mgr.issue({
    subject: {
      accountId: "acc-1",
      sessionId: "ses-1",
      market: "KOSPI",
      symbol: "005930",
      tradingDate: "2026-09-01",
      sequence: "1",
      eventDigest: "paper-market-event-v1:abc",
      intentId: "int-1",
      intentDigest: "paper-intent-v1:abc",
      riskDecisionId: "risk-1",
      riskDecisionDigest: "paper-risk-v1:abc",
      configSnapshotId: snap.configSnapshotId,
    },
    approvedByPrincipal: "op-1",
  });
  assert.equal(issued.ok, true);
});

test("F53 kill scope not PROCESS reject", () => {
  const config = validConfig();
  config.killSwitchPolicy = {
    initialExecutionState: "DISABLED_EXECUTION",
    scope: "ACCOUNT",
  };
  const result = createPaperOperationalConfigSnapshot(config);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR.PAPER_OPERATIONAL_CONFIG_INVALID_KILL_SWITCH);
});
