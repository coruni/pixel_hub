"use client";

import { useEffect } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[page-error]", error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col items-center px-4 py-24 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-none border border-red-300 bg-surface">
        <TriangleAlert size={28} className="text-red-500" aria-hidden />
      </div>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight text-neutral-900">出了点问题</h1>
      <p className="mt-2 text-sm text-neutral-500">
        页面渲染出错，请重试；若持续出现请联系管理员。
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
  );
}
