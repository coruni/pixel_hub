import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { CalendarDays, Eye, MessageSquare, ThumbsUp } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import {
  getFeed,
  getProfile,
  getCollections,
  toFeedCard,
  type FeedCard,
  type CollectionRow,
} from "@/lib/queries";
import { isOnline } from "@/lib/online";
import {
  createCollectionAction,
  renameCollectionAction,
  deleteCollectionAction,
} from "@/lib/actions/social";
import { formatCount } from "@/lib/format";
import { publicUrl } from "@/lib/storage/url";
import ResourceGrid from "@/components/resource/ResourceGrid";
import Avatar from "@/components/ui/Avatar";
import { FollowButton } from "@/components/social/interactions";
import { Button } from "@/components/ui/Button";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  // 与 page 同参（含 viewerId）：cache() 同请求去重
  const session = await auth();
  const meId =
    typeof session?.user?.id === "string" && session.user.id ? session.user.id : undefined;
  const p = await getProfile(username, meId);
  return { title: p ? `${p.name ?? p.username} · 个人主页` : "用户不存在" };
}

const roleBadge: Record<string, { label: string; cls: string }> = {
  ADMIN: { label: "管理员", cls: "border-red-200 bg-red-50 text-red-600" },
  MODERATOR: { label: "版主", cls: "border-amber-200 bg-amber-50 text-amber-600" },
};

type TabKey = "works" | "favorites" | "followers" | "following";
type PrivacyKey = "showFavorites" | "showFollowers" | "showFollowing";

// privacy = 该 tab 对应的用户隐私开关；无 privacy 的 tab 恒可见
const TABS: { key: TabKey; label: string; privacy?: PrivacyKey }[] = [
  { key: "works", label: "作品" },
  { key: "favorites", label: "收藏", privacy: "showFavorites" },
  { key: "followers", label: "关注者", privacy: "showFollowers" },
  { key: "following", label: "关注中", privacy: "showFollowing" },
];

const userSelect = {
  id: true,
  username: true,
  name: true,
  bio: true,
  avatarKey: true,
  lastSeenAt: true,
} as const;

type UserRowArgs = {
  u: {
    id: string;
    username: string;
    name: string | null;
    bio: string | null;
    avatarKey: string | null;
    lastSeenAt: Date | null;
  };
  following: boolean;
  meId: string | undefined;
};

function UserRow({ u, following, meId }: UserRowArgs) {
  return (
    <li className="flex items-center gap-3 rounded-none p-2 transition hover:bg-brand-50">
      <Link href={`/u/${u.username}`} className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar
          name={u.name}
          username={u.username}
          avatarKey={u.avatarKey}
          size="md"
          online={isOnline(u.lastSeenAt)}
        />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-neutral-800">
            {u.name ?? u.username}
          </span>
          <span className="block truncate text-xs text-neutral-400">
            {u.bio || `@${u.username}`}
          </span>
        </span>
      </Link>
      {meId && meId !== u.id && <FollowButton targetUserId={u.id} initialFollowing={following} />}
    </li>
  );
}

