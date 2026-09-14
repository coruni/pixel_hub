import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import {
  Bell,
  Heart,
  MessageSquare,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { auth } from "@/lib/auth";
import {
  getNotifications,
  NOTIFICATION_PAGE_SIZE,
  type NotificationFilter,
  type NotificationRow,
} from "@/lib/queries";
import { timeAgo } from "@/lib/format";
import { markAllNotificationsReadAction } from "@/lib/actions/notify";
import { NotificationDelete, NotificationsClearAll } from "@/components/social/notify-actions";
import NotificationCardLink from "@/components/social/notification-card-link";
import { Button } from "@/components/ui/Button";

export const metadata: Metadata = { title: "通知", robots: { index: false } };

// 「系统」页含审核结果 + 系统公告；「安全」页只放账号安全变动（这类通知不可关闭）
const FILTERS = [
  { key: "", label: "全部", icon: Bell },
  { key: "LIKE", label: "赞", icon: Heart },
  { key: "COMMENT", label: "评论", icon: MessageSquare },
  { key: "FOLLOW", label: "关注", icon: UserPlus },
  { key: "SYSTEM", label: "系统", icon: ShieldAlert },
  { key: "SECURITY", label: "安全", icon: ShieldCheck },
] as const;

const FILTER_KEYS = FILTERS.map((f) => f.key).filter((k): k is NotificationFilter => k !== "");

function describe(n: NotificationRow): {
  icon: LucideIcon;
  text: string;
  href?: string;
  color: string;
} {
  const who = n.actor ? (n.actor.name ?? `@${n.actor.username}`) : "系统";
  const title = n.resource ? `「${n.resource.title}」` : "";
  switch (n.type) {
    case "FOLLOW":
      return { icon: UserPlus, text: `${who} 关注了你`, color: "text-neutral-800" };
    case "LIKE":
      return {
        icon: Heart,
        // count > 1 = 同一批未读里的多个赞已聚合，避免几十条「XX 赞了你」刷屏
        text:
          n.count > 1
            ? `${who} 等 ${n.count} 人赞了你的内容${title}`
            : `${who} 赞了你的内容${title}`,
        color: "text-neutral-800",
        href: n.resource ? `/resources/${n.resource.slug}` : undefined,
      };
    case "COMMENT":
      return {
        icon: MessageSquare,
        // message 里带了评论摘要（「评论了你的内容：xxx」/「回复了你的评论：xxx」）
        text: n.message ? `${who} ${n.message}` : `${who} 评论了你的内容${title}`,
        color: "text-neutral-800",
        // 定位到触发通知的那条评论（含楼中楼）；评论已删/无 commentId 时退到评论区顶部
        href: n.resource
          ? n.commentId
            ? `/resources/${n.resource.slug}#comment-${n.commentId}`
            : `/resources/${n.resource.slug}#comments`
          : undefined,
      };
    case "MODERATION":
      return {
        icon: ShieldAlert,
        text: n.message ?? "你的内容审核状态有更新",
        color: "text-amber-700",
        href: n.resource ? `/resources/${n.resource.slug}` : undefined,
      };
    case "SECURITY":
      return {
        icon: ShieldCheck,
        text: n.message ?? "你的账号有安全变动",
        color: "text-red-600",
        href: "/settings?tab=security",
      };
    default:
      return { icon: Bell, text: n.message ?? "系统通知", color: "text-neutral-800" };
  }
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; page?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/notifications");
  const { type, page: pageRaw } = await searchParams;
  const filter = FILTER_KEYS.find((k) => k === type);
  const { rows, unread, total, page, hasMore } = await getNotifications(
    session.user.id,
    filter,
    Number(pageRaw) || 1,
  );
  const pages = Math.max(1, Math.ceil(total / NOTIFICATION_PAGE_SIZE));

  // 翻页链接保留当前筛选条件
  const pageHref = (p: number) => {
    const sp = new URLSearchParams();
    if (filter) sp.set("type", filter);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `/notifications?${s}` : "/notifications";
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          通知
          {unread > 0 && (
            <span className="ml-2 text-base font-normal text-red-500">({unread} 未读)</span>
          )}
        </h1>
        <div className="flex items-center gap-2">
          {unread > 0 && (
            <form
              action={async () => {
                "use server";
                await markAllNotificationsReadAction();
              }}
            >
              <Button
                type="submit"
                className="rounded-none border border-brand-200 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-100"
              >
                全部标为已读
              </Button>
            </form>
          )}
          {rows.length > 0 && <NotificationsClearAll />}
        </div>
      </div>

      {/* 类型筛选 */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => {
          const active = (filter ?? "") === f.key;
          const Icon = f.icon;
          return (
            <Link
              key={f.key || "all"}
              href={f.key ? `/notifications?type=${f.key}` : "/notifications"}
              className={`inline-flex items-center gap-1.5 rounded-none border px-3 py-1.5 text-xs transition ${
                active
                  ? "border-brand-600 bg-brand-500 text-white hover:bg-brand-600"
                  : "border-brand-200 text-neutral-600 hover:border-brand-400 hover:bg-neutral-100"
              }`}
            >
              <Icon size={13} aria-hidden />
              {f.label}
            </Link>
          );
        })}
      </div>

      <ul className="mt-6 space-y-1">
        {rows.map((n) => {
          const d = describe(n);
          const inner = (
            <span className="flex items-start gap-3">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-none bg-neutral-100 text-neutral-500">
                <d.icon size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-sm leading-6 ${d.color}`}>{d.text}</span>
                <span className="block text-[11px] text-neutral-400">
                  {n.actor ? (
                    <>
                      来自{" "}
                      <Link href={`/u/${n.actor!.username}`} className="hover:underline">
                        @{n.actor!.username}
                      </Link>{" "}
                      ·{" "}
                    </>
                  ) : null}
                  {timeAgo(n.createdAt)}
                </span>
              </span>
              {!n.readAt && <span className="mt-2 h-2 w-2 shrink-0 rounded-none bg-red-400" />}
              <NotificationDelete id={n.id} />
            </span>
          );
          return (
            <li key={n.id}>
              {d.href ? (
                <NotificationCardLink
                  href={d.href}
                  id={n.id}
                  read={!!n.readAt}
                  className={`block cursor-pointer rounded-none px-3 py-3 transition hover:bg-neutral-100 ${n.readAt ? "opacity-60" : "bg-surface"}`}
                >
                  {inner}
                </NotificationCardLink>
              ) : (
                <div
                  className={`block rounded-none px-3 py-3 ${n.readAt ? "opacity-60" : "bg-surface"}`}
                >
                  {inner}
                </div>
              )}
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="py-20 text-center text-sm text-neutral-400">还没有通知</li>
        )}
      </ul>

      {/* 分页：通知会越攒越多，只给第一页等于让老通知永远看不到 */}
      {pages > 1 && (
        <nav className="mt-6 flex items-center justify-between gap-3 border-t border-brand-100 pt-4 text-xs">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="text-neutral-600 hover:text-neutral-900">
              ← 上一页
            </Link>
          ) : (
            <span className="text-neutral-300">← 上一页</span>
          )}
          <span className="text-neutral-400">
            第 {page} / {pages} 页 · 共 {total} 条
          </span>
          {hasMore ? (
            <Link href={pageHref(page + 1)} className="text-neutral-600 hover:text-neutral-900">
              下一页 →
            </Link>
          ) : (
            <span className="text-neutral-300">下一页 →</span>
          )}
        </nav>
      )}
    </div>
  );
}
