"use strict";

function evaluatePolicy(gitSnapshot, state) {
  const findings = [];
  const tracks = (state && state.tracks) || {};
  const trackedDirty = Array.isArray(gitSnapshot && gitSnapshot.trackedDirty)
    ? gitSnapshot.trackedDirty
    : [];
  const staged = Array.isArray(gitSnapshot && gitSnapshot.staged) ? gitSnapshot.staged : [];
  const head = gitSnapshot && gitSnapshot.head;

  for (const name of Object.keys(tracks)) {
    const track = tracks[name];
    if (!track) continue;
    if (track.phase === "CONTRACT" && trackedDirty.length > 0) {
      findings.push({
        code: "GATE_RUNNER_POLICY_VIOLATION",
        severity: "MEDIUM",
        track: name,
        message: `${name} is in CONTRACT with a dirty tracked worktree`,
        paths: trackedDirty.slice(),
      });
    }
    const expected = track.expectedHead;
    if (typeof expected === "string" && /^[0-9a-f]{40}$/.test(expected) && head && expected !== head) {
      findings.push({
        code: "GATE_RUNNER_POLICY_VIOLATION",
        severity: "MEDIUM",
        track: name,
        message: `${name} expectedHead does not match actual HEAD`,
        expectedHead: expected,
        actualHead: head,
      });
    }
  }

  if (staged.length > 0) {
    findings.push({
      code: "GATE_RUNNER_POLICY_VIOLATION",
      severity: "MEDIUM",
      message: "staged files are forbidden in v1",
      paths: staged.slice(),
    });
  }

  return findings;
}

module.exports = {
  evaluatePolicy,
};
