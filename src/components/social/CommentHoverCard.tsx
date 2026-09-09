"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";

export type HoverCardData = {
  // 卡片锚点：被引用评论（可能不可见，仅用于兜底文案）
  id: string;
  content: string;
  author: string;
};

/**
 * 评论引用 hover 卡片：浮层展示被回复的评论内容。
 * 目标评论 DOM 需带 data-comment-id；若目标不在视口/不存在，则改为
 * 锚定父楼层（data-root-comment-id）并高亮其位置。
 */
export default function CommentHoverCard({
  data,
  rootId,
  onNavigate,
}: {
  data: HoverCardData;
  // 目标不可见时回退锚定的根楼层 id
  rootId: string;
  // 点击卡片跳转（滚动 + 闪烁高亮）
  onNavigate: (commentId: string, fallbackRootId: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [style, setStyle] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // 打开时测量目标位置：读 DOM 后再置 visible，setState 在事件回调链里而非 effect 体内
  const open = () => {
    // 定位：优先视口内的目标评论；不可见则取根楼层
    const target =
      document.querySelector<HTMLElement>(`[data-comment-id="${data.id}"]`) ??
      document.querySelector<HTMLElement>(`[data-comment-id="${rootId}"]`);
    if (target) {
      const rect = target.getBoundingClientRect();
      setStyle({ top: rect.bottom + 8, left: Math.max(12, rect.left) });
    }
    setVisible(true);
  };

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(open, 300);
      }}
      onMouseLeave={() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        setVisible(false);
      }}
    >
      <Button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onNavigate(data.id, rootId);
        }}
        onFocus={open}
        onBlur={() => setVisible(false)}
        className="cursor-pointer underline decoration-neutral-300 underline-offset-2 hover:text-neutral-700"
        aria-label={`跳转到 ${data.author} 的评论`}
      >
        @{data.author}
      </Button>
      {visible && style && (
        <span
          role="tooltip"
          className="absolute top-full left-0 z-40 mt-2 w-64 max-w-[80vw] cursor-pointer rounded-none border border-brand-200 bg-surface p-3 text-left shadow-lg"
          onClick={(e) => {
            e.stopPropagation();
            onNavigate(data.id, rootId);
          }}
        >
          <span className="block text-xs font-medium text-neutral-800">{data.author}</span>
          <span className="mt-1 block line-clamp-3 text-xs leading-5 text-neutral-600">
            {data.content}
          </span>
        </span>
      )}
    </span>
  );
}
