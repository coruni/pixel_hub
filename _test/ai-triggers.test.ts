import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aiTriggerIdempotencyKey,
  regeneratedTaskKey,
  resourceAiTriggerKinds,
} from "../src/lib/ai/enqueue";

test("resource AI trigger keys are stable and distinct by kind", () => {
  const enrich = aiTriggerIdempotencyKey("resource.enrich", "resource-1");
  assert.equal(enrich, "resource:resource-1:resource.enrich:v1");
  assert.notEqual(enrich, aiTriggerIdempotencyKey("image.describe", "resource-1"));
  assert.equal(enrich, aiTriggerIdempotencyKey("resource.enrich", "resource-1"));
});

test("resource AI triggers only describe image media", () => {
  assert.deepEqual(resourceAiTriggerKinds(null, ["image/png"]), [
    "resource.enrich",
    "image.describe",
  ]);
  assert.deepEqual(resourceAiTriggerKinds("已有简介", ["image/jpeg"]), ["image.describe"]);
  assert.deepEqual(resourceAiTriggerKinds("已有简介", ["application/zip", null]), []);
  assert.deepEqual(resourceAiTriggerKinds("", []), ["resource.enrich"]);
});

test("regeneration gets a fresh key without weakening the original idempotency key", () => {
  assert.equal(
    aiTriggerIdempotencyKey("resource.enrich", "resource-1"),
    "resource:resource-1:resource.enrich:v1",
  );
  assert.notEqual(
    regeneratedTaskKey("manual-enrich:resource-1", "run-2"),
    "manual-enrich:resource-1",
  );
  assert.equal(
    regeneratedTaskKey("manual-enrich:resource-1", "run-2"),
    "manual-enrich:resource-1:regenerate:run-2",
  );
  assert.match(regeneratedTaskKey("x".repeat(200), "run-2"), /:regenerate:run-2$/);
});
