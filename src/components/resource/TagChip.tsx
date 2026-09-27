import Link from "next/link";

/**
 * 资源详情页的标签胶囊：全站唯一视觉来源。
 *
 * 底色走品牌陶土橙淡阶而不是中性灰 —— 详情页的元数据 chips（语言 / 平台 / 时长 / 分辨率）
 * 已经占了 `bg-neutral-100`，标签如果同色，读者分不出「可点的标签」和「只读的属性」。
 * 淡橙底 + 深橙字把可点击性显性化，hover 再深一档（brand-800 保底 4.5:1，brand-700 在
 * brand-200 上只有 4.1:1，不够）。
 */
export const TAG_CHIP_CLASS =
  "rounded-none bg-brand-100 px-2 py-1 text-xs text-brand-700 transition-colors hover:bg-brand-200 hover:text-brand-800";

export default function TagChip({
  slug,
  name,
  className,
}: {
  slug: string;
  name: string;
  /** 仅用于对齐各调用点的字号/字重（如 DetailPost 的 11px chips），勿改配色 */
  className?: string;
}) {
  return (
    <Link
      href={`/tags/${slug}`}
      className={className ? `${TAG_CHIP_CLASS} ${className}` : TAG_CHIP_CLASS}
    >
      #{name}
    </Link>
  );
}
