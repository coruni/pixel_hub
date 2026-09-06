// 微软 Edge 免费翻译（无鉴权 translatetext 端点）——用于给中文标题生成 SEO 友好的英文 slug
//
// 旧流程（先请求 edge.microsoft.com/translate/auth 取 token，再打 api-edge.../translate）
// 的取 token 端点已于 2026-07 被上游移除；现用其无鉴权继任端点。该端点把请求体当 HTML 跑
// 「标签对齐器」：源文本需先 HTML 转义（裸 "<" 会被并成伪标签），返回文本保持实体编码，
// 故收下后再解码一次。响应结构与旧微软翻译一致：[{ translations: [{ text }] }]。

const ENDPOINT = "https://edge.microsoft.com/translate/translatetext";

// 命中即认为需要翻译（基本区 + 扩展 A 中文）；纯拉丁/数字标题不发起网络请求
const CJK_RE = /[㐀-鿿]/;

const REQUEST_TIMEOUT_MS = 5_000;

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function decodeHtml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * 标题若无中文直接返回 null（无需翻译）；含中文则经 Edge 微软翻译译成英文并返回。
 * 翻译接口不可用/超时/解析失败时吞掉错误并返回 null，由调用方回退原样标题，
 * 绝不让 slug 生成阻塞发布。
 */
export async function translateToEnglish(text: string): Promise<string | null> {
  if (!CJK_RE.test(text)) return null;

  let translated: string;
  try {
    const res = await fetch(`${ENDPOINT}?from=&to=en&isEnterpriseClient=false`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // 裸字符串数组；旧 [{ Text }] 形状会被拒绝
      body: JSON.stringify([escapeHtml(text)]),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`translate http ${res.status}`);
    const data = (await res.json()) as Array<{ translations?: Array<{ text?: string }> }>;
    translated = (data?.[0]?.translations?.[0]?.text ?? "").trim();
  } catch (e) {
    console.warn(
      "[edge-translate] 翻译失败，slug 将回退标题原文：",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
  if (!translated) return null;
  return decodeHtml(translated);
}
