import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { DOC_KEYS, DOC_PAGES, getDocWithMeta, type DocKey } from "@/lib/doc-config";
import DocsEditor from "@/components/admin/DocsEditor";

export const metadata: Metadata = { title: "内容页面" };

export default async function AdminDocsPage({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string }>;
}) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/admin");

  const sp = await searchParams;
  const page: DocKey = DOC_KEYS.includes(sp.doc as DocKey) ? (sp.doc as DocKey) : "rules";
  const meta = DOC_PAGES[page];
  const { initial, isCustom, updatedAt } = await getDocWithMeta(page);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium text-neutral-900">内容页面</h2>
        <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900 hover:underline">
          查看前台 →
        </Link>
      </div>
      <p className="mb-4 rounded-none border border-brand-200 bg-surface px-4 py-3 text-xs leading-5 text-neutral-500">
        社区规则、用户协议与隐私协议在此以 Markdown 编写，保存后前台立即生效；未自定义的页面展示内置默认内容。
      </p>

      {/* 文档切换 */}
      <div className="mb-5 flex flex-wrap gap-2">
        {DOC_KEYS.map((k) => (
          <Link
            key={k}
            href={`/admin/docs?doc=${k}`}
            aria-current={k === page ? "page" : undefined}
            className={
              k === page
                ? "rounded-none border border-brand-600 bg-brand-500 px-3 py-1.5 text-sm font-medium text-white"
                : "rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-sm text-neutral-600 transition hover:border-brand-500 hover:text-neutral-900"
            }
          >
            {DOC_PAGES[k].label}
          </Link>
        ))}
      </div>

      <DocsEditor
        key={page}
        docKey={page}
        label={meta.label}
        initial={initial}
        isCustom={isCustom}
        updatedAt={updatedAt ? updatedAt.toISOString().slice(0, 16).replace("T", " ") : null}
      />
    </div>
  );
}
