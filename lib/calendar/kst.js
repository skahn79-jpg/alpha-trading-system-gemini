/**
 * KST (Asia/Seoul) 날짜·시각 포맷.
 * 시스템 로컬 getFullYear/getMonth/getDate 를 쓰지 않는다.
 * process.env.TZ 와 무관하게 Intl timeZone: "Asia/Seoul" 만 사용한다.
 */

"use strict";

const KST = "Asia/Seoul";

const KST_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: KST,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toDate(input) {
  if (input instanceof Date) return input;
  if (typeof input === "number" && Number.isFinite(input)) return new Date(input);
  if (typeof input === "string") {
    const s = input.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return new Date(`${s}T00:00:00+09:00`);
    }
    if (/^\d{8}$/.test(s)) {
      return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00+09:00`);
    }
    return new Date(s);
  }
  return new Date(input);
}

function kstParts(date) {
  const map = Object.create(null);
  for (const part of KST_PARTS.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return map;
}

function formatKstDate(input) {
  const date = toDate(input);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("invalid date");
  }
  const p = kstParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

function formatKstDateTimeIso(input) {
  const date = toDate(input);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("invalid date");
  }
  const p = kstParts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+09:00`;
}

module.exports = {
  formatKstDate,
  formatKstDateTimeIso,
};
