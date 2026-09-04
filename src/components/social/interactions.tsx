"use client";

import { useState, useTransition } from "react";
import { Download, Heart, Star } from "lucide-react";
import {
  toggleLikeAction,
  toggleFavoriteAction,
  toggleFollowAction,
  incrementDownloadAction,
  setFavoriteCollectionAction,
} from "@/lib/actions/social";

const baseBtn =
  "inline-flex items-center gap-1.5 rounded-none border px-3.5 py-2 text-sm transition disabled:opacity-60";

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
  const [prevLiked, setPrevLiked] = useState(initialLiked);
  const [prevCount, setPrevCount] = useState(count);
  // 服务端 refresh 后以最新 props 为准（渲染期派生 state，避免 effect 内 setState）
  if (prevLiked !== initialLiked || prevCount !== count) {
    setPrevLiked(initialLiked);
    setPrevCount(count);
    setLiked(initialLiked);
    setN(count);
  }
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
  collections,
  initialCollectionId,
}: {
  resourceId: string;
  initialFavorited: boolean;
  count: number;
  collections?: { id: string; name: string }[];
  initialCollectionId?: string | null;
}) {
  const [fav, setFav] = useState(initialFavorited);
  const [n, setN] = useState(count);
  const [colId, setColId] = useState<string | null>(
    initialCollectionId ?? null,
  );
  const [prevFav, setPrevFav] = useState(initialFavorited);
  const [prevCount, setPrevCount] = useState(count);
  const [prevColId, setPrevColId] = useState<string | null>(
    initialCollectionId ?? null,
  );
  // 服务端 refresh 后以最新 props 为准（渲染期派生 state，避免 effect 内 setState）
  if (
    prevFav !== initialFavorited ||
    prevCount !== count ||
    prevColId !== (initialCollectionId ?? null)
  ) {
    setPrevFav(initialFavorited);
    setPrevCount(count);
    setPrevColId(initialCollectionId ?? null);
    setFav(initialFavorited);
    setN(count);
    setColId(initialCollectionId ?? null);
  }
  const [pending, start] = useTransition();
  const list = collections ?? [];
  return (
    <span className="inline-flex items-stretch gap-1.5">
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
      {/* 已收藏且已有夹子可选：下拉切换所属夹子 */}
      {fav && list.length > 0 && (
        <select
          value={colId ?? ""}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.value || null;
            setColId(next);
            start(async () => {
              await setFavoriteCollectionAction(resourceId, next);
            });
          }}
          title="所属收藏夹"
          className="max-w-28 rounded-none border border-brand-200 bg-surface px-1.5 py-1.5 text-xs text-neutral-600 hover:border-brand-500"
        >
          <option value="">未分组</option>
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
    </span>
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
  const [prevFollowing, setPrevFollowing] = useState(initialFollowing);
  // 服务端 refresh 后以最新 props 为准（渲染期派生 state，避免 effect 内 setState）
  if (prevFollowing !== initialFollowing) {
    setPrevFollowing(initialFollowing);
    setFollowing(initialFollowing);
  }
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
