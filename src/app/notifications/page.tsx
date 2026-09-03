import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Bell, Heart, MessageSquare, ShieldAlert, UserPlus, type LucideIcon } from "lucide-react";
import { auth } from "@/lib/auth";
import { getNotifications, type NotificationRow } from "@/lib/queries";
import { timeAgo } from "@/lib/format";
import { markAllNotificationsReadAction } from "@/lib/actions/notify";

export const metadata: Metadata = { title: "通知" };

function describe(n: NotificationRow): { icon: LucideIcon; text: string; href?: string; color: string } {
 const who = n.actor ? n.actor.name ?? `@${n.actor.username}` : "系统";
 switch (n.type) {
 case "FOLLOW":
 return { icon: UserPlus, text: `${who} 关注了你`, color: "text-neutral-800" };
 case "LIKE":
 return {
 icon: Heart,
 text: `${who} 赞了你的内容${n.resource ? `「${n.resource.title}」` : ""}`,
 color: "text-neutral-800",
 href: n.resource ? `/resources/${n.resource.slug}` : undefined,
 };
 case "COMMENT":
 return {
 icon: MessageSquare,
 text: `${who} 评论了你的内容${n.resource ? `「${n.resource.title}」` : ""}`,
 color: "text-neutral-800",
 href: n.resource ? `/resources/${n.resource.slug}#comments` : undefined,
 };
 case "MODERATION":
 return {
 icon: ShieldAlert,
 text: n.message ?? "你的内容审核状态有更新",
 color: "text-amber-700",
 href: n.resource ? `/resources/${n.resource.slug}` : undefined,
 };
 default:
 return { icon: Bell, text: n.message ?? "系统通知", color: "text-neutral-800" };
 }
}

export default async function NotificationsPage() {
 const session = await auth();
 if (!session?.user) redirect("/login?callbackUrl=/notifications");
 const { rows, unread } = await getNotifications(session.user.id);

 return (
 <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
 <div className="flex items-center justify-between">
 <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
 通知{unread > 0 && <span className="ml-2 text-base font-normal text-red-500">({unread} 未读)</span>}
 </h1>
 {unread > 0 && (
 <form
 action={async () => {
 "use server";
 await markAllNotificationsReadAction();
 }}
 >
 <button
 type="submit"
 className="rounded-none border border-brand-200 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-100"
 >
 全部标为已读
 </button>
 </form>
 )}
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
 </span>
 );
 return (
 <li key={n.id}>
 {d.href ? (
 <Link
 href={d.href}
 className={`block rounded-none px-3 py-3 transition hover:bg-neutral-100 ${n.readAt ? "opacity-60" : "bg-surface"}`}
 >
 {inner}
 </Link>
 ) : (
 <div className={`block rounded-none px-3 py-3 ${n.readAt ? "opacity-60" : "bg-surface"}`}>{inner}</div>
 )}
 </li>
 );
 })}
 {rows.length === 0 && <li className="py-20 text-center text-sm text-neutral-400">还没有通知</li>}
 </ul>
 </div>
 );
}
