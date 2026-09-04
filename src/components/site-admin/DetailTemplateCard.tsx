"use client";

import type { ContentType } from "@/lib/display";
import { DETAIL_TEMPLATE_IDS, DETAIL_TEMPLATE_META, type DetailTemplateId, type Theme } from "@/lib/site-config";
import { setDetailTemplateAction } from "@/lib/actions/site";
import { INPUT, LABEL_STRONG } from "@/lib/ui/cls";
import type { RunFn } from "./shared";

/** 详情页模板：全局默认 + 三类内容覆盖，选择即保存 */
export default function DetailTemplateCard({ theme, run }: { theme: Theme; run: RunFn }) {
  const rows: { scope: "default" | "IMAGE" | "GAME" | "ARTICLE"; label: string }[] = [
    { scope: "default", label: "全局默认" },
    { scope: "IMAGE", label: "图片作品覆盖" },
    { scope: "GAME", label: "游戏覆盖" },
    { scope: "ARTICLE", label: "文章覆盖" },
  ];
  const val = (scope: string): DetailTemplateId | "" =>
    scope === "default"
      ? theme.detailTemplate.default
      : theme.detailTemplate.byType[scope as ContentType] ?? "";

  return (
    <section className="rounded-none border border-brand-200 bg-surface p-5">
      <h2 className="text-base font-semibold text-neutral-900">详情页模板</h2>
      <p className="mt-0.5 text-xs text-neutral-500">
        选择资源详情页的版式。单资源按「类型覆盖 &gt; 全局默认」生效；类型覆盖选「跟随全局」即清除，选择后立即保存。
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {rows.map((r) => {
          const v = val(r.scope);
          return (
            <label key={r.scope} className="block">
              <span className={LABEL_STRONG}>{r.label}</span>
              <select
                value={v}
                onChange={(e) => run(() => setDetailTemplateAction({ scope: r.scope, value: e.target.value as DetailTemplateId | "" }))}
                className={INPUT}
              >
                {r.scope !== "default" && (
                  <option value="">跟随全局默认</option>
                )}
                {DETAIL_TEMPLATE_IDS.map((id) => (
                  <option key={id} value={id}>
                    {DETAIL_TEMPLATE_META[id].label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-neutral-400">
                {DETAIL_TEMPLATE_META[v || theme.detailTemplate.default].desc}
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}
