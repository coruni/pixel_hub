import { ScrollText } from "lucide-react";
import Markdown from "@/components/rte/Markdown";

// 内容页共用视图（社区规则/用户协议/隐私协议）：图标头 + Markdown 正文（全站 md-body 排版）。
export default function DocPageView({
  title,
  subtitle,
  markdown,
  updatedAt,
}: {
  title: string;
  subtitle: string;
  markdown: string;
  updatedAt: string | null;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-none border border-brand-300 bg-surface">
          <ScrollText size={20} className="text-brand-500" aria-hidden />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">{title}</h1>
          <p className="text-xs text-neutral-400">{subtitle}</p>
        </div>
      </div>

      <div className="md-body mt-8">
        <Markdown>{markdown}</Markdown>
      </div>

      {updatedAt && (
        <p className="mt-10 border-t border-brand-200 pt-6 text-xs text-neutral-400">
          最后更新：{updatedAt}
        </p>
      )}
    </div>
  );
}
