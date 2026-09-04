"use client";

// 根级错误边界：root layout 自身渲染崩溃时兜底（此时没有导航栏/页脚，须自带 html/body）
import { useEffect } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body className="flex min-h-screen items-center justify-center bg-background px-4 text-neutral-900">
        <div className="flex max-w-md flex-col items-center py-24 text-center">
          <div className="grid h-16 w-16 place-items-center rounded-none border border-red-300 bg-surface">
            <TriangleAlert size={28} className="text-red-500" aria-hidden />
          </div>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight">站点出错了</h1>
          <p className="mt-2 text-sm text-neutral-500">
            页面框架渲染出错，请重试；若持续出现请联系管理员。
            {error.digest && <span className="ml-1 text-neutral-400">（{error.digest}）</span>}
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-6 inline-flex items-center gap-2 rounded-none border border-brand-600 bg-brand-500 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-brand-600"
          >
            <RotateCcw size={14} aria-hidden />
            重试
          </button>
        </div>
      </body>
    </html>
  );
}
