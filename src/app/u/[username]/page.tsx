import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { getFeed, getProfile } from "@/lib/queries";
import { formatCount } from "@/lib/format";
import MasonryGrid from "@/components/resource/MasonryGrid";
import { FollowButton } from "@/components/social/interactions";

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
 const { username } = await params;
 const p = await getProfile(username);
 return { title: p ? `${p.name ?? p.username} · 个人主页` : "用户不存在" };
}

const roleBadge: Record<string, { label: string; cls: string }> = {
 ADMIN: { label: "管理员", cls: "bg-red-50 text-red-600" },
 MODERATOR: { label: "版主", cls: "bg-amber-50 text-amber-600" },
};

export default async function UserPage({ params }: { params: Promise<{ username: string }> }) {
 const { username } = await params;
 const session = await auth();
 const me = session?.user;

 const profile = await getProfile(username, me?.id);
 if (!profile) notFound();

 const pubCount = await prisma.resource.count({ where: { authorId: profile.id, status: "PUBLISHED" } });
 const { items } = await getFeed({ authorUsername: username, page: 1, pageSize: 48 });

 const joined = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(profile.createdAt);

 return (
 <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
 {/* 头部 */}
 <div className="flex flex-wrap items-center gap-5">
 <span className="grid h-20 w-20 place-items-center rounded-none border border-brand-600 bg-brand-500 text-2xl font-semibold text-white">
 {(profile.name ?? profile.username).slice(0, 1).toUpperCase()}
 </span>
 <div className="min-w-0 flex-1">
 <div className="flex flex-wrap items-center gap-2">
 <h1 className="truncate text-2xl font-semibold tracking-tight text-neutral-900">
 {profile.name ?? profile.username}
 </h1>
 <span className="text-sm text-neutral-400">@{profile.username}</span>
 {roleBadge[profile.role] && (
 <span className={`rounded-none px-1.5 py-0.5 text-[10px] font-medium ${roleBadge[profile.role].cls}`}>
 {roleBadge[profile.role].label}
 </span>
 )}
 {profile.trusted && (
 <span className="rounded-none bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">免审发布</span>
 )}
 </div>
 <p className="mt-1 text-sm text-neutral-500">{profile.bio || "这个人很懒，还没写简介。"}</p>
 <p className="mt-1 text-xs text-neutral-400">{joined} 加入</p>
 </div>
 <div className="flex gap-3">
 {profile.isViewer ? (
 <Link
 href="/settings"
 className="rounded-none border border-brand-200 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
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

 {/* 统计 */}
 <div className="mt-6 flex max-w-md gap-3 text-center">
 {[
 { n: formatCount(pubCount), k: "发布" },
 { n: formatCount(profile.followerCount), k: "粉丝" },
 { n: formatCount(profile.followingCount), k: "关注" },
 ].map((s) => (
 <div key={s.k} className="flex-1 rounded-none border border-brand-200 bg-surface py-3">
 <div className="text-lg font-semibold text-neutral-900">{s.n}</div>
 <div className="text-[11px] text-neutral-400">{s.k}</div>
 </div>
 ))}
 </div>

 {/* 内容 */}
 <h2 className="mt-10 text-sm font-semibold text-neutral-400">发布的作品</h2>
 <MasonryGrid className="mt-4" items={items} />
 {items.length === 0 && (
 <div className="mt-4 py-16 text-center text-sm text-neutral-400">还没有发布内容</div>
 )}
 </div>
 );
}
