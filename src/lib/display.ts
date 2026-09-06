// 共享的展示目录：内容显示形态（卡片网格/列表行）与内容大类，供首页板块、侧边栏 widget、归档等共用。
export type ContentDisplay = "card" | "list";
export type ContentType = "IMAGE" | "GAME" | "ARTICLE";

export const DISPLAY_ORDER: ContentDisplay[] = ["card", "list"];

export const DISPLAY_META: Record<ContentDisplay, { label: string; hint: string }> = {
  card: { label: "卡片网格", hint: "等宽卡片、行列对齐，观感整齐" },
  list: { label: "列表行", hint: "横向缩略图 + 信息，适合信息密度高的侧栏/板块" },
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

// 卡片封面的裁剪比例（仅卡片网格形态使用）
export type CardRatio = "auto" | "1:1" | "4:3" | "3:2" | "16:9" | "3:4";

export const CARD_RATIO_KEYS: CardRatio[] = ["auto", "1:1", "4:3", "3:2", "16:9", "3:4"];

// 卡片默认封面比例（auto / 未给 ratio 时统一按 3:4 竖版裁切）
export const CARD_DEFAULT_ASPECT = "3 / 4";

export const CARD_RATIOS: Record<CardRatio, { label: string; aspect?: string }> = {
  auto: { label: "默认 3:4", aspect: CARD_DEFAULT_ASPECT },
  "1:1": { label: "1:1 方图", aspect: "1 / 1" },
  "4:3": { label: "4:3", aspect: "4 / 3" },
  "3:2": { label: "3:2", aspect: "3 / 2" },
  "16:9": { label: "16:9 横幅", aspect: "16 / 9" },
  "3:4": { label: "3:4 竖图", aspect: "3 / 4" },
};
