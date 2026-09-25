// 首页板块 —— 服务端查询层（渲染 / 后台初始化共用）。
// 板块目录与 config 校验见 home-config.ts。
import { prisma } from "@/lib/db/prisma";
import { isOnline } from "@/lib/online";
import {
  DEFAULT_SECTIONS,
  HOME_SECTION_KINDS,
  parseSectionConfig,
  type HomeSectionConfig,
  type HomeSectionKind,
} from "@/lib/home-config";
// 榜单周期口径与 /creators 共用一份（滚动窗口 all/month/week），避免两处各写一套
import { periodSince, type RankPeriod } from "@/lib/points";

export type HomeSectionView = {
  id: string;
  kind: HomeSectionKind;
  title: string | null;
  order: number;
  enabled: boolean;
  /** 设备端可见性：all=不限 / pc=仅电脑端 / mobile=仅移动端 */
  visibleOn: "all" | "pc" | "mobile";
  /** 是否仅登录用户可见 */
  requireAuth: boolean;
  config: HomeSectionConfig;
};

/** 读取启用的板块列表（按 order 升序）。空表时用代码内默认布局兜底渲染，绝不空白。 */
export async function getHomeSections(): Promise<HomeSectionView[]> {
  const rows = await prisma.homeSection.findMany({ orderBy: { order: "asc" } });
  if (rows.length === 0) {
    return DEFAULT_SECTIONS.map((d, i) => ({
      id: `__default__${i}`,
      kind: d.kind,
      title: d.title,
      order: d.order,
      enabled: d.enabled,
      visibleOn: "all",
      requireAuth: false,
      config: d.config,
    }));
  }
  return rows.map((r) => {
    const kind = (HOME_SECTION_KINDS as string[]).includes(r.kind)
      ? (r.kind as HomeSectionKind)
      : "feed";
    return {
      id: r.id,
      kind,
      title: r.title,
      order: r.order,
      enabled: r.enabled,
      visibleOn: r.visibleOn === "pc" || r.visibleOn === "mobile" ? r.visibleOn : "all",
      requireAuth: r.requireAuth === true,
      config: parseSectionConfig(r.kind as HomeSectionKind, r.config),
    };
  });
}

/** 空表时落库默认布局（后台首页布局页首次打开前调用），幂等 */
export async function ensureHomeSections(): Promise<void> {
  const n = await prisma.homeSection.count();
  if (n > 0) return;
  await prisma.homeSection.createMany({
    data: DEFAULT_SECTIONS.map((d) => ({
      kind: d.kind,
      title: d.title,
      order: d.order,
      enabled: d.enabled,
      config: JSON.stringify(d.config),
    })),
  });
}

/** 板块渲染用的纯数据模型（传给各板块组件） */
export function toView(r: {
  id: string;
  kind: string;
  title: string | null;
  order: number;
  enabled: boolean;
  visibleOn?: string | null;
  requireAuth?: boolean | null;
  config: string | null;
}): HomeSectionView {
  const kind = (HOME_SECTION_KINDS as string[]).includes(r.kind)
    ? (r.kind as HomeSectionKind)
    : "feed";
  return {
    id: r.id,
    kind,
    title: r.title,
    order: r.order,
    enabled: r.enabled,
    visibleOn: r.visibleOn === "pc" || r.visibleOn === "mobile" ? r.visibleOn : "all",
    requireAuth: r.requireAuth === true,
    config: parseSectionConfig(kind, r.config),
  };
}

// ---------- 各板块的数据查询 ----------

export type HomeStats = { resources: number; users: number; downloads: number; views: number };

export async function getHomeStats(): Promise<HomeStats> {
  const [resources, users, agg] = await Promise.all([
    prisma.resource.count({ where: { status: "PUBLISHED" } }),
    prisma.user.count({ where: { bannedAt: null } }),
    prisma.resource.aggregate({
      where: { status: "PUBLISHED" },
      _sum: { downloadCount: true, viewCount: true },
    }),
  ]);
  return {
    resources,
    users,
    downloads: agg._sum.downloadCount ?? 0,
    views: agg._sum.viewCount ?? 0,
  };
}

/** 分类 id → 已上架资源数 */
export async function getPublishedCountByCategory(): Promise<Map<string, number>> {
  const rows = await prisma.resource.groupBy({
    by: ["categoryId"],
    where: { status: "PUBLISHED", categoryId: { not: null } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.categoryId as string, r._count._all]));
}

