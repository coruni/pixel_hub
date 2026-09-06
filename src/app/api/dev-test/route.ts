// 仅本地开发：把 server action 包成受会话保护的 RPC，供 _test/*.mjs 行为测试调用。
// 生产构建（NODE_ENV=production）直接 404 —— 不注册任何可执行入口，也不提前加载 action 模块。
// 会话/权限仍由 action 自己校验（staff/adminOnly），本路由不额外开门。
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ActionFn = (...args: never[]) => unknown;

/** 测试别名 → action 惰性加载器（动态 import：生产不会被打包进主 chunk） */
const REGISTRY: Record<string, () => Promise<ActionFn>> = {
  // 社交
  toggleLike: async () => (await import("@/lib/actions/social")).toggleLikeAction,
  toggleFavorite: async () => (await import("@/lib/actions/social")).toggleFavoriteAction,
  setFavoriteCollection: async () => (await import("@/lib/actions/social")).setFavoriteCollectionAction,
  createCollection: async () => (await import("@/lib/actions/social")).createCollectionAction,
  renameCollection: async () => (await import("@/lib/actions/social")).renameCollectionAction,
  deleteCollection: async () => (await import("@/lib/actions/social")).deleteCollectionAction,
  toggleFollow: async () => (await import("@/lib/actions/social")).toggleFollowAction,
  addComment: async () => (await import("@/lib/actions/social")).addCommentAction,
  deleteComment: async () => (await import("@/lib/actions/social")).deleteCommentAction,
  // 资源
  createResource: async () => (await import("@/lib/actions/resource")).createResourceAction,
  addVersion: async () => (await import("@/lib/actions/resource")).addVersionAction,
  bumpVersionDownload: async () =>
    (await import("@/lib/actions/resource")).bumpVersionDownloadAction,
  // 审核 / 治理
  approveResource: async () => (await import("@/lib/actions/moderation")).approveResourceAction,
  rejectResource: async () => (await import("@/lib/actions/moderation")).rejectResourceAction,
  setResourceRemoved: async () => (await import("@/lib/actions/moderation")).setResourceRemoved,
  restoreResource: async () => (await import("@/lib/actions/moderation")).restoreResource,
  setUserBanned: async () => (await import("@/lib/actions/moderation")).setUserBanned,
  setUserRole: async () => (await import("@/lib/actions/moderation")).setUserRole,
  setUserTrusted: async () => (await import("@/lib/actions/moderation")).setUserTrusted,
  reportResource: async () => (await import("@/lib/actions/report")).reportResourceAction,
  // 账号 / 通知
  changePassword: async () => (await import("@/lib/actions/settings")).changePasswordAction,
  changeEmail: async () => (await import("@/lib/actions/settings")).changeEmailAction,
  markAllNotificationsRead: async () =>
    (await import("@/lib/actions/notify")).markAllNotificationsReadAction,
  deleteNotification: async () => (await import("@/lib/actions/notify")).deleteNotificationAction,
  clearNotifications: async () => (await import("@/lib/actions/notify")).clearNotificationsAction,
  // 后台数据管理
  uploadMedia: async () => (await import("@/lib/actions/admin-media")).uploadMediaAction,
  deleteMedia: async () => (await import("@/lib/actions/admin-media")).deleteMediaAction,
  bulkDeleteOrphanMedia: async () =>
    (await import("@/lib/actions/admin-media")).bulkDeleteOrphanMediaAction,
  updateResourceAdmin: async () =>
    (await import("@/lib/actions/admin-content")).updateResourceAdminAction,
};

/** 测试用 FormData 描述 → 真 FormData（{ __fd: {字段}, __file: {name,mime,base64} }） */
function buildArg(a: unknown): unknown {
  if (!a || typeof a !== "object" || Array.isArray(a) || !("__fd" in a)) return a;
  const spec = a as {
    __fd?: Record<string, unknown>;
    __file?: { name: string; mime: string; base64: string };
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries(spec.__fd ?? {})) fd.append(k, String(v));
  if (spec.__file) {
    const buf = Buffer.from(spec.__file.base64, "base64");
    fd.append("file", new File([buf], spec.__file.name, { type: spec.__file.mime }));
  }
  return fd;
}

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") return new NextResponse("Not Found", { status: 404 });

  const body = (await req.json().catch(() => null)) as
    | { name?: string; args?: unknown[] }
    | null
    | undefined;
  const name = typeof body?.name === "string" ? body.name : "";
  const load = REGISTRY[name];
  if (!load) return NextResponse.json({ error: `unknown action: ${name}` }, { status: 404 });

  const args = (Array.isArray(body?.args) ? body.args : []).map(buildArg);
  try {
    const fn = await load();
    const result = await fn(...(args as never[]));
    return NextResponse.json({ result });
  } catch (e) {
    // redirect() 以抛出带 NEXT_REDIRECT digest 的错误实现：对测试是信号而非失败
    const digest = (e as { digest?: unknown })?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT"))
      return NextResponse.json({ error: "NEXT_REDIRECT" });
    const msg = e instanceof Error ? e.message : "action failed";
    return NextResponse.json({ error: msg.slice(0, 300) });
  }
}
