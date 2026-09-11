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

export type CreatorRow = {
  username: string;
  name: string | null;
  avatarKey: string | null;
  resources: number;
  followers: number;
  online: boolean;
};

export async function getTopCreators(limit: number): Promise<CreatorRow[]> {
  const users = await prisma.user.findMany({
    where: { bannedAt: null },
    orderBy: { followers: { _count: "desc" } },
    take: limit,
    select: {
      username: true,
      name: true,
      avatarKey: true,
      lastSeenAt: true,
      _count: { select: { resources: true, followers: true } },
    },
  });
  return users.map((u) => ({
    username: u.username,
    name: u.name,
    avatarKey: u.avatarKey,
    resources: u._count.resources,
    followers: u._count.followers,
    online: isOnline(u.lastSeenAt),
  }));
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
