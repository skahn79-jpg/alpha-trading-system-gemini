const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildApnsPayload } = require("../apns");

test("APNs payload duplicates title/body and ticker fields for tap reconstruction", () => {
  const payload = buildApnsPayload({
    title: "테스트전자 알림",
    body: "현재가 80000 ≥ 목표 79000",
    code: "005930",
    name: "테스트전자",
    kind: "priceAbove",
    id: "alert-1",
    detail: "현재가 80000 ≥ 목표 79000",
  });
  assert.equal(payload.aps.alert.title, "테스트전자 알림");
  assert.equal(payload.aps.alert.body, "현재가 80000 ≥ 목표 79000");
  assert.equal(payload.title, "테스트전자 알림");
  assert.equal(payload.body, "현재가 80000 ≥ 목표 79000");
  assert.equal(payload.detail, "현재가 80000 ≥ 목표 79000");
  assert.equal(payload.code, "005930");
  assert.equal(payload.name, "테스트전자");
  assert.equal(payload.kind, "priceAbove");
  assert.equal(payload.id, "alert-1");
});

test("APNs payload falls back to remote kind and body as detail", () => {
  const payload = buildApnsPayload({ title: "ALPHA", body: "테스트 푸시" });
  assert.equal(payload.kind, "remote");
  assert.equal(payload.detail, "테스트 푸시");
  assert.equal(payload.code, undefined);
});
