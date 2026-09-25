import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { CalendarDays, Eye, MessageSquare, Pencil, Sparkles, ThumbsUp } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { getIncentive } from "@/lib/incentive";
import { getPointBalance } from "@/lib/points";
import { levelNameOf, levelOf, tipFormOf } from "@/lib/points-config";
import LevelBadge from "@/components/ui/LevelBadge";
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
import { profileBgUnlocked } from "@/lib/upload-config";
import ResourceGrid from "@/components/resource/ResourceGrid";
import PresenceAvatar from "@/components/ui/PresenceAvatar";
import { FollowButton } from "@/components/social/interactions";
import TipUserButton from "@/components/social/TipUserButton";
import { Button } from "@/components/ui/Button";

/** 昵称行图标按钮：方形图标位（h-9，与顶部导航的 NAV_ICON_BTN 同口径），
 *  编辑 / 打赏共用；无障碍名称由调用方的 title + aria-label 承担 */
const iconBtn =
  "grid h-9 w-9 shrink-0 place-items-center rounded-none border border-brand-200 bg-surface text-neutral-700 transition hover:border-brand-500 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-brand-400";

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
        <PresenceAvatar
          userId={u.id}
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

  // 贡献分等级：等级名一律现算（`UserPoint.level` 冗余列会因后台改档位而过期，只用于排序）。
  // 激励总开关关掉时整块不显示，避免留下一个永远停在「新人」的空徽章。
  const [pointBalance, incentive] = await Promise.all([
    getPointBalance(profile.id),
    getIncentive(),
  ]);
  const levelName = incentive.enabled ? levelNameOf(pointBalance, incentive.levels) : null;
  const levelIndex = levelOf(pointBalance, incentive.levels);

  // 主页背景：**最底层底图**（铺满视口、不覆盖 hero），达等级且有图才渲染。
  // 门槛判定与设置页表单共用 profileBgUnlocked()；等级掉下来或管理员抬高门槛后，旧图会立即不再渲染
  // ——「达到等级才开放」是一致口径，不做「传过就永久保留」的特例。
  const bgUnlocked = profileBgUnlocked(levelIndex, incentive.profile.bgMinLevel, incentive.enabled);
  const bgPcKey = bgUnlocked ? profile.profileBgPcKey : null;

  // 头部操作区。**hero / 无 hero 两套头部共用这一个节点** —— 操作项只补在其中一套里，
  // 另一套就会莫名缺按钮（两套头部的结构是一样的，别各写一遍）。
  //
  // 位置：贴在同一行昵称之后、用 `ml-auto` 推到行尾 —— 单独占一列会把头部拉成「头像 / 资料 / 按钮」
  // 三段，昵称行右侧反而空出一大截。因此头部只留 头像 + 资料 两列。
  // 编辑 / 打赏统一收敛成图标按钮（外观见 `iconBtn`），文案改由 title + aria-label 承担。
  const tipForm = tipFormOf(incentive);
  const nameActions = (
    <div className="ml-auto flex shrink-0 items-center gap-2">
      {profile.isViewer ? (
        <Link href="/settings" className={iconBtn} title="编辑资料" aria-label="编辑资料">
          <Pencil size={15} aria-hidden />
        </Link>
      ) : me ? (
        <>
          <FollowButton targetUserId={profile.id} initialFollowing={profile.following} />
          {/* 直接打赏作者（不挂作品）：本人看不到（不能给自己打赏），
              激励体系或打赏关闭时 tipForm 为 undefined，按钮整体不渲染 */}
          {tipForm && (
            <TipUserButton
              userId={profile.id}
              username={profile.username}
              iconOnly
              className={iconBtn}
              {...tipForm}
            />
          )}
        </>
      ) : (
        <Link
          href={`/login?callbackUrl=${encodeURIComponent(`/u/${profile.username}`)}`}
          className="rounded-none border border-brand-600 bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
        >
          ＋ 关注
        </Link>
      )}
    </div>
  );

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
        {/* 贡献分追加在这条右侧累计行，而不是给上面三格统计加第四格 —— 窄屏四格会挤破 */}
        {incentive.enabled && (
          <Link
            href={profile.isViewer ? "/creators/me" : "/creators"}
            className="inline-flex items-center gap-1 transition hover:text-brand-700"
          >
            <Sparkles size={12} aria-hidden /> 贡献分 {formatCount(pointBalance)}
          </Link>
        )}
      </div>
    </div>
  );

  return (
    <div className={`mx-auto max-w-7xl px-4 py-10 sm:px-6 ${profile.heroImageKey ? "pt-0" : "pt-10"}`}>
      {/* 主页背景：铺满视口的最底层。用 fixed 而不是插在文档流里 —— 它必须是**全屏**的，
          而这一层的外层是 max-w-7xl 容器，只有 fixed 能脱离它的宽度约束铺到屏幕两端。
          只在 sm 及以上渲染：窄屏没有侧边留白，遮罩带会直接压到卡片下面。
          -z-10 让它落在所有内容（含 hero）之下，且仍在 body 底色之上。 */}
      {bgPcKey && (
        <div
          aria-hidden
          className="profile-bg-pc pointer-events-none fixed inset-0 -z-10 hidden bg-cover bg-center bg-no-repeat sm:block"
          style={{ backgroundImage: `url(${publicUrl(bgPcKey)})` }}
        />
      )}
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
            <PresenceAvatar
              userId={profile.id}
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
                {levelName && <LevelBadge level={levelIndex} name={levelName} />}
                {nameActions}
              </div>
              <p className="mt-1.5 text-sm leading-6 text-neutral-600">
                {profile.bio || "这个人很懒，还没写简介。"}
              </p>
              <p className="mt-1 flex items-center gap-1 text-xs text-neutral-400">
                <CalendarDays size={12} aria-hidden /> {joined} 加入
              </p>
            </div>
          </div>
          {statsRow}
        </section>
      ) : (
        <div className="flex flex-wrap items-center gap-5">
          <PresenceAvatar
            userId={profile.id}
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
              {levelName && <LevelBadge level={levelIndex} name={levelName} />}
              {nameActions}
            </div>
            <p className="mt-1.5 text-sm leading-6 text-neutral-600">
              {profile.bio || "这个人很懒，还没写简介。"}
            </p>
            <p className="mt-1 flex items-center gap-1 text-xs text-neutral-400">
              <CalendarDays size={12} aria-hidden /> {joined} 加入
            </p>
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
