'use strict';

const { RESEARCH } = require('./mosConfig');

function parseHm(hm) {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

function minutesInTz(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour').value);
  const minute = Number(parts.find((p) => p.type === 'minute').value);
  return hour * 60 + minute;
}

function evaluateSessionGate(opts = {}) {
  const market = opts.market || 'KR';
  const now = opts.now || new Date();
  const s = RESEARCH.session;

  if (opts.sessionOverride) {
    const o = opts.sessionOverride;
    return {
      session: o,
      alertOk: o !== 'closed',
      autoEnterOk: o === 'regular' || (o === 'extended' && s.autoEnterExtended),
      autoExitExtendedRiskOnly: o === 'extended' || o === 'pre',
      reasons: [`override:${o}`],
    };
  }

  if (market === 'US') {
    const mins = minutesInTz(now, 'America/New_York');
    const r0 = parseHm(s.usRth.start);
    const r1 = parseHm(s.usRth.end);
    if (mins >= r0 && mins < r1) {
      return { session: 'regular', alertOk: true, autoEnterOk: true, reasons: ['us_rth'] };
    }
    if (mins >= parseHm('04:00') && mins < r0) {
      return {
        session: 'pre',
        alertOk: true,
        autoEnterOk: !!s.autoEnterExtended,
        autoExitExtendedRiskOnly: true,
        reasons: ['us_pre'],
      };
    }
    if (mins >= r1 && mins < parseHm('20:00')) {
      return {
        session: 'extended',
        alertOk: true,
        autoEnterOk: !!s.autoEnterExtended,
        autoExitExtendedRiskOnly: true,
        reasons: ['us_after'],
      };
    }
    return { session: 'closed', alertOk: true, autoEnterOk: false, reasons: ['us_closed_or_night'] };
  }

  const mins = minutesInTz(now, 'Asia/Seoul');
  if (mins >= parseHm(s.krxRegular.start) && mins < parseHm(s.krxRegular.end)) {
    return { session: 'regular', alertOk: true, autoEnterOk: true, reasons: ['krx_regular'] };
  }
  if (mins >= parseHm(s.nxtPre.start) && mins < parseHm(s.nxtPre.end)) {
    return {
      session: 'pre',
      alertOk: true,
      autoEnterOk: !!s.autoEnterExtended,
      autoExitExtendedRiskOnly: true,
      reasons: ['nxt_pre'],
    };
  }
  if (mins >= parseHm(s.krxAfter.start) && mins < parseHm(s.krxAfter.end)) {
    return {
      session: 'extended',
      alertOk: true,
      autoEnterOk: !!s.autoEnterExtended,
      autoExitExtendedRiskOnly: true,
      reasons: ['krx_after_2026-09-14'],
    };
  }
  if (mins >= parseHm(s.nxtAfter.start) && mins < parseHm(s.nxtAfter.end)) {
    return {
      session: 'extended',
      alertOk: true,
      autoEnterOk: !!s.autoEnterExtended,
      autoExitExtendedRiskOnly: true,
      reasons: ['nxt_after'],
    };
  }
  return { session: 'closed', alertOk: true, autoEnterOk: false, reasons: ['kr_closed'] };
}

function evaluateSpikeGate(p = {}) {
  const g = RESEARCH.spike;
  const reasons = [];
  let abortEnter = false;
  let accelerateExit = false;
  let needsReconfirm = false;

  if (p.halted) {
    reasons.push('HALT_VI');
    abortEnter = true;
  }
  if (p.ret1m != null && p.ret1m >= g.chasePctPerMin) {
    reasons.push('SPIKE_CHASE_1M');
    if (p.side !== 'exit') abortEnter = true;
  }
  if (p.retSinceSignal != null && p.retSinceSignal >= g.chasePctSinceSignal) {
    reasons.push('SPIKE_CHASE_SINCE_SIGNAL');
    if (p.side !== 'exit') abortEnter = true;
  }
  if (p.gapOpen != null && p.gapOpen >= g.gapOpenPct && p.side !== 'exit') {
    reasons.push('GAP_OPEN');
    abortEnter = true;
  }
  if (p.crash5m != null && p.crash5m <= -g.crashExitPctPer5m && p.side === 'exit') {
    reasons.push('CRASH_EXIT');
    accelerateExit = true;
  }
  if (p.bounceFrom5dLow != null && p.bounceFrom5dLow > 0.08 && p.side !== 'exit') {
    reasons.push('PSY_CHASE_BOUNCE');
    needsReconfirm = true;
  }

  const extended = p.session === 'extended' || p.session === 'pre';
  return {
    abortEnter,
    accelerateExit,
    needsReconfirm,
    rearmMinutes: g.rearmMinutes,
    maxSlippageBps: extended ? g.maxSlippageBpsExtended : g.maxSlippageBpsRth,
    reasons,
  };
}

module.exports = { evaluateSessionGate, evaluateSpikeGate, parseHm };
