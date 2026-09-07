import Link from "next/link";
import MiniBadge from "@/components/ui/MiniBadge";
import { Download, Heart, MessageSquare, Pencil } from "lucide-react";
import type { Metadata } from "next";
import { prisma } from "@/lib/db/prisma";
import { publicUrl } from "@/lib/storage";
import { formatCount, timeAgo } from "@/lib/format";
import { TYPE_LABEL } from "@/lib/display";
import { enumParam, intParam, str, type SP } from "@/lib/search-params";
import { ADMIN_PAGE_SIZE, STABLE_NEWEST, adminQuery } from "@/lib/admin/paging";
import { TableFooter } from "@/components/admin/DataTable";
import { ContentActions } from "@/components/admin/buttons";
import type { Prisma, ResourceType } from "@prisma/client";
import { BTN_FILTER, INPUT_FILTER } from "@/lib/ui/cls";

export const metadata: Metadata = { title: "内容库" };

const statusLabel: Record<string, { text: string; cls: string }> = {
  PUBLISHED: { text: "已上架", cls: "bg-emerald-50 text-emerald-600" },
  PENDING: { text: "待审核", cls: "bg-amber-50 text-amber-600" },
  REJECTED: { text: "已打回", cls: "bg-neutral-100 text-neutral-500" },
  REMOVED: { text: "已下架", cls: "bg-red-50 text-red-600" },
  DRAFT: { text: "草稿", cls: "bg-neutral-100 text-neutral-500" },
};

const STATUSES = ["PUBLISHED", "PENDING", "REJECTED", "REMOVED", "DRAFT"] as const;
const TYPES = ["GAME", "IMAGE", "ARTICLE"] as const;

