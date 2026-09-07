import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resourceSlugOf,
  siteOverviewCycleDays,
  siteOverviewIdempotencyKey,
  summarizeSiteVisits,
} from "../src/lib/ai/site-insight";
import { siteOverviewOutputSchema } from "../src/lib/ai/schema";

test("cycle key & idempotency key are stable and daily-scoped", () => {
  const { from, to } = siteOverviewCycleDays();
  assert.match(from, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(to, /^\d{4}-\d{2}-\d{2}$/);
  assert.notEqual(from, to); // 采样为 7 天窗口，起止不同日
  assert.equal(siteOverviewIdempotencyKey(from), `site-overview:${from}:v1`);
  assert.equal(siteOverviewIdempotencyKey("2026-09-01"), "site-overview:2026-09-01:v1");
  assert.notEqual(
    siteOverviewIdempotencyKey("2026-09-01"),
    siteOverviewIdempotencyKey("2026-09-02"),
  );
});

test("resourceSlugOf decodes detail slugs and rejects others", () => {
  assert.equal(resourceSlugOf("/resources/foo-bar"), "foo-bar");
  assert.equal(resourceSlugOf("/resources/foo-bar?tab=2"), "foo-bar");
  assert.equal(resourceSlugOf("/resources/%E4%B9%99"), "乙");
  assert.equal(resourceSlugOf("/"), null);
  assert.equal(resourceSlugOf("/resources"), null);
  assert.equal(resourceSlugOf("/resources/"), null);
  assert.equal(resourceSlugOf("/resources/a/b"), null);
  assert.equal(resourceSlugOf("/api/track"), null);
  assert.equal(resourceSlugOf(""), null);
});

test("summarizeSiteVisits aggregates by slug and whitelists non-resource pages", () => {
  const rows = [
    { path: "/resources/a", pv: 5 },
    { path: "/resources/a", pv: 2 },
    { path: "/resources/%E4%B9%99", pv: 3 },
    { path: "/", pv: 9 },
    { path: "/search?q=pixel", pv: 4 },
    { path: "/api/track", pv: 99 }, // 不在页面白名单 → 丢弃
    { path: "/resources", pv: 1 }, // 非详情层级 → 丢弃
  ];
  const s = summarizeSiteVisits(rows);
  assert.deepEqual(s.resources, [
    { slug: "a", views: 7 },
    { slug: "乙", views: 3 },
  ]);
  assert.deepEqual(s.pages, [
    { path: "/", views: 9 },
    { path: "/search", views: 4 },
  ]);
});

test("siteOverviewOutputSchema accepts a valid site overview", () => {
  const result = siteOverviewOutputSchema.safeParse({
    summary: "近 7 日像素素材仍是浏览主力。",
    insights: [
      {
        area: "content",
        priority: "high",
        title: "热门分类内容增速偏低",
        evidence: "top10 浏览资源中 8 条集中在图片，游戏新上架为 0。",
        advice: "补充游戏整包与多语言条目，承接现有搜索流量。",
      },
    ],
  });
  assert.equal(result.success, true);
});

test("siteOverviewOutputSchema rejects malformed insights", () => {
  const base = { summary: "摘要", insights: [] as unknown[] };
  // 未知 area
  assert.equal(
    siteOverviewOutputSchema.safeParse({
      ...base,
      insights: [{ area: "hack", priority: "high", title: "t", advice: "a" }],
    }).success,
    false,
  );
  // 未知 priority
  assert.equal(
    siteOverviewOutputSchema.safeParse({
      ...base,
      insights: [{ area: "content", priority: "urgent", title: "t", advice: "a" }],
    }).success,
    false,
  );
  // 超长 advice
  assert.equal(
    siteOverviewOutputSchema.safeParse({
      ...base,
      insights: [{ area: "content", priority: "high", title: "t", advice: "a".repeat(2_000) }],
    }).success,
    false,
  );
  // 空 summary
  assert.equal(siteOverviewOutputSchema.safeParse({ summary: "", insights: [] }).success, false);
});
