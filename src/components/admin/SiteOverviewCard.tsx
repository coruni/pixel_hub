"use client";

// /admin 概览顶部的「AI 运营建议」卡片：只读展示最近一条 SITE_OVERVIEW 结果（摘要 + 分条建议），
// 提供「生成 / 重新生成」入口（见 src/lib/actions/site-overview.ts）。AI 只出建议，不写任何资源。
// 生成采用异步后台执行（startAiTaskInBackground）：点击立即置 RUNNING，模型在服务端后台跑完落库，
// 本卡片在 RUNNING 期间每 4s 自动刷新一次直至终态，避免同步长请求被 Cloudflare 等反代 ~100s 掐断。
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "@/lib/hooks";
import { runSiteOverviewAction, refreshSiteOverviewAction } from "@/lib/actions/site-overview";
import { BTN_GHOST_SM, BTN_PRIMARY_SM } from "@/lib/ui/cls";
import { Button } from "@/components/ui/Button";

export type SiteOverviewItemView = {
  area: string;
  priority: string;
  title: string;
  evidence: string;
  advice: string;
};
export type SiteOverviewView = {
  taskId: string;
  status: "SUCCEEDED" | "FAILED" | "QUEUED" | "RUNNING";
  createdAt: string;
  from: string | null;
  to: string | null;
  summary: string;
  parseFailed: boolean;
  insights: SiteOverviewItemView[];
};

const AREA_LABEL: Record<string, string> = {
  content: "内容方向",
  search: "搜索与 SEO",
  promotion: "推广与曝光",
  community: "社区与互动",
  experience: "浏览体验",
  operations: "运营与治理",
};
const PRIORITY: Record<string, { label: string; chip: string }> = {
  high: { label: "高优先级", chip: "border-red-200 bg-red-50 text-red-700" },
  medium: { label: "中优先级", chip: "border-amber-200 bg-amber-50 text-amber-700" },
  low: { label: "低优先级", chip: "border-neutral-200 bg-surface text-neutral-600" },
};

function statusNote(status: SiteOverviewView["status"]): string {
  switch (status) {
    case "SUCCEEDED":
      return "已生成";
    case "FAILED":
      return "上次生成失败";
    case "RUNNING":
      return "正在生成…";
    default:
      return "排队中";
  }
}

export default function SiteOverviewCard({ view }: { view: SiteOverviewView | null }) {
  const { run, pending } = useAction();
  const router = useRouter();
  const succeeded = view?.status === "SUCCEEDED";

  // RUNNING（后台生成中）期间每 4s 刷新一次，直至任务到达终态；离开卡片或终态后停止。
  useEffect(() => {
    if (view?.status !== "RUNNING") return;
    const timer = setInterval(() => router.refresh(), 4_000);
    return () => clearInterval(timer);
  }, [view?.status, router]);

  const invoke = (fn: () => Promise<{ ok?: boolean; error?: string }>) => async () => {
    const r = await fn();
    return { ok: !!r.ok, error: r.error };
  };

  return (
    <section
      aria-label="AI 运营建议"
      className="mb-6 rounded-none border border-brand-200 bg-surface p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-neutral-900">AI 运营建议</h2>
          <p className="mt-1 text-xs text-neutral-400">
            依据近 7 日访客浏览数据生成，供运营参考；AI 只出建议，不会自动改动内容。
          </p>
          {view && view.status === "SUCCEEDED" && (
            <p className="mt-1 text-xs text-neutral-400">
              数据窗口：{view.from ?? "—"} ～ {view.to ?? "—"} ·{" "}
              {new Date(view.createdAt).toLocaleString("zh-CN")} 生成
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {view && (
            <span className="border border-brand-200 px-2 py-0.5 text-xs text-neutral-500">
              {statusNote(view.status)}
            </span>
          )}
          <Button
            type="button"
            disabled={pending || view?.status === "RUNNING"}
            className={succeeded ? BTN_GHOST_SM : BTN_PRIMARY_SM}
            onClick={() =>
              run(
                invoke(
                  succeeded ? () => refreshSiteOverviewAction() : () => runSiteOverviewAction(),
                ),
              )
            }
          >
            {pending ? "处理中…" : succeeded ? "重新生成" : view ? "重试生成" : "生成 AI 运营建议"}
          </Button>
        </div>
      </div>

      {view?.status === "FAILED" && (
        <p className="mt-3 border-l-2 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-700">
          上次生成失败，可点击上方「重试生成」（已保留失败记录，不会重复调用）；若持续失败，请检查后台
          AI 配置或网络连通性。
        </p>
      )}

      {view?.parseFailed && (
        <p className="mt-3 border-l-2 border-amber-500 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          结果格式未能解析，点击「重新生成」获取新结果。
        </p>
      )}

      {succeeded && !view.parseFailed && (
        <div className="mt-4">
          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-neutral-800">
            {view.summary}
          </p>
          {view.insights.length > 0 && (
            <ul className="mt-4 space-y-3">
              {view.insights.map((item, i) => {
                const p = PRIORITY[item.priority] ?? PRIORITY.medium;
                return (
                  <li key={i} className="border border-neutral-100 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="border border-brand-200 bg-brand-50 px-2 py-0.5 text-xs text-brand-700">
                        {AREA_LABEL[item.area] ?? item.area}
                      </span>
                      <span className={`border px-2 py-0.5 text-xs ${p.chip}`}>{p.label}</span>
                    </div>
                    <p className="mt-2 text-sm font-medium text-neutral-900">{item.title}</p>
                    {item.evidence && (
                      <p className="mt-1 text-xs leading-5 text-neutral-500">
                        依据：{item.evidence}
                      </p>
                    )}
                    <p className="mt-1 text-sm leading-6 text-neutral-700">建议：{item.advice}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {!view && (
        <p className="mt-3 border border-dashed border-neutral-200 px-4 py-6 text-center text-xs text-neutral-400">
          尚未生成过 AI 运营建议。点击右上角按钮，AI 将基于近 7 日访客浏览数据给出内容方向、搜索、
          推广与体验等方面的专业建议。
        </p>
      )}
    </section>
  );
}
