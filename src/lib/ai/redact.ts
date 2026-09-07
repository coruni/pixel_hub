// 发送给模型前的输入脱敏：递归替换敏感键与常见的邮箱/密钥串，避免把客户数据写入提示词与 AiTask。
// 只保留结构，AI 建议与运行记录不依赖被脱敏字段的原文。
const SENSITIVE_KEY =
  /^(password|secret|token|api[-_]?key|authorization|cookie|email|phone|ip|ip[-_]?address)$/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER = /\b(?:sk|pk)-[A-Z0-9_-]{8,}\b/gi;

export function buildRedactedInput<T>(input: T): T {
  if (Array.isArray(input)) return input.map(buildRedactedInput) as T;
  if (typeof input === "string")
    return input.replace(EMAIL, "[REDACTED]").replace(BEARER, "[REDACTED]") as T;
  if (!input || typeof input !== "object") return input;
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[REDACTED]" : buildRedactedInput(value),
    ]),
  ) as T;
}
