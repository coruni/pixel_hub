"use client";

import { useEffect, useRef } from "react";
import { roomResource } from "@/lib/realtime/protocol";
import { useRealtimeConnected, useRealtimeMessages, useRealtimeRoom } from "@/lib/realtime/use-realtime";
import {
  REPLIES_PAGE_SIZE,
  totalPagesOf,
  type CommentShape,
  type NewCommentItem,
} from "./comment-types";

/** WS 在线时的兜底轮询间隔：只用于补漏，正常路径由实时信号触发 */
const FALLBACK_POLL_MS = 60_000;
/** WS 不可用（直接 next dev、代理不支持 upgrade…）时退回原来的轮询节奏 */
const DEGRADED_POLL_MS = 15_000;
/** 增量回复向上找根楼层的层数上限：脏 parentId 成环时的兜底 */
const MAX_ROOT_WALK = 20;

/**
 * 评论实时刷新（纯副作用，不持有列表状态）。
 *
 * 实时通道负责「有事发生」的信号（新评论 / 评论结构变化），数据仍由既有的
 * /api/comments 增量端点提供 —— 合并逻辑（楼中楼挂载、删除兜底）只有这一份实现。
 * 实时不可用时自动退回轮询，功能不降级。
 *
 * 分页之后这里只往「当前已加载的列表」上打补丁：
 * · 翻页由调用方直接替换列表，本 hook 不感知；
 * · props 引用变化（发帖后的 router.refresh）→ 由 sinceResetKey 重置轮询基准；
 * · 删除 / 审核这类增量表达不了的变化 → 回调 onReload 重拉当前页，
 *   而不是 router.refresh（那会把用户从第 3 页弹回第 1 页）。
 */