export default async function ContentPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q = (str(sp, "q") ?? "").trim().slice(0, 80);
  const type = str(sp, "type") ?? "";
  const author = (str(sp, "author") ?? "").trim().slice(0, 60);
  const cat = str(sp, "cat") ?? "";
  const status = enumParam(sp, "status", STATUSES, "PUBLISHED");
  const page = intParam(sp, "page", 1);
  const pageSize = Math.min(100, intParam(sp, "size", ADMIN_PAGE_SIZE));

  // 关键词命中标题/简介/正文；作者命中用户名或昵称
  const where: Prisma.ResourceWhereInput = {
    status,
    ...((TYPES as readonly string[]).includes(type) ? { type: type as ResourceType } : {}),
    ...(cat ? { categoryId: cat } : {}),
    ...(author
      ? {
          author: {
            OR: [
              { username: { contains: author, mode: "insensitive" as const } },
              { name: { contains: author, mode: "insensitive" as const } },
            ],
          },
        }
      : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" as const } },
            { summary: { contains: q, mode: "insensitive" as const } },
            { description: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [rows, total, categories] = await Promise.all([
    prisma.resource.findMany({
      where,
      orderBy: [...STABLE_NEWEST],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        author: { select: { username: true, name: true } },
        category: { select: { name: true } },
        coverMedia: { select: { storageKey: true, bigKey: true, thumbKey: true } },
        media: {
          where: { resourceId: { not: null } },
          orderBy: { sort: "asc" },
          take: 1,
          select: { storageKey: true, bigKey: true, thumbKey: true },
        },
      },
    }),
    prisma.resource.count({ where }),
    prisma.category.findMany({ orderBy: [{ sort: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
  ]);

  const base = {
    q: q || undefined,
    type: type || undefined,
    author: author || undefined,
    cat: cat || undefined,
    ...(pageSize !== ADMIN_PAGE_SIZE ? { size: String(pageSize) } : {}),
  };
  const href = (p: number) => `/admin/content${adminQuery(base, { status, page: String(p) })}`;
  const chip = (s: string) =>
    `rounded-none px-3 py-1 text-xs transition ${
      status === s
        ? "bg-brand-500 text-white"
        : "border border-brand-200 bg-surface text-neutral-500 hover:border-brand-500"
    }`;

  return (
    <div>
      {/* 状态 chips：切状态保留其余筛选，回到第 1 页 */}
      <div className="mb-3 flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Link key={s} href={`/admin/content${adminQuery(base, { status: s })}`} className={chip(s)}>
            {statusLabel[s]?.text ?? s}
          </Link>
        ))}
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <input type="hidden" name="status" value={status} />
        <label className="sr-only" htmlFor="content-q">
          关键词
        </label>
        <input
          id="content-q"
          name="q"
          defaultValue={q}
          placeholder="标题 / 简介 / 正文"
          className={`${INPUT_FILTER} w-44`}
        />
        <label className="sr-only" htmlFor="content-author">
          作者
        </label>
        <input
          id="content-author"
          name="author"
          defaultValue={author}
          placeholder="作者用户名 / 昵称"
          className={`${INPUT_FILTER} w-40`}
        />
        <label className="sr-only" htmlFor="content-type">
          类型
        </label>
        <select id="content-type" name="type" defaultValue={type} className={INPUT_FILTER}>
          <option value="">全部类型</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="content-cat">
          分类
        </label>
        <select id="content-cat" name="cat" defaultValue={cat} className={INPUT_FILTER}>
          <option value="">全部分类</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className={BTN_FILTER}
        >
          筛选
        </button>
        {(q || author || type || cat) && (
          <Link
            href={`/admin/content?status=${status}`}
            className="text-xs text-neutral-400 underline-offset-2 hover:text-brand-700 hover:underline"
          >
            清空筛选
          </Link>
        )}
      </form>

      {rows.length === 0 ? (
        <p className="rounded-none border border-brand-200 bg-surface px-5 py-10 text-center text-sm text-neutral-400">
          暂无内容
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100 rounded-none border border-brand-200 bg-surface">
          {rows.map((r) => {
            const thumb = r.coverMedia ?? r.media[0];
            const st = statusLabel[r.status];
            return (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                <a
                  href={thumb ? publicUrl(thumb.bigKey ?? thumb.storageKey) : undefined}
                  target="_blank"
                  rel="noreferrer"
                >
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={publicUrl(thumb.thumbKey ?? thumb.bigKey ?? thumb.storageKey)}
                      alt=""
                      className="h-12 w-16 rounded-none border border-brand-200 object-cover"
                    />
                  ) : (
                    <span className="grid h-12 w-16 place-items-center rounded-none bg-neutral-100 text-xs text-neutral-400">
                      无图
                    </span>
                  )}
                </a>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/resources/${r.slug}`}
                      className="truncate text-sm font-medium text-neutral-900 hover:underline"
                    >
                      {r.title}
                    </Link>
                    <MiniBadge>{TYPE_LABEL[r.type]}</MiniBadge>
                    {st && (
                      <span
                        className={`rounded-none px-1.5 py-0.5 text-[10px] font-medium ${st.cls}`}
                      >
                        {st.text}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-neutral-400">
                    {r.category?.name ? `${r.category.name} · ` : ""}
                    {r.author.name ?? r.author.username} · {timeAgo(r.createdAt)} ·{" "}
                    <Heart size={11} className="mb-0.5 inline" /> {formatCount(r.likeCount)} ·{" "}
                    <MessageSquare size={11} className="mb-0.5 inline" />{" "}
                    {formatCount(r.commentCount)} · <Download size={11} className="mb-0.5 inline" />{" "}
                    {formatCount(r.downloadCount)}
                    {r.rejectReason && (
                      <span className="text-amber-600"> · 打回：{r.rejectReason}</span>
                    )}
                  </p>
                </div>
                <Link
                  href={`/admin/content/${r.id}/edit`}
                  className="inline-flex items-center gap-1 rounded-none border border-brand-200 bg-surface px-2.5 py-1.5 text-xs text-neutral-600 transition hover:border-brand-500 hover:text-brand-700"
                >
                  <Pencil size={12} aria-hidden />
                  编辑
                </Link>
                <ContentActions resourceId={r.id} status={r.status} />
              </li>
            );
          })}
        </ul>
      )}

      <TableFooter
        page={page}
        hasMore={(page - 1) * pageSize + rows.length < total}
        total={total}
        pageSize={pageSize}
        href={href}
      />
    </div>
  );
}