export type CreatorSort = "followers" | "points";

export type CreatorRow = {
  id: string;
  username: string;
  name: string | null;
  avatarKey: string | null;
  resources: number;
  /**
   * **驱动本次排名的数值**，口径由 sort + period 决定，展示时必须配套 `creatorMetaText()` 才能对上标签：
   *   - sort=followers + period=all   → 累计粉丝数
   *   - sort=followers + week/month   → 窗口内**新增关注数**（不等于累计粉丝数！）
   *   - sort=points    + period=all   → 累计贡献分
   *   - sort=points    + week/month   → 窗口内贡献分
   */
  metric: number;
  online: boolean;
};

/**
 * 首页 creators 板块与侧栏 creators 组件共用的取数。
 *
 * 【兼容红线】`sort` 默认必须是 `"followers"`、`period` 默认必须是 `"all"` ——
 * 存量板块配置里只有 `count`，默认值一改，不改后台配置的现网排序就会被动变化。
 *
 * `period` 在两种排序下都生效：
 *   - followers + week/month → 按**近期新增关注数**排（「最近谁最受关注」），而非累计粉丝数
 *   - points + week/month    → 按滚动窗口内的贡献分排（与 /creators 月榜/周榜同一口径）
 * 已封禁用户在任何路径下都不上榜。
 */
export async function getTopCreators(
  limit: number,
  sort: CreatorSort = "followers",
  period: RankPeriod = "all",
): Promise<CreatorRow[]> {
  const since = periodSince(period);
  const ids: string[] = [];
  const metricById = new Map<string, number>();

  if (sort === "points") {
    if (since) {
      const rows = await prisma.pointLog.groupBy({
        by: ["userId"],
        where: { createdAt: { gte: since }, delta: { gt: 0 }, user: { bannedAt: null } },
        _sum: { delta: true },
        orderBy: [{ _sum: { delta: "desc" } }, { userId: "asc" }],
        take: limit,
      });
      for (const r of rows) {
        ids.push(r.userId);
        metricById.set(r.userId, r._sum.delta ?? 0);
      }
    } else {
      const rows = await prisma.userPoint.findMany({
        where: { user: { bannedAt: null } },
        orderBy: [{ balance: "desc" }, { userId: "asc" }],
        take: limit,
        select: { userId: true, balance: true },
      });
      for (const r of rows) {
        ids.push(r.userId);
        metricById.set(r.userId, r.balance);
      }
    }
  } else if (since) {
    const rows = await prisma.follow.groupBy({
      by: ["followingId"],
      where: { createdAt: { gte: since }, following: { bannedAt: null } },
      _count: { followingId: true },
      orderBy: [{ _count: { followingId: "desc" } }, { followingId: "asc" }],
      take: limit,
    });
    for (const r of rows) {
      ids.push(r.followingId);
      metricById.set(r.followingId, r._count.followingId);
    }
  } else {
    const rows = await prisma.user.findMany({
      where: { bannedAt: null },
      orderBy: { followers: { _count: "desc" } },
      take: limit,
      select: { id: true, _count: { select: { followers: true } } },
    });
    for (const r of rows) {
      ids.push(r.id);
      metricById.set(r.id, r._count.followers);
    }
  }

  if (ids.length === 0) return [];

  // 两步取数（先定序再补展示信息）：让排序走索引，避免 orderBy 与 join 互相牵制
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      username: true,
      name: true,
      avatarKey: true,
      lastSeenAt: true,
      _count: { select: { resources: true } },
    },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  const out: CreatorRow[] = [];
  for (const id of ids) {
    const u = byId.get(id);
    if (!u) continue; // 期间被删号
    out.push({
      id,
      username: u.username,
      name: u.name,
      avatarKey: u.avatarKey,
      resources: u._count.resources,
      metric: metricById.get(id) ?? 0,
      online: isOnline(u.lastSeenAt),
    });
  }
  return out;
}

/** 供 hero 后台挑选时补全标题等展示信息 */
export async function getResourcePickMeta(
  ids: string[],
): Promise<{ id: string; title: string; slug: string }[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.resource.findMany({
    where: { id: { in: ids }, status: "PUBLISHED" },
    select: { id: true, title: true, slug: true },
  });
  // 按传入顺序返回
  const map = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => (map.get(id) ? [map.get(id)!] : []));
}
