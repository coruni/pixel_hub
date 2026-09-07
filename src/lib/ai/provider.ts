// OpenAI-compatible /chat/completions 客户端：读取服务端环境变量，缺配置即报可读错误。
// 固定超时/响应上限/数值校验，避免把外部响应或越界 token 直接写库。
export type ProviderConfig = {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  /** 测试注入用 */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
};
export type CompletionInput = { system: string; user: string; imageUrls?: string[] };
export type CompletionResult = {
  content: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
};

export function createOpenAICompatibleProvider(config: ProviderConfig = {}) {
  const fetchImpl = config.fetchImpl ?? fetch;
  return {
    async complete(input: CompletionInput): Promise<CompletionResult> {
      if (!config.baseUrl?.trim() || !config.apiKey?.trim() || !config.model?.trim())
        throw new Error(
          "AI provider is not configured: set AI_PROVIDER_BASE_URL, AI_PROVIDER_API_KEY, and AI_PROVIDER_MODEL",
        );
      const endpoint = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;

      // 仅发送可访问的图片输入（http(s)/data:image），其余静默丢弃，避免把存储 key 发给外部。
      const imageUrls = (input.imageUrls ?? []).filter((url) =>
        /^(https?:\/\/|data:image\/)/i.test(url),
      );
      const userContent = imageUrls.length
        ? [
            { type: "text", text: input.user },
            ...imageUrls.map((url) => ({ type: "image_url", image_url: { url } })),
          ]
        : input.user;

      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
        signal: AbortSignal.timeout(config.timeoutMs ?? 30_000),
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: userContent },
          ],
        }),
      });

      const maxResponseBytes = config.maxResponseBytes ?? 1_048_576;
      const declaredLength = Number(response.headers.get("content-length") ?? 0);
      if (declaredLength > maxResponseBytes) throw new Error("AI provider response is too large");
      const raw = await response.text();
      if (new TextEncoder().encode(raw).byteLength > maxResponseBytes)
        throw new Error("AI provider response is too large");

      let payload: {
        choices?: Array<{ message?: { content?: unknown } }>;
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
        error?: { message?: string };
      } = {};
      try {
        payload = JSON.parse(raw);
      } catch {
        /* 交由下面的响应状态分支给出可读错误 */
      }
      if (!response.ok)
        throw new Error(
          `AI provider request failed (${response.status}): ${payload.error?.message ?? "unknown error"}`,
        );
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("AI provider returned no message content");

      // token 数值校验：非负安全整数才记，避免外部脏数据污染统计。
      const token = (value: unknown) =>
        typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
      const inputTokens = token(payload.usage?.prompt_tokens);
      const outputTokens = token(payload.usage?.completion_tokens);
      const totalTokens = token(payload.usage?.total_tokens) || inputTokens + outputTokens;
      return { content, usage: { inputTokens, outputTokens, totalTokens } };
    },
  };
}

/** 从服务端环境变量构造默认 provider（缺任一配置由 complete 抛可读错误）。 */
export function providerFromEnv() {
  return createOpenAICompatibleProvider({
    baseUrl: process.env.AI_PROVIDER_BASE_URL,
    apiKey: process.env.AI_PROVIDER_API_KEY,
    model: process.env.AI_PROVIDER_MODEL,
  });
}
