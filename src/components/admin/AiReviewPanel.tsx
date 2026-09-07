"use client";

// 网站管家任务卡片：展示任务/建议状态、当前值与建议值、置信度、理由与来源；
// 版主可执行/重试/重新生成，仅管理员可接受/拒绝字段建议。
import { useAction } from "@/lib/hooks";
import {
  acceptAiSuggestionAction,
  rejectAiSuggestionAction,
  retryAiTaskAction,
  executeAiTaskAction,
  regenerateAiTaskAction,
} from "@/lib/actions/ai";
import { BTN_PRIMARY_SM, BTN_DANGER_SM } from "@/lib/ui/cls";

type SuggestionItem = { field: string; value: string; reason?: string; confidence?: string };
type Task = {
  id: string;
  kind: string;
  kindLabel: string;
  status: string;
  statusLabel: string;
  title: string;
  createdAt: string;
  current: Record<string, unknown>;
  suggestions: {
    id: string;
    status: string;
    outputJson: string;
    decisionJson: string | null;
  }[];
  sources: { title: string | null; locator: string | null; excerpt: string | null }[];
  lastRun: { errorMessage: string | null } | null;
};

function parseOutput(json: string): {
  suggestions?: SuggestionItem[];
  summary?: string;
  facts?: { label: string; value: string; confidence: string }[];
} {
  try {
    return JSON.parse(json) as {
      suggestions?: SuggestionItem[];
      summary?: string;
      facts?: { label: string; value: string; confidence: string }[];
    };
  } catch {
    return {};
  }
}
function parseDecisions(json: string | null): { accepted?: string[]; rejected?: string[] } {
  if (!json) return {};
  try {
    return JSON.parse(json) as { accepted?: string[]; rejected?: string[] };
  } catch {
    return {};
  }
}
const CONFIDENCE_LABEL: Record<string, string> = { high: "高", medium: "中", low: "低" };

export default function AiReviewPanel({
  tasks,
  canOperate,
  isAdmin,
}: {
  tasks: Task[];
  canOperate: boolean;
  isAdmin: boolean;
}) {
  const { run, pending } = useAction();
  const invoke = async (action: () => Promise<{ ok?: boolean; error?: string }>) => {
    const result = await action();
    return { ok: !!result.ok, error: result.error };
  };
  if (!tasks.length)
    return (
      <div className="border border-brand-200 bg-surface px-5 py-12 text-center text-sm text-neutral-400">
        暂无 AI 任务
      </div>
    );
  return (
    <div className="space-y-3">
      {tasks.map((task) => {
        const suggestion = task.suggestions[0];
        const parsed = suggestion ? parseOutput(suggestion.outputJson) : {};
        const items =
          parsed.suggestions ??
          (parsed.summary
            ? [
                {
                  field: "summary",
                  value: parsed.summary,
                  reason: "游戏资料研究结果",
                  confidence: "medium",
                },
              ]
            : []);
        const decisions = suggestion ? parseDecisions(suggestion.decisionJson) : {};
        return (
          <article key={task.id} className="border border-brand-200 bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-sm font-medium text-neutral-900">{task.title}</h3>
                  <span className="border border-brand-200 px-2 py-0.5 text-xs text-brand-700">
                    {task.kindLabel}
                  </span>
                  <span className="text-xs text-neutral-500">{task.statusLabel}</span>
                </div>
                <p className="mt-1 text-xs text-neutral-400">
                  {new Date(task.createdAt).toLocaleString("zh-CN")}
                </p>
              </div>
              {canOperate && (
                <div className="flex flex-wrap gap-2">
                  {task.status === "FAILED" && (
                    <button
                      type="button"
                      disabled={pending}
                      className={BTN_PRIMARY_SM}
                      onClick={() => run(() => invoke(() => retryAiTaskAction(task.id)))}
                    >
                      重试
                    </button>
                  )}
                  {task.status === "QUEUED" && (
                    <button
                      type="button"
                      disabled={pending}
                      className={BTN_PRIMARY_SM}
                      onClick={() => run(() => invoke(() => executeAiTaskAction(task.id)))}
                    >
                      执行
                    </button>
                  )}
                  {task.status === "SUCCEEDED" && (
                    <button
                      type="button"
                      disabled={pending}
                      className={BTN_PRIMARY_SM}
                      onClick={() => run(() => invoke(() => regenerateAiTaskAction(task.id)))}
                    >
                      重新生成
                    </button>
                  )}
                </div>
              )}
            </div>
            {task.lastRun?.errorMessage && (
              <p className="mt-3 border-l-2 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-700">
                执行失败，请检查 AI 配置后重试。
              </p>
            )}
            {items.length > 0 && (
              <div className="mt-4 space-y-2">
                {items.map((item, i) => {
                  const done =
                    decisions.accepted?.includes(item.field) ||
                    decisions.rejected?.includes(item.field);
                  const accepted = decisions.accepted?.includes(item.field);
                  return (
                    <div key={`${item.field}-${i}`} className="border border-neutral-100 p-3">
                      <div className="grid gap-2 sm:grid-cols-[7rem_1fr]">
                        <strong className="text-xs text-neutral-500">{item.field}</strong>
                        <div>
                          <p className="text-xs text-neutral-400">
                            当前值：{String(task.current[item.field] ?? "（空）")}
                          </p>
                          <p className="mt-1 text-sm text-neutral-900">建议值：{item.value}</p>
                          <p className="mt-1 text-xs text-neutral-500">
                            {item.reason ?? "AI 草稿"} · 置信度：
                            {CONFIDENCE_LABEL[item.confidence ?? "medium"] ?? "中"}
                          </p>
                        </div>
                      </div>
                      {isAdmin && suggestion && !done && suggestion.status === "PENDING" && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={pending}
                            className={BTN_PRIMARY_SM}
                            onClick={() =>
                              run(() =>
                                invoke(() => acceptAiSuggestionAction(suggestion.id, item.field)),
                              )
                            }
                          >
                            接受此字段
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            className={BTN_DANGER_SM}
                            onClick={() =>
                              run(() =>
                                invoke(() => rejectAiSuggestionAction(suggestion.id, item.field)),
                              )
                            }
                          >
                            拒绝此字段
                          </button>
                        </div>
                      )}
                      {done && (
                        <p className="mt-2 text-xs text-neutral-500">
                          {accepted ? "已接受" : "已拒绝"}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {task.sources.length > 0 && (
              <div className="mt-3 border-t border-neutral-100 pt-3 text-xs text-neutral-500">
                <span className="mr-2 font-medium">来源：</span>
                {task.sources.map((s, i) => {
                  let external = false;
                  try {
                    const url = new URL(s.locator ?? "");
                    external = url.protocol === "http:" || url.protocol === "https:";
                  } catch {
                    /* 站内资源标识不是外链 */
                  }
                  return (
                    <span key={i} className="mr-3 inline-block max-w-full align-top">
                      <span className="mr-1 font-medium">{s.title ?? "用户输入"}</span>
                      {external ? (
                        <a
                          href={s.locator!}
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand-700 underline"
                        >
                          打开链接
                        </a>
                      ) : (
                        s.locator && <span>（{s.locator}）</span>
                      )}
                      {s.excerpt && (
                        <span className="block max-w-xl truncate text-neutral-400">
                          摘录：{s.excerpt}
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
