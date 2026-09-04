// 共享的展示目录：内容显示形态（卡片/列表/瀑布流）与内容大类，供首页板块、侧边栏 widget、归档等共用。
export type ContentDisplay = "card" | "list" | "masonry";
export type ContentType = "IMAGE" | "GAME" | "ARTICLE";

export const DISPLAY_ORDER: ContentDisplay[] = ["card", "list", "masonry"];

export const DISPLAY_META: Record<ContentDisplay, { label: string; hint: string }> = {
  card: { label: "卡片网格", hint: "等宽卡片、行列对齐，观感整齐" },
  list: { label: "列表行", hint: "横向缩略图 + 信息，适合信息密度高的侧栏/板块" },
  masonry: { label: "瀑布流", hint: "CSS 多列错落排布，保留图片原始比例" },
};

export const DISPLAY_OPTIONS: { value: ContentDisplay; label: string }[] = DISPLAY_ORDER.map(
  (d) => ({
    value: d,
    label: DISPLAY_META[d].label,
  }),
);

export const TYPE_LABEL: Record<string, string> = {
  GAME: "游戏",
  IMAGE: "图片作品",
  ARTICLE: "文章",
};

export type ContentTypeFilter = ContentType | "ALL";

// 卡片封面的裁剪比例（供卡片网格 / 可选比例的瀑布板块使用）
export type CardRatio = "auto" | "1:1" | "4:3" | "3:2" | "16:9" | "3:4";

export const CARD_RATIO_KEYS: CardRatio[] = ["auto", "1:1", "4:3", "3:2", "16:9", "3:4"];

export const CARD_RATIOS: Record<CardRatio, { label: string; aspect?: string }> = {
  auto: { label: "原图比例(自动)", aspect: undefined },
  "1:1": { label: "1:1 方图", aspect: "1 / 1" },
  "4:3": { label: "4:3", aspect: "4 / 3" },
  "3:2": { label: "3:2", aspect: "3 / 2" },
  "16:9": { label: "16:9 横幅", aspect: "16 / 9" },
  "3:4": { label: "3:4 竖图", aspect: "3 / 4" },
};

/**
 * 瀑布流封面比例限幅：宽高比 clamp 到 [3/4, 4/3]（竖图不拉长卡片、横图不超矮）。
 * 卡片渲染（ResourceCard）与列高估算（MasonryGrid）共用，保证两边一致。
 */
export function clampedAspect(w: number, h: number): number {
  return Math.min(Math.max(w / h, 3 / 4), 4 / 3);
}
