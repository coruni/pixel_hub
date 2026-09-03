import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { auth } from "@/lib/auth";
import { getCollectionDetail } from "@/lib/queries";
import { formatCount } from "@/lib/format";
import MasonryGrid from "@/components/resource/MasonryGrid";

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const col = await getCollectionDetail(id);
  if (!col || !col.isPublic) return { title: "收藏夹不存在", robots: { index: false } };
  return {
    title: `${col.name} · ${col.owner.name ?? col.owner.username} 的收藏夹`,
    description: col.description ?? undefined,
  };
}

export default async function CollectionPage({ params }: PageProps) {
  const { id } = await params;
  const session = await auth();
  const meId = typeof session?.user?.id === "string" && session.user.id ? session.user.id : undefined;

  const col = await getCollectionDetail(id, meId);
  if (!col) notFound();

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      {/* 头部 */}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">{col.name}</h1>
        {!col.isPublic && (
          <span className="inline-flex items-center gap-1 rounded-none border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-600">
            <Lock size={11} aria-hidden />
            仅自己可见
          </span>
        )}
        <span className="text-sm text-neutral-500">
          <a href={`/u/${col.owner.username}`} className="hover:text-neutral-900">
            {col.owner.name ?? col.owner.username}
          </a>
          {" "}收藏的 {formatCount(col.items.length)} 个内容
        </span>
      </div>
      {col.description && <p className="mt-2 text-sm text-neutral-500">{col.description}</p>}

      {/* 内容流 */}
      {col.items.length > 0 ? (
        <MasonryGrid className="mt-6" items={col.items} />
      ) : (
        <div className="mt-4 grid place-items-center rounded-none border-2 border-dashed border-brand-300 py-16 text-sm text-neutral-400">
          收藏夹还是空的
        </div>
      )}
    </div>
  );
}
