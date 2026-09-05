import { Image as ImageIcon } from "lucide-react";

/**
 * 无封面占位：暖底 + 点阵纹理（与 body 同款 8px 网格）+ 居中线条图标，
 * 铺满外层 aspect 框。纹理类 .placeholder-dots 在 globals.css（暗色模式自动跟随色板变量）。
 */
export default function CoverPlaceholder({ iconSize = 24 }: { iconSize?: number }) {
  return (
    <div className="placeholder-dots absolute inset-0 grid place-items-center text-brand-300">
      <ImageIcon size={iconSize} strokeWidth={1.5} aria-hidden />
    </div>
  );
}
