import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildResourceSuggestionForm,
  mergeSuggestionDecision,
  parseSuggestionDecision,
} from "../src/lib/ai/suggestions";

const resource = {
  id: "resource-1",
  type: "IMAGE" as const,
  title: "原题",
  summary: "原简介",
  description: "原正文",
  categoryId: "category-1",
  externalUrl: null,
  nsfw: true,
  loginRequired: true,
  allowComments: false,
  isDownloadable: false,
  coverMediaId: "media-2",
  meta: JSON.stringify({
    isAiGenerated: true,
    aiTool: "Tool",
    aiModel: "Model",
    original: true,
    license: "CC",
    sourceNote: "来源",
    downloads: [{ name: "包", kind: "link", url: "https://example.test/a.zip" }],
  }),
  tags: [{ tag: { name: "像素" } }],
  media: [{ id: "media-1" }, { id: "media-2" }],
};

test("builds a complete resource update form while changing only the selected field", () => {
  const form = buildResourceSuggestionForm(resource, { field: "summary", value: "AI 简介" });
  assert.equal(form.get("summary"), "AI 简介");
  assert.equal(form.get("title"), "原题");
  assert.equal(form.get("nsfw"), "on");
  assert.equal(form.get("loginRequired"), "on");
  assert.equal(form.get("allowComments"), null);
  assert.equal(form.get("isDownloadable"), null);
  assert.equal(form.get("isAiGenerated"), "on");
  assert.equal(form.get("aiTool"), "Tool");
  assert.equal(form.get("aiModel"), "Model");
  assert.equal(form.get("original"), "on");
  assert.equal(form.get("sourceNote"), "来源");
  assert.equal(form.get("mediaIds"), '["media-1","media-2"]');
  assert.equal(form.get("coverId"), "media-2");
});

test("tracks field decisions independently", () => {
  const first = mergeSuggestionDecision(parseSuggestionDecision(null), "summary", "accepted");
  const second = mergeSuggestionDecision(first, "title", "rejected");
  assert.deepEqual(second, { accepted: ["summary"], rejected: ["title"] });
});
