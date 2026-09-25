"use client";

// 正文图片查看器容器：把容器内所有「可缩放图片」（Markdown 渲染出的 [data-zoomable] 触发器）
// 统一交给全站 ImageViewer 打开，并支持在正文多张图之间前后切换。
//
// 为什么是「容器级事件委托 + 服务端 <img>」而不是「逐图客户端组件」：
// 图片数量与位置由作者内容决定，逐图挂 state 会把每个 <img> 都变成客户端边界；
// 委托只在正文外层保留一个客户端组件，图片本身仍是纯服务端渲染的 <img>。
//
// 为什么用捕获阶段（onClickCapture）：Markdown 允许 [![alt](img)](url) 这种「图片即链接」，
// 捕获阶段先于内层 next/link 的 onClick 执行，在这里吞掉事件即可让「点图片 = 开查看器」，
// 同时不影响链接文字自身的正常跳转。
import { useRef, useState, type MouseEvent, type ReactNode } from "react";
import ImageViewer, { type ViewerImage } from "@/components/ui/ImageViewer";

/** 可缩放图片的触发器选择器（由 Markdown 的 img 渲染器打在包层按钮上） */
const TRIGGER = "[data-zoomable]";

/**
 * 包裹 Markdown 输出：点击其中的图片即用 ImageViewer 打开。
 * className 透传给承载正文排版的 <section>（如 "md-body md-body--lg"），
 * 因此本组件不会在正文外面多套一层 DOM、不影响 .md-body 的首尾外边距规则。
 */
export default function MarkdownImages({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const boxRef = useRef<HTMLElement>(null);
  // 关闭态用 null：空数组代表「已打开但没有图」，语义上不该出现
  const [images, setImages] = useState<ViewerImage[] | null>(null);
  const [index, setIndex] = useState(0);

  const open = (e: MouseEvent<HTMLElement>) => {
    const box = boxRef.current;
    const trigger = (e.target as Element).closest(TRIGGER);
    if (!box || !trigger || !box.contains(trigger)) return;
    const nodes = Array.from(box.querySelectorAll<HTMLImageElement>(`${TRIGGER} img`));
    const i = nodes.indexOf(trigger.querySelector("img") as HTMLImageElement);
    if (i < 0) return;
    // 图片本身可能是链接：这次点击只用于打开查看器，不跟随跳转
    e.preventDefault();
    e.stopPropagation();
    setImages(
      nodes.map((n) => ({
        url: n.currentSrc || n.src,
        // 未加载完时拿不到原始尺寸，交给查看器按容器自适应
        width: n.naturalWidth || null,
        height: n.naturalHeight || null,
      })),
    );
    setIndex(i);
  };

  return (
    <section ref={boxRef} className={className} onClickCapture={open}>
      {children}
      {images && images.length > 0 && (
        <ImageViewer
          images={images}
          index={index}
          onIndexChange={setIndex}
          onClose={() => setImages(null)}
        />
      )}
    </section>
  );
}
