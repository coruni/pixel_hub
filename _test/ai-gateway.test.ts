import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRedactedInput } from "../src/lib/ai/redact";
import {
  assertTaskExecutionSupported,
  parseStructuredOutput,
  gameResearchOutputSchema,
  taskContracts,
} from "../src/lib/ai/schema";
import { createOpenAICompatibleProvider } from "../src/lib/ai/provider";

test("redacts secrets and direct personal identifiers from provider input", () => {
  const result = buildRedactedInput({
    title: "Test game",
    email: "person@example.com",
    password: "secret",
    apiKey: "sk-secret-value",
    description: "Public text person@example.com",
  });
  assert.equal(result.email, "[REDACTED]");
  assert.equal(result.password, "[REDACTED]");
  assert.equal(result.apiKey, "[REDACTED]");
  assert.equal(result.description, "Public text [REDACTED]");
});

test("parses and validates structured game research output", () => {
  const parsed = parseStructuredOutput(
    gameResearchOutputSchema,
    JSON.stringify({
      summary: "A concise summary",
      facts: [{ label: "Developer", value: "Studio", confidence: "high" }],
      caveats: ["No network research performed"],
    }),
  );
  assert.equal(parsed.facts[0].label, "Developer");
});

test("rejects malformed structured output", () => {
  assert.throws(() => parseStructuredOutput(gameResearchOutputSchema, "not json"));
});

test("returns readable error when provider configuration is missing", async () => {
  const provider = createOpenAICompatibleProvider({ baseUrl: "", apiKey: "", model: "" });
  await assert.rejects(
    () => provider.complete({ system: "sys", user: "user" }),
    /AI provider is not configured/i,
  );
});

test("maps chat completion content and usage", async () => {
  const provider = createOpenAICompatibleProvider({
    baseUrl: "https://example.test",
    apiKey: "key",
    model: "model",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
        }),
        { status: 200 },
      ),
  });
  const result = await provider.complete({ system: "sys", user: "user" });
  assert.equal(result.content, '{"ok":true}');
  assert.deepEqual(result.usage, { inputTokens: 3, outputTokens: 4, totalTokens: 7 });
});

test("uses a distinct prompt and schema contract for every task kind", () => {
  const kinds = ["resource.enrich", "resource.review", "image.describe", "game.research"] as const;
  assert.equal(new Set(kinds.map((kind) => taskContracts[kind].promptVersion)).size, kinds.length);
  for (const kind of kinds) {
    assert.match(taskContracts[kind].systemPrompt, /JSON/);
    assert.ok(taskContracts[kind].outputSchema);
  }
});

test("game research fails explicitly until a real retrieval adapter exists", () => {
  assert.throws(() => assertTaskExecutionSupported("game.research"), /联网检索尚未实现/);
  assert.doesNotThrow(() => assertTaskExecutionSupported("resource.enrich"));
});

test("sends accessible image URLs as multimodal input", async () => {
  let body: Record<string, unknown> | undefined;
  const provider = createOpenAICompatibleProvider({
    baseUrl: "https://example.test",
    apiKey: "key",
    model: "model",
    fetchImpl: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"suggestions":[]}' } }] }),
        { status: 200 },
      );
    },
  });
  await provider.complete({
    system: "sys",
    user: "user",
    imageUrls: ["https://cdn.example.test/a.png"],
  });
  const messages = body?.messages as Array<{ content: unknown }>;
  assert.deepEqual(messages[1].content, [
    { type: "text", text: "user" },
    { type: "image_url", image_url: { url: "https://cdn.example.test/a.png" } },
  ]);
});

test("rejects oversized provider responses before parsing", async () => {
  const provider = createOpenAICompatibleProvider({
    baseUrl: "https://example.test",
    apiKey: "key",
    model: "model",
    maxResponseBytes: 32,
    fetchImpl: async () => new Response("x".repeat(33), { status: 200 }),
  });
  await assert.rejects(
    () => provider.complete({ system: "sys", user: "user" }),
    /response is too large/i,
  );
});
