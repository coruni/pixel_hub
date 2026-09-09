"use client";

// 后台段错误边界：不覆盖 root layout 的导航，仅替换管理区内容
import { useEffect } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[admin-error]", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center rounded-none border border-red-200 bg-surface px-4 py-16 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-none border border-red-300 bg-surface">
        <TriangleAlert size={24} className="text-red-500" aria-hidden />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-neutral-900">后台页面出错</h2>
      <p className="mt-2 text-sm text-neutral-500">
        数据加载或渲染失败，请重试。
        {error.digest && <span className="ml-1 text-neutral-400">（{error.digest}）</span>}
      </p>
      <Button
        type="button"
        onClick={reset}
        className="mt-5 inline-flex items-center gap-2 rounded-none border border-brand-600 bg-brand-500 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-brand-600"
      >
        <RotateCcw size={14} aria-hidden />
        重试
      </Button>
    </div>
  );
}
