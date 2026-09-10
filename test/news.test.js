/**
 * 뉴스 RSS 최신성·제목 품질 — 네트워크 호출 0회
 *   실행: node --test test/news.test.js
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const news = require("../crypto-report.js");

const NOW = Date.parse("2026-09-10T07:30:00Z");

function item(title, publishedAt, link = `https://example.com/${encodeURIComponent(title)}`) {
  return { title, link, source: "test", publishedAt };
}

test("withWhenFilter appends when:7d once", () => {
  assert.equal(news.withWhenFilter("트럼프 관세 증시"), "트럼프 관세 증시 when:7d");
  assert.equal(news.withWhenFilter("트럼프 관세 when:7d"), "트럼프 관세 when:7d");
  assert.equal(news.withWhenFilter("foo", false), "foo");
});

test("finalizeNewsItems drops stale, sorts newest first, dedupes, caps limit", () => {
  const items = [
    item("July tariff pause", "2026-07-03T07:00:00.000Z"),
    item("Same story A", "2026-09-09T08:00:00.000Z", "https://news.example/a?x=1"),
    item("Same story A", "2026-09-09T09:00:00.000Z", "https://news.example/a"),
    item("August mover", "2026-08-25T07:00:00.000Z"),
    item("Fresh tariff", "2026-09-09T12:00:00.000Z"),
    item("Undated", null, "https://example.com/undated"),
  ];
  const out = news.finalizeNewsItems(items, { limit: 5, maxAgeDays: 14, now: NOW });
  assert.deepEqual(out.map((x) => x.title), ["Fresh tariff", "Same story A"]);
  assert.ok(out.every((x) => news.isFreshNewsItem(x, 14, NOW)));
});

test("stale July/August trump RSS would be dropped at 14 days", () => {
  const liveLike = [
    item("[뉴욕증시 3일] 트럼프 관세", "2026-09-09T08:26:30.000Z"),
    item("'관세유예' 직전 매수", "2026-07-03T07:00:00.000Z"),
    item("트럭 운송주 하락", "2026-08-25T07:00:00.000Z"),
    item("단타왕 트럼프", "2026-07-03T07:00:00.000Z"),
    item("트루스 소셜 선점권", "2026-07-17T07:00:00.000Z"),
  ];
  const out = news.finalizeNewsItems(liveLike, { limit: 5, maxAgeDays: 14, now: NOW });
  assert.deepEqual(out.map((x) => x.title), ["[뉴욕증시 3일] 트럼프 관세"]);
  const days = out.map((x) => (NOW - Date.parse(x.publishedAt)) / 86400000);
  assert.ok(days.every((d) => d <= 14));
});

test("isGarbledKoTranslation keeps EN for broken Axios headlines", () => {
  const exclusiveEn = "Exclusive: Trump plans to send $500 Obamacare rebates before the election";
  const exclusiveKo = "독점 : 트럼프는 선거 전에 $ 500 Obamacare 리베이트를 보낼 계획입니다";
  assert.equal(news.isGarbledKoTranslation(exclusiveKo, exclusiveEn), true);
  assert.equal(news.preferNewsTitle(exclusiveEn, exclusiveKo), exclusiveEn);

  const anthropicEn = "Scoop: Anthropic whistleblower gave up his equity to leave the company";
  const anthropicKo = "특종: 인류 내부 고발자는 회사를 떠나기 위해 자신의 자산을 포기했습니다.";
  assert.equal(news.isGarbledKoTranslation(anthropicKo, anthropicEn), true);
  assert.equal(news.preferNewsTitle(anthropicEn, anthropicKo), anthropicEn);
});

test("isGarbledKoTranslation allows a decent Korean headline", () => {
  const en = "Energy Department raises 2027 diesel price forecast 33 cents amid Iran war";
  const ko = "에너지부, 이란 전쟁 속에 2027년 디젤 가격 전망 33센트 인상";
  assert.equal(news.isGarbledKoTranslation(ko, en), false);
  assert.equal(news.preferNewsTitle(en, ko), ko);
});

test("parseRssItems reads pubDate and newest-first finalize keeps week-old only", () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><title>Old</title><link>https://a.test/old</link><pubDate>Thu, 03 Jul 2026 07:00:00 GMT</pubDate></item>
    <item><title>New</title><link>https://a.test/new</link><pubDate>Tue, 09 Sep 2026 12:00:00 GMT</pubDate></item>
  </channel></rss>`;
  const parsed = news.parseRssItems(xml, 10);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1].title, "New");
  const fresh = news.finalizeNewsItems(parsed, { limit: 8, maxAgeDays: 7, now: NOW });
  assert.deepEqual(fresh.map((x) => x.title), ["New"]);
});