export default async function UserPage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ tab?: string; page?: string; col?: string }>;
}) {
  const { username } = await params;
  const { tab: tabRaw, page: pageRaw, col: colRaw } = await searchParams;
  const session = await auth();
  const me = session?.user;
  const meId = typeof me?.id === "string" && me.id ? me.id : undefined;

  const profile = await getProfile(username, meId);
  if (!profile) notFound();

  // tab 可见性：本人始终可见；其余访客按对方的隐私开关（收藏默认仅本人，粉丝/关注默认公开）
  const tabVisible = (t: (typeof TABS)[number]) =>
    !t.privacy || profile.isViewer || profile[t.privacy];
  // 非法/被隐私挡掉的 tab 回落到作品
  const tab: TabKey = (TABS.find((t) => t.key === tabRaw && tabVisible(t)) ?? TABS[0]).key;
  const page = Math.max(1, Number(pageRaw) || 1);

  // D9：作者页统计对齐游客可见范围（NSFW 不计入）；登录访客全站口径
  const pubWhere = {
    authorId: profile.id,
    status: "PUBLISHED" as const,
    ...(meId ? {} : { nsfw: false }),
  };
  const [pubCount, agg, commentCount] = await Promise.all([
    prisma.resource.count({ where: pubWhere }),
    prisma.resource.aggregate({
      where: pubWhere,
      _sum: { viewCount: true, downloadCount: true, likeCount: true },
    }),
    prisma.comment.count({ where: { authorId: profile.id, status: "PUBLIC" } }),
  ]);

  const joined = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(
    profile.createdAt,
  );

  // ---- 各 tab 数据（统一每页 24 条，多取 1 条判断 hasMore） ----
  const PAGE_SIZE = 24;
  let works: FeedCard[] = [];
  let followRows: UserRowArgs["u"][] = [];
  let viewerFollows = new Set<string>();
  let hasMore = false;
  let collections: CollectionRow[] = [];
  // 当前选中的夹子："none"=未分组 / 具体夹子 id / 空串=全部
  let colFilter = "";

  if (tab === "works") {
    const feed = await getFeed({ authorUsername: username, page, pageSize: PAGE_SIZE });
    works = feed.items;
    hasMore = feed.hasMore;
  } else if (tab === "favorites") {
    collections = await getCollections(profile.id);
    if (colRaw && (colRaw === "none" || collections.some((c) => c.id === colRaw)))
      colFilter = colRaw;
    const favWhere: { userId: string; collectionId?: string | null } = { userId: profile.id };
    if (colFilter === "none") favWhere.collectionId = null;
    else if (colFilter) favWhere.collectionId = colFilter;
    // 按收藏时间倒序取 id，再借 getFeed 精取（顺序自行重排）
    const favs = await prisma.favorite.findMany({
      where: favWhere,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE + 1,
      select: { resourceId: true },
    });
    hasMore = favs.length > PAGE_SIZE;
    const ids = favs.slice(0, PAGE_SIZE).map((f) => f.resourceId);
    if (ids.length > 0) {
      const { items } = await getFeed({ ids, page: 1, pageSize: PAGE_SIZE });
      const byId = new Map(items.map((it) => [it.id, toFeedCard(it)]));
      works = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
    }
  } else {
    const rows =
      tab === "followers"
        ? await prisma.follow.findMany({
            where: { followingId: profile.id },
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * PAGE_SIZE,
            take: PAGE_SIZE + 1,
            select: { follower: { select: userSelect } },
          })
        : await prisma.follow.findMany({
            where: { followerId: profile.id },
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * PAGE_SIZE,
            take: PAGE_SIZE + 1,
            select: { following: { select: userSelect } },
          });
    hasMore = rows.length > PAGE_SIZE;
    followRows = rows.slice(0, PAGE_SIZE).map((r) => ("follower" in r ? r.follower : r.following));
    if (meId && followRows.length > 0) {
      const mine = await prisma.follow.findMany({
        where: { followerId: meId, followingId: { in: followRows.map((u) => u.id) } },
        select: { followingId: true },
      });
      viewerFollows = new Set(mine.map((m) => m.followingId));
    }
  }

  const tabHref = (key: string) =>
    key === "works" ? `/u/${profile.username}` : `/u/${profile.username}?tab=${key}`;
  const pageHref = (n: number) => {
    const params = new URLSearchParams();
    if (tab !== "works") params.set("tab", tab);
    if (colFilter) params.set("col", colFilter);
    if (n > 1) params.set("page", String(n));
    const qs = params.toString();
    return `/u/${profile.username}${qs ? `?${qs}` : ""}`;
  };
  const colHref = (col: string) =>
    `/u/${profile.username}?tab=favorites${col ? `&col=${col}` : ""}`;
  const pageBtn =
    "rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-sm text-neutral-700 hover:border-brand-500";
  const chip = (active: boolean) =>
    `whitespace-nowrap rounded-none border px-3 py-1 text-xs transition ${
      active
        ? "border-brand-600 bg-brand-500 text-white"
        : "border-brand-200 bg-surface text-neutral-600 hover:border-brand-500"
    }`;

  const emptyBox = (text: string) => (
    <div className="mt-4 grid place-items-center rounded-none border-2 border-dashed border-brand-300 py-16 text-sm text-neutral-400">
      {text}
    </div>
  );

  // 统计行：三格主数据（窄屏三等分占满一行，宽屏固定宽度左排）+ 侧挂累计数据。
  // 有 hero 时随头部一起被背景覆盖（移动端背景向下延伸至本行底部）。
  const statsRow = (
    <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center">
      <div className="flex w-full gap-3 lg:w-auto">
        {[
          { n: formatCount(pubCount), k: "发布" },
          { n: formatCount(profile.followerCount), k: "粉丝" },
          { n: formatCount(profile.followingCount), k: "关注" },
        ].map((s) => (
          <div
            key={s.k}
            className="min-w-0 flex-1 rounded-none border border-brand-200 bg-brand-50/40 py-3 text-center lg:w-28 lg:flex-none"
          >
            <div className="text-lg font-semibold tabular-nums text-brand-700">{s.n}</div>
            <div className="mt-0.5 text-[11px] text-neutral-400">{s.k}</div>
          </div>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-start gap-x-5 gap-y-1 text-xs text-neutral-400 lg:justify-end">
        <span className="inline-flex items-center gap-1">
          <Eye size={12} aria-hidden /> 累计浏览 {formatCount(agg._sum.viewCount ?? 0)}
        </span>
        <span className="inline-flex items-center gap-1">
          <MessageSquare size={12} aria-hidden /> {formatCount(commentCount)} 条评论
        </span>
        <span className="inline-flex items-center gap-1">
          <ThumbsUp size={12} aria-hidden /> {formatCount(agg._sum.likeCount ?? 0)} 次点赞
        </span>
      </div>
    </div>
  );

  return (
    <div className={`mx-auto max-w-7xl px-4 py-10 sm:px-6 ${profile.heroImageKey ? "sm:pt-0" : ""}`}>
      {/* 头部：可选 hero 横幅图。移动端背景向下延伸覆盖到统计行底部，整张图用 mask 渐变：
          内容区域压暗保证文字可读、无字间隙露出图像、最底部融出到 body，无硬切分割线 */}
      {profile.heroImageKey ? (
        <section className="relative isolate -mx-4 px-4 sm:-mx-6 sm:px-6">
          <div
            aria-hidden
            className="hero-bg-mask pointer-events-none absolute inset-x-0 top-0 bottom-0 -z-10 bg-cover bg-center sm:bottom-auto sm:h-64"
            style={{ backgroundImage: `url(${publicUrl(profile.heroImageKey)})` }}
          />
          <div className="flex flex-wrap items-center gap-5 pb-6 pt-2 sm:pb-8 sm:pt-3">
            <Avatar
              name={profile.name}
              username={profile.username}
              avatarKey={profile.avatarKey}
              size="lg"
              online={profile.online}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-semibold tracking-tight text-neutral-900">
                  {profile.name ?? profile.username}
                </h1>
                <span className="text-sm text-neutral-400">@{profile.username}</span>
                {roleBadge[profile.role] && (
                  <span
                    className={`rounded-none border px-1.5 py-0.5 text-[10px] font-medium ${roleBadge[profile.role].cls}`}
                  >
                    {roleBadge[profile.role].label}
                  </span>
                )}
                {profile.trusted && (
                  <span className="rounded-none border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
                    免审发布
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-sm leading-6 text-neutral-600">
                {profile.bio || "这个人很懒，还没写简介。"}
              </p>
              <p className="mt-1 flex items-center gap-1 text-xs text-neutral-400">
                <CalendarDays size={12} aria-hidden /> {joined} 加入
              </p>
            </div>
            <div className="flex gap-3">
              {profile.isViewer ? (
                <Link
                  href="/settings"
                  className="rounded-none border border-brand-200 bg-surface px-4 py-2 text-sm text-neutral-700 hover:border-brand-500 hover:text-neutral-900"
                >
                  编辑资料
                </Link>
              ) : me ? (
                <FollowButton targetUserId={profile.id} initialFollowing={profile.following} />
              ) : (
                <Link
                  href={`/login?callbackUrl=${encodeURIComponent(`/u/${profile.username}`)}`}
                  className="rounded-none border border-brand-600 bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
                >
                  ＋ 关注
                </Link>
              )}
            </div>
          </div>
          {statsRow}
        </section>
      ) : (
        <div className="flex flex-wrap items-center gap-5">
          <Avatar
            name={profile.name}
            username={profile.username}
            avatarKey={profile.avatarKey}
            size="lg"
            online={profile.online}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-neutral-900">
                {profile.name ?? profile.username}
              </h1>
              <span className="text-sm text-neutral-400">@{profile.username}</span>
              {roleBadge[profile.role] && (
                <span
                  className={`rounded-none border px-1.5 py-0.5 text-[10px] font-medium ${roleBadge[profile.role].cls}`}
                >
                  {roleBadge[profile.role].label}
                </span>
              )}
              {profile.trusted && (
                <span className="rounded-none border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
                  免审发布
                </span>
              )}
            </div>
            <p className="mt-1.5 text-sm leading-6 text-neutral-600">
              {profile.bio || "这个人很懒，还没写简介。"}
            </p>
            <p className="mt-1 flex items-center gap-1 text-xs text-neutral-400">
              <CalendarDays size={12} aria-hidden /> {joined} 加入
            </p>
          </div>
          <div className="flex gap-3">
            {profile.isViewer ? (
              <Link
                href="/settings"
                className="rounded-none border border-brand-200 bg-surface px-4 py-2 text-sm text-neutral-700 hover:border-brand-500 hover:text-neutral-900"
              >
                编辑资料
              </Link>
            ) : me ? (
              <FollowButton targetUserId={profile.id} initialFollowing={profile.following} />
            ) : (
              <Link
                href={`/login?callbackUrl=${encodeURIComponent(`/u/${profile.username}`)}`}
                className="rounded-none border border-brand-600 bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
              >
                ＋ 关注
              </Link>
            )}
          </div>
        </div>
      )}
      {!profile.heroImageKey && statsRow}

      <div className="mt-8 flex flex-wrap items-center gap-2">
        {TABS.filter(tabVisible).map((t) => (
          <Link key={t.key} href={tabHref(t.key)} className={chip(tab === t.key)}>
            {t.label}
            {t.key === "works" && <span className="ml-1 tabular-nums opacity-70">{pubCount}</span>}
            {t.key === "followers" && (
              <span className="ml-1 tabular-nums opacity-70">{profile.followerCount}</span>
            )}
            {t.key === "following" && (
              <span className="ml-1 tabular-nums opacity-70">{profile.followingCount}</span>
            )}
          </Link>
        ))}
      </div>

      {/* 内容 */}
      {tab === "works" &&
        (works.length > 0 ? (
          <ResourceGrid className="mt-4 lg:grid-cols-5" items={works} display="card" ratio="3:4" />
        ) : (
          emptyBox("还没有发布内容")
        ))}
      {tab === "favorites" && (
        <>
          {/* 夹子过滤 + 管理（仅本人） */}
          {profile.isViewer && collections.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Link href={colHref("")} className={chip(!colFilter)}>
                全部
              </Link>
              {collections.map((c) => (
                <Link key={c.id} href={colHref(c.id)} className={chip(colFilter === c.id)}>
                  {c.name}
                  <span className="ml-1 tabular-nums opacity-70">{c.count}</span>
                </Link>
              ))}
              <Link href={colHref("none")} className={chip(colFilter === "none")}>
                未分组
              </Link>
              <form action={createCollectionAction} className="ml-1 flex items-center gap-1">
                <input
                  name="name"
                  required
                  maxLength={30}
                  placeholder="新夹子名称"
                  className="w-28 rounded-none border border-brand-200 bg-surface px-2 py-1 text-xs text-neutral-800 placeholder:text-neutral-400 focus:border-brand-500 focus:outline-none"
                />
                <Button
                  type="submit"
                  className="rounded-none border border-brand-200 bg-surface px-2 py-1 text-xs text-neutral-600 hover:border-brand-500 hover:text-neutral-900"
                >
                  ＋ 新建夹子
                </Button>
              </form>
            </div>
          )}

          {/* 选中具体夹子时的管理行：改名 / 删除（删夹子不删收藏，条目归入未分组） */}
          {profile.isViewer && colFilter && colFilter !== "none" && (
            <div className="mt-2 flex items-center gap-2">
              <form action={renameCollectionAction} className="flex items-center gap-1">
                <input type="hidden" name="id" value={colFilter} />
                <input
                  name="name"
                  required
                  maxLength={30}
                  defaultValue={collections.find((c) => c.id === colFilter)?.name}
                  className="w-36 rounded-none border border-brand-200 bg-surface px-2 py-1 text-xs text-neutral-800 focus:border-brand-500 focus:outline-none"
                />
                <Button
                  type="submit"
                  className="rounded-none border border-brand-200 bg-surface px-2 py-1 text-xs text-neutral-600 hover:border-brand-500 hover:text-neutral-900"
                >
                  重命名
                </Button>
              </form>
              <form action={deleteCollectionAction}>
                <input type="hidden" name="id" value={colFilter} />
                <Button
                  type="submit"
                  className="rounded-none border border-red-200 bg-surface px-2 py-1 text-xs text-red-500 hover:border-red-400 hover:text-red-600"
                >
                  删除夹子
                </Button>
              </form>
              {/* 该夹子的独立页（可分享；夹子本身可设为私密） */}
              <Link
                href={`/collections/${colFilter}`}
                className="text-xs text-neutral-400 hover:text-neutral-900"
              >
                查看独立页 →
              </Link>
            </div>
          )}
        </>
      )}
      {tab === "favorites" &&
        (works.length > 0 ? (
          <ResourceGrid className="mt-4" items={works} display="card" ratio="3:4" />
        ) : (
          emptyBox("还没有收藏内容")
        ))}
      {(tab === "followers" || tab === "following") &&
        (followRows.length > 0 ? (
          <ul className="mt-4 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {followRows.map((u) => (
              <UserRow key={u.id} u={u} following={viewerFollows.has(u.id)} meId={meId} />
            ))}
          </ul>
        ) : (
          emptyBox(tab === "followers" ? "还没有粉丝" : "还没有关注任何人")
        ))}

      {/* 分页 */}
      {(page > 1 || hasMore) && (
        <div className="mt-6 flex items-center justify-center gap-3 text-sm">
          {page > 1 && (
            <Link href={pageHref(page - 1)} className={pageBtn}>
              上一页
            </Link>
          )}
          <span className="text-xs text-neutral-400">第 {page} 页</span>
          {hasMore && (
            <Link href={pageHref(page + 1)} className={pageBtn}>
              下一页
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
