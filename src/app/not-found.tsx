import Link from "next/link";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col items-center px-4 py-24 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-none border border-brand-300 bg-surface">
        <Compass size={28} className="text-brand-500" aria-hidden />
      </div>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight text-neutral-900">404 · 这里什么都没有</h1>
      <p className="mt-2 text-sm text-neutral-500">页面不存在、已下架，或链接输错了。</p>
      <div className="mt-6 flex items-center gap-3">
        <Link
          href="/"
          className="rounded-none border border-brand-600 bg-brand-500 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-brand-600"
        >
          回首页
        </Link>
        <Link
          href="/browse"
          className="rounded-none border border-brand-200 bg-surface px-4 py-1.5 text-sm text-neutral-700 transition hover:border-brand-500"
        >
          去逛逛
        </Link>
      </div>
    </div>
  );
}
