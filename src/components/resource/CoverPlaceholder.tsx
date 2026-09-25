import { DEFAULT_COVER_URL } from "@/lib/default-cover";

/**
 * 无封面时的站点默认封面：由 Pixel Hub 暖白、赤陶橙、像素点阵视觉生成，
 * 铺满外层 aspect 框。保留这个组件名，避免卡片与列表的调用方分散默认封面逻辑。
 */
export default function CoverPlaceholder() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-neutral-100">
      {/* 默认封面是装饰性补位，卡片/列表旁边已有标题文本。 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={DEFAULT_COVER_URL}
        alt=""
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover"
      />
    </div>
  );
}
