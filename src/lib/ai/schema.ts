import { z } from "zod";

// 任务类型（slug 形态，对应 AiTaskKind 的五种）。
export const aiTaskKindSchema = z.enum([
  "resource.enrich",
  "resource.review",
  "image.describe",
  "game.research",
  "site.overview",
]);
export type AiTaskKindSlug = z.infer<typeof aiTaskKindSchema>;

// 单条字段级建议：指明改动哪个资源字段、目标值、理由与置信度。
export const suggestionItemSchema = z.object({
  field: z.enum([
    "title",
    "summary",
    "description",
    "categoryId",
    "tags",
    "externalUrl",
    "version",
    "size",
    "platforms",
    "lang",
    "license",
    "note",
    "isAiGenerated",
    "aiTool",
    "aiModel",
    "original",
    "sourceNote",
  ]),
  value: z.string().max(20_000),
  reason: z.string().max(2_000).optional(),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
});

// 内容补全：只补缺失字段（summary 等），不覆盖已有事实。
export const resourceEnrichOutputSchema = z.object({
  suggestions: z.array(suggestionItemSchema).min(1).max(30),
  missingFields: z.array(z.string().max(100)).max(30).default([]),
});

// 内容审核：列出风险/缺失/修改建议，不作发布或下架决定。
export const resourceReviewOutputSchema = z.object({
  suggestions: z.array(suggestionItemSchema).max(30).default([]),
  risks: z
    .array(
      z.object({
        field: z.string().max(100),
        level: z.enum(["high", "medium", "low"]),
        reason: z.string().max(2_000),
      }),
    )
    .max(50)
    .default([]),
  missingFields: z.array(z.string().max(100)).max(30).default([]),
  recommendation: z.enum(["manual-review", "revise", "no-obvious-issue"]),
});

// 图片描述：草稿简介 + 视觉描述 + 标签，不推断版权或发布结论。
export const imageDescribeOutputSchema = z.object({
  suggestions: z.array(suggestionItemSchema).min(1).max(30),
  visualDescription: z.string().min(1).max(5_000),
  styleTags: z.array(z.string().max(60)).max(30).default([]),
  subjectTags: z.array(z.string().max(60)).max(30).default([]),
});

// 游戏资料研究：事实必须来自允许来源；首期无检索适配器，执行时即失败（见 assertTaskExecutionSupported）。
export const gameResearchOutputSchema = z.object({
  summary: z.string().min(1).max(5000),
  facts: z
    .array(
      z.object({
        label: z.string().min(1).max(200),
        value: z.string().max(2000),
        confidence: z.enum(["high", "medium", "low"]),
      }),
    )
    .max(100),
  caveats: z.array(z.string().max(1000)).max(50),
});

export type GameResearchOutput = z.infer<typeof gameResearchOutputSchema>;

// 站点级运营建议（site.overview）：输入为最近周期的访客浏览聚合快照，产出只读的经营建议。
// 建议是给站长看的结论，不是资源字段建议，因此没有接受/拒绝语义。
export const siteInsightAreaSchema = z.enum([
  "content", // 内容方向/选品
  "search", // 搜索与 SEO
  "promotion", // 推广与曝光
  "community", // 社区与互动
  "experience", // 浏览体验
  "operations", // 运营与治理
]);
export const siteInsightPrioritySchema = z.enum(["high", "medium", "low"]);
export const siteOverviewInsightSchema = z.object({
  area: siteInsightAreaSchema,
  priority: siteInsightPrioritySchema,
  title: z.string().min(1).max(120), // 一句话结论（如「像素素材是近 7 日浏览主力」）
  evidence: z.string().max(800).optional(), // 依据：引用快照中的具体指标
  advice: z.string().min(1).max(1000), // 可执行建议
});
export const siteOverviewOutputSchema = z.object({
  summary: z.string().min(1).max(1500), // 面向站长的本期运营摘要
  insights: z.array(siteOverviewInsightSchema).max(12).default([]),
});
export type SiteOverviewOutput = z.infer<typeof siteOverviewOutputSchema>;

// 每种任务的提示词版本 + 系统提示 + 输出契约，集中一处便于版本追溯。
export const taskContracts = {
  "resource.enrich": {
    promptVersion: "resource-enrich.v1",
    systemPrompt:
      "你是 Pixel Hub 内容补全助手。只依据输入补全缺失字段，不覆盖已有事实；仅返回符合约定的 JSON。",
    outputSchema: resourceEnrichOutputSchema,
  },
  "resource.review": {
    promptVersion: "resource-review.v1",
    systemPrompt:
      "你是 Pixel Hub 内容审核助手。列出风险、缺失与修改建议，不作发布或下架决定；仅返回符合约定的 JSON。",
    outputSchema: resourceReviewOutputSchema,
  },
  "image.describe": {
    promptVersion: "image-describe.v1",
    systemPrompt:
      "你是 Pixel Hub 图片描述助手。只描述可见内容并生成草稿，不推断版权或发布结论；仅返回符合约定的 JSON。",
    outputSchema: imageDescribeOutputSchema,
  },
  "game.research": {
    promptVersion: "game-research.v1",
    systemPrompt:
      "你是 Pixel Hub 游戏资料研究助手。所有事实必须来自已抓取的允许来源；仅返回符合约定的 JSON。",
    outputSchema: gameResearchOutputSchema,
  },
  "site.overview": {
    promptVersion: "site-overview.v1",
    systemPrompt:
      "你是 Pixel Hub 站点运营顾问。只允许基于用户消息中给出的统计快照下结论与提建议；数据样本不足或过低时必须明确说明，不臆测访客画像、不推断用户隐私、不虚构竞品或外部数据；按领域（内容方向、搜索与 SEO、推广、社区与互动、浏览体验、运营与治理）给出结构化建议并说明每条的数据依据；使用简体中文；仅返回符合约定的 JSON。",
    outputSchema: siteOverviewOutputSchema,
  },
} as const satisfies Record<
  AiTaskKindSlug,
  { promptVersion: string; systemPrompt: string; outputSchema: z.ZodTypeAny }
>;

/** 首期可执行性断言：game.research 尚未接入真实检索适配器，禁止以普通模型输出冒充资料来源。 */
export function assertTaskExecutionSupported(kind: AiTaskKindSlug): void {
  if (kind === "game.research") {
    throw new Error("游戏资料联网检索尚未实现，任务不会调用普通模型生成研究结果");
  }
}

/** 解析并校验模型输出：容忍代码围栏包裹的 JSON；非法内容一律视为失败而非原样入库。 */
export function parseStructuredOutput<T>(schema: z.ZodType<T>, content: string): T {
  const normalized = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let value: unknown;
  try {
    value = JSON.parse(normalized);
  } catch {
    throw new Error("AI provider returned invalid JSON");
  }
  const result = schema.safeParse(value);
  if (!result.success)
    throw new Error(`AI provider returned invalid structured output: ${result.error.message}`);
  return result.data;
}