export function useCommentPolling({
  resourceId,
  comments,
  setComments,
  sinceResetKey,
  page,
  onReload,
  onAdded,
}: {
  resourceId: string;
  /** 当前已加载的列表：合并基底 */
  comments: CommentShape[];
  /** 写入合并结果 */
  setComments: (next: CommentShape[]) => void;
  /** 服务端下发的那一页（引用变化即重置轮询基准）；与 comments 不同，它不随合并不变 */
  sinceResetKey: CommentShape[];
  /** 当前根楼层页号：只有第 1 页才并入新增的根评论 */
  page: number;
  /** 结构变化（删除 / 审核）兜底：重新拉当前页 */
  onReload: () => void;
  /** 本次并入了几条评论（含回复），用于同步标题计数 */
  onAdded: (count: number) => void;
}): void {
  const connected = useRealtimeConnected();
  // poll 闭包只挂一次，这些最新值一律走 ref
  const commentsRef = useRef(comments);
  const setCommentsRef = useRef(setComments);
  const pageRef = useRef(page);
  const onReloadRef = useRef(onReload);
  const onAddedRef = useRef(onAdded);
  // 服务端时钟基准，避免客户端时钟偏差
  const sinceRef = useRef<string>(new Date().toISOString());
  // poll 实例（实时信号与定时器都通过它触发，避免两处各持一份闭包）
  const pollRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    commentsRef.current = comments;
    setCommentsRef.current = setComments;
    pageRef.current = page;
    onReloadRef.current = onReload;
    onAddedRef.current = onAdded;
  });

  // 服务端重新下发（发帖后的 router.refresh）时重置基准，避免把已下发的评论再拉一遍
  useEffect(() => {
    const times = sinceResetKey
      .map((c) => new Date(c.createdAt).getTime())
      .filter((t) => !Number.isNaN(t));
    if (times.length > 0) sinceRef.current = new Date(Math.max(...times)).toISOString();
  }, [sinceResetKey]);

  useEffect(() => {
    async function poll() {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(
          `/api/comments?resourceId=${encodeURIComponent(resourceId)}&since=${encodeURIComponent(sinceRef.current)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          items: NewCommentItem[];
          serverTime: string;
          liveIds: string[];
        };
        sinceRef.current = data.serverTime;

        const cur = commentsRef.current;

        // 删除兜底：本地可见但服务端已不在公开集合 → 重拉当前页。
        // 分页后本地只是全量的子集，但这个判断方向仍然成立：全量 ⊇ 本地子集，
        // 本地 id 只要不在 liveIds 里，就一定是被删 / 被隐藏了。
        const localIds = new Set(cur.flatMap((c) => [c.id, ...c.replies.map((r) => r.id)]));
        if ([...localIds].some((id) => !data.liveIds.includes(id))) {
          onReloadRef.current();
          return;
        }

        if (data.items.length === 0) return;

        // 浅拷贝一层：回复数组与分页对象会在下面就地改，不能污染上一版 state
        const next = cur.map((c) => ({
          ...c,
          replies: [...c.replies],
          repliesPaging: { ...c.repliesPaging },
        }));
        // id → 所属根楼层（根自己也映射到自己），用于把增量回复挂回它那一条
        const known = new Map<string, CommentShape>();
        for (const c of next) {
          known.set(c.id, c);
          for (const r of c.replies) known.set(r.id, c);
        }

        let added = 0;
        for (const item of data.items) {
          if (known.has(item.id)) continue; // 已存在（自己刚发的，refresh 已带上）

          if (!item.parentId) {
            // 根楼层：列表按 createdAt 倒序，新评论只属于第 1 页。
            // 用户正在看更早的页时不并入（插进去会让页码与内容对不上），只让总数 +1。
            if (pageRef.current === 1) {
              const fresh: CommentShape = {
                id: item.id,
                authorId: item.authorId,
                content: item.content,
                createdAt: item.createdAt,
                author: item.author,
                images: item.images ?? [],
                replies: [],
                repliesPaging: {
                  page: 1,
                  total: 0,
                  pageSize: REPLIES_PAGE_SIZE,
                  hasMore: false,
                },
              };
              next.unshift(fresh);
              known.set(fresh.id, fresh);
            }
            added += 1;
            continue;
          }

          // 回复：沿 parentId 向上找到它所属的根楼层（父可能是另一条回复，也可能不在本地）
          let pid: string | null = item.parentId;
          let owner: CommentShape | undefined;
          for (let guard = 0; pid && guard < MAX_ROOT_WALK; guard++) {
            owner = known.get(pid);
            if (owner) break;
            const parentItem = data.items.find((x) => x.id === pid);
            pid = parentItem?.parentId ?? null;
          }
          // 所属根不在当前页 → 不并入，用户翻过去时自然能看到
          if (!owner) continue;

          // 只有当展示的就是最后一页回复时才追加：否则插进第 1 页会让「1/N」页码说谎
          if (!owner.repliesPaging.hasMore) {
            owner.replies.push({
              id: item.id,
              authorId: item.authorId,
              content: item.content,
              createdAt: item.createdAt,
              author: item.author,
              replyTo: item.replyTo ?? null,
            });
          }
          owner.repliesPaging.total += 1;
          owner.repliesPaging.hasMore =
            owner.repliesPaging.page < totalPagesOf(owner.repliesPaging);
          known.set(item.id, owner);
          added += 1;
        }

        if (added === 0) return;
        setCommentsRef.current(next);
        onAddedRef.current(added);
      } catch {
        // 网络抖动忽略，下一轮重试
      }
    }

    pollRef.current = () => void poll();
    return () => {
      pollRef.current = null;
    };
    // 用到的都是 ref，poll 只在 resourceId 变化时重建
  }, [resourceId]);

  // 订阅本资源的评论房间：实时信号到达即拉一次增量
  useRealtimeRoom(roomResource(resourceId));
  useRealtimeMessages((msg) => {
    if (msg.t === "comment:new" && msg.resourceId === resourceId) {
      pollRef.current?.();
    } else if (msg.t === "comment:changed" && msg.resourceId === resourceId) {
      // 删除/审核导致结构变化：增量端点无法表达，重拉当前页
      onReloadRef.current();
    }
  });

  // 兜底轮询：WS 在线时放长（补漏），连不上时保持原有节奏
  useEffect(() => {
    const timer = setInterval(
      () => pollRef.current?.(),
      connected ? FALLBACK_POLL_MS : DEGRADED_POLL_MS,
    );
    return () => clearInterval(timer);
  }, [connected]);

  // 刚连上实时通道时补拉一次：订阅生效前发生的评论不会被推送，靠这一下补齐
  useEffect(() => {
    if (connected) pollRef.current?.();
  }, [connected]);
}

/** 滚动到目标评论并闪烁（原生平滑滚动 + 重触发动画）；目标不存在时返回 false */
export function flashComment(el: HTMLElement) {
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("comment-flash");
  void el.offsetWidth;
  el.classList.add("comment-flash");
}
