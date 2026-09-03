"use client";

import { useState, useTransition } from "react";
import { Download, Heart, Star } from "lucide-react";
import {
 toggleLikeAction,
 toggleFavoriteAction,
 toggleFollowAction,
 incrementDownloadAction,
} from "@/lib/actions/social";

const baseBtn =
 "inline-flex items-center gap-1.5 rounded-none border px-3.5 py-1.5 text-sm transition disabled:opacity-60";

export function LikeButton({
 resourceId,
 initialLiked,
 count,
}: {
 resourceId: string;
 initialLiked: boolean;
 count: number;
}) {
 const [liked, setLiked] = useState(initialLiked);
 const [n, setN] = useState(count);
 const [pending, start] = useTransition();
 return (
 <button
 type="button"
 disabled={pending}
 onClick={() =>
 start(async () => {
 const r = await toggleLikeAction(resourceId);
 if (r.liked !== liked) {
 setLiked(r.liked);
 setN((x) => x + (r.liked ? 1 : -1));
 }
 })
 }
 className={`${baseBtn} ${
 liked
 ? "border-red-300 bg-red-50 text-red-600 hover:bg-red-100"
 : "border-brand-200 bg-surface text-neutral-700 hover:border-brand-500"
 }`}
 >
 <Heart size={15} aria-hidden className={liked ? "fill-current" : ""} />
 {n > 0 ? ` 点赞 ${n}` : "点赞"}
 </button>
 );
}

export function FavoriteButton({
 resourceId,
 initialFavorited,
 count,
}: {
 resourceId: string;
 initialFavorited: boolean;
 count: number;
}) {
 const [fav, setFav] = useState(initialFavorited);
 const [n, setN] = useState(count);
 const [pending, start] = useTransition();
 return (
 <button
 type="button"
 disabled={pending}
 onClick={() =>
 start(async () => {
 const r = await toggleFavoriteAction(resourceId);
 if (r.favorited !== fav) {
 setFav(r.favorited);
 setN((x) => x + (r.favorited ? 1 : -1));
 }
 })
 }
 className={`${baseBtn} ${
 fav
 ? "border-amber-300 bg-amber-50 text-amber-600 hover:bg-amber-100"
 : "border-brand-200 bg-surface text-neutral-700 hover:border-brand-500"
 }`}
 >
 <Star size={15} aria-hidden className={fav ? "fill-current" : ""} />
 {n > 0 ? ` 收藏 ${n}` : "收藏"}
 </button>
 );
}

export function FollowButton({
 targetUserId,
 initialFollowing,
}: {
 targetUserId: string;
 initialFollowing: boolean;
}) {
 const [following, setFollowing] = useState(initialFollowing);
 const [pending, start] = useTransition();
 return (
 <button
 type="button"
 disabled={pending}
 onClick={() =>
 start(async () => {
 const r = await toggleFollowAction(targetUserId);
 setFollowing(r.following);
 })
 }
 className={`${baseBtn} ${
 following
 ? "border-brand-200 bg-surface text-neutral-700 hover:border-brand-500"
 : "border-brand-600 bg-brand-500 text-white hover:bg-brand-600"
 }`}
 >
 {following ? "已关注" : "＋ 关注"}
 </button>
 );
}

export function DownloadButton({
 resourceId,
 externalUrl,
 loginRequired,
 authed,
 callbackPath = `/resources/${resourceId}`,
}: {
 resourceId: string;
 externalUrl: string;
 loginRequired: boolean;
 authed: boolean;
 callbackPath?: string;
}) {
 const [pending, start] = useTransition();
 if (loginRequired && !authed) {
 return (
 <a
 href={`/login?callbackUrl=${encodeURIComponent(callbackPath)}`}
 className="inline-flex items-center gap-1.5 rounded-none border border-emerald-600 bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-500"
 >
 <Download size={15} aria-hidden /> 登录后下载
 </a>
 );
 }
 return (
 <button
 type="button"
 disabled={pending}
 onClick={() =>
 start(async () => {
 await incrementDownloadAction(resourceId);
 window.open(externalUrl, "_blank", "noopener");
 })
 }
 className="inline-flex items-center gap-1.5 rounded-none border border-emerald-600 bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
 >
 <Download size={15} aria-hidden /> 下载（外链）
 </button>
 );
}
