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
import { Button } from "@/components/ui/Button";
import { ACTION_TEXT } from "@/lib/ui/cls";
import { useDownloadBump } from "@/components/resource/detail/download-count";

// 关注按钮专用：唯一保留描边/实底的社交控件 —— 它是详情页唯一的主转化动作。
// 点赞/收藏/举报/编辑已统一走 ACTION_TEXT（详情页操作条，见 parts.tsx 的 ActionBar）：
// 图标 + 文字、无边框无底色，图标 aria-hidden，状态靠文案 + 颜色双通道。
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
  // 动作项：图标 + 文字（见 ACTION_TEXT 注释）。状态用文案（点赞 ↔ 已赞）+ 颜色双通道表达
  return (
    <Button
      type="button"
      disabled={pending}
      aria-pressed={liked}
      onClick={() =>
        start(async () => {
          const r = await toggleLikeAction(resourceId);
          if (r.liked !== liked) {
            setLiked(r.liked);
            setN((x) => x + (r.liked ? 1 : -1));
          }
        })
      }
      className={`${ACTION_TEXT} ${liked ? "font-medium text-red-600 hover:text-red-600" : ""}`}
    >
      <Heart size={15} aria-hidden className={liked ? "fill-current" : ""} />
      {liked ? "已赞" : "点赞"}
      {n > 0 ? ` ${n}` : ""}
    </Button>
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
  const [colId, setColId] = useState<string | null>(initialCollectionId ?? null);
  const [prevFav, setPrevFav] = useState(initialFavorited);
  const [prevCount, setPrevCount] = useState(count);
  const [prevColId, setPrevColId] = useState<string | null>(initialCollectionId ?? null);
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
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        disabled={pending}
        aria-pressed={fav}
        onClick={() =>
          start(async () => {
            const r = await toggleFavoriteAction(resourceId);
            if (r.favorited !== fav) {
              setFav(r.favorited);
              setN((x) => x + (r.favorited ? 1 : -1));
            }
          })
        }
        className={`${ACTION_TEXT} ${fav ? "font-medium text-amber-600 hover:text-amber-600" : ""}`}
      >
        <Star size={15} aria-hidden className={fav ? "fill-current" : ""} />
        {fav ? "已收藏" : "收藏"}
        {n > 0 ? ` ${n}` : ""}
      </Button>
      {/* 已收藏且已有夹子可选：下拉切换所属夹子（同样去边框，跟随文字化） */}
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
          className="max-w-28 rounded-none bg-transparent py-1 text-xs text-neutral-500 transition hover:text-neutral-900 focus-visible:underline"
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
    <Button
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
    </Button>
  );
}

/** 统一下载按钮（IMAGE 整包 / ARTICLE 附件行 / GAME externalUrl 外链）。
 *  登录墙与计数语义统一（loginRequired && !authed → 登录链接）。 */
export function MetaDownloadButton({
  resourceId,
  url,
  label,
  loginRequired,
  authed,
  callbackPath,
  count,
  small,
  name,
  kind = "file",
}: {
  resourceId: string;
  url: string;
  label: string;
  loginRequired: boolean;
  authed: boolean;
  callbackPath?: string;
  /** 传入则在按钮右侧显示次数（点击后乐观 +1）；缺省不显示 */
  count?: number;
  /** ARTICLE 清单行内紧凑样式 */
  small?: boolean;
  /** 原始文件名：file 类型经 /api/dl 代理下载时作为保存名（修复“文件名不是原名”） */
  name?: string;
  /** file = 本站托管附件（走代理强制原名）；link = 作者外链（原样打开） */
  kind?: "file" | "link";
}) {
  const [n, setN] = useState(count ?? 0);
  const [prevCount, setPrevCount] = useState(count);
  // 服务端 refresh 后以最新 props 为准（渲染期派生 state，避免 effect 内 setState）
  if (prevCount !== count) {
    setPrevCount(count);
    setN(count ?? 0);
  }
  // 详情页下载清单把「已下载 N 次」放在区块头（DownloadCountScope），
  // 点任意一行都要让那里跟着 +1 —— 按钮自身在 <li> 里，够不到区块头。
  const bump = useDownloadBump();
  const [pending, start] = useTransition();
  const path = callbackPath ?? `/resources/${resourceId}`;
  const showCount = count !== undefined;
  // file 类型走本站 /api/dl 代理，强制以原始文件名保存；link 类型（作者外链）原样打开
  const dlHref =
    kind === "file"
      ? `/api/dl?u=${encodeURIComponent(url)}&n=${encodeURIComponent(name ?? "")}`
      : url;
  if (loginRequired && !authed) {
    return (
      <a
        href={`/login?callbackUrl=${encodeURIComponent(path)}`}
        className={`inline-flex items-center gap-1.5 rounded-none border border-emerald-600 bg-emerald-600 font-medium text-white hover:bg-emerald-500 ${
          small ? "px-2.5 py-1 text-xs" : "px-5 py-2 text-sm"
        }`}
      >
        <Download size={small ? 13 : 15} aria-hidden /> 登录后下载
      </a>
    );
  }
  return (
    <Button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await incrementDownloadAction(resourceId);
          if (showCount) setN((x) => x + 1);
          bump?.();
          window.open(dlHref, "_blank", "noopener");
        })
      }
      className={`inline-flex items-center gap-1.5 rounded-none border border-emerald-600 bg-emerald-600 font-medium text-white transition hover:bg-emerald-500 disabled:opacity-60 ${
        small ? "px-2.5 py-1 text-xs" : "px-5 py-2 text-sm"
      }`}
    >
      <Download size={small ? 13 : 15} aria-hidden /> {label}
      {showCount ? ` ${n > 0 ? n : ""}`.trimEnd() : ""}
    </Button>
  );
}
