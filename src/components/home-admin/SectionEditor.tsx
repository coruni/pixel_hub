"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { HOME_KIND_META } from "@/lib/home-config";
import { updateHomeSectionAction } from "@/lib/actions/home";
import { CARD_RATIO_KEYS, CARD_RATIOS, DISPLAY_META, DISPLAY_OPTIONS } from "@/lib/display";
import type { CardRatio, ContentType } from "@/lib/display";
import { INPUT, LABEL_STRONG } from "@/lib/ui/cls";
import type { HomeSectionConfig, HomeSectionKind } from "@/lib/home-config";
import AdConfigFields, { initAdConfig } from "@/components/admin-shared/ad-config-fields";
import ChipPicker from "@/components/ui/ChipPicker";
import HeroPick from "./hero-pick";

export type ManagerRow = {
 id: string;
 kind: HomeSectionKind;
 title: string | null;
 order: number;
 enabled: boolean;
 config: HomeSectionConfig;
};

export type HeroPickMeta = { id: string; title: string; slug: string };
export type PickOptionCat = { slug: string; name: string };
export type PickOptionTag = { slug: string; name: string };

const input = INPUT;
const field = LABEL_STRONG;

type TypeFilter = "ALL" | ContentType;
type SortKey = "latest" | "popular" | "downloads";
type Display = "card" | "list" | "masonry";

const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

export default function SectionEditor({
 row,
 picks,
 categories,
 tags,
 onDone,
}: {
 row: ManagerRow;
 picks: HeroPickMeta[];
 categories: PickOptionCat[];
 tags: PickOptionTag[];
 onDone: () => void;
}) {
 const kind = row.kind;
 const cfg = row.config as Record<string, unknown>;

 const [title, setTitle] = useState(row.title ?? "");
 const [picked, setPicked] = useState<HeroPickMeta[]>(picks);
 const [type, setType] = useState<TypeFilter>(
 (cfg.type as TypeFilter) === "IMAGE" || (cfg.type as TypeFilter) === "GAME" || (cfg.type as TypeFilter) === "ARTICLE" ? (cfg.type as TypeFilter) : "ALL"
 );
 const [sort, setSort] = useState<SortKey>(
 (cfg.sort as SortKey) === "latest" || (cfg.sort as SortKey) === "downloads" ? (cfg.sort as SortKey) : "popular"
 );
 const [showTags, setShowTags] = useState(cfg.showTags === true);
 const [count, setCount] = useState(
 typeof cfg.count === "number"
 ? cfg.count
 : kind === "creators"
 ? 6
 : kind === "list"
 ? 12
 : 12
 );
 const [cats, setCats] = useState<string[]>(
 kind === "categories" ? strArr(cfg.slugs) : kind === "list" ? strArr(cfg.categorySlugs) : []
 );
 const [tagSel, setTagSel] = useState<string[]>(
 kind === "tags" ? strArr(cfg.slugs) : kind === "list" ? strArr(cfg.tagSlugs) : []
 );
 const [display, setDisplay] = useState<Display>(
 cfg.display === "list" || cfg.display === "card" ? (cfg.display as Display) : kind === "featured" ? "card" : "masonry"
 );
 const [ratio, setRatio] = useState<CardRatio>(
 (CARD_RATIO_KEYS as string[]).includes(String(cfg.ratio)) ? (cfg.ratio as CardRatio) : "auto"
 );
 const [paged, setPaged] = useState(kind === "list" && cfg.paged === true);
 // 广告位（共享编辑字段，草稿见 admin-shared/ad-config-fields）
 const [ad, setAd] = useState(() => initAdConfig(cfg));
 const [pending, start] = useTransition();
 const [msg, setMsg] = useState<string | null>(null);

 // 大类变化时剔除不属于该类的已选分类，避免保存「看不见」的配置
 function setTypeWithFilter(v: TypeFilter) {
 setType(v);
 }

 function buildConfig(): HomeSectionConfig {
 switch (kind) {
 case "hero":
 return { featuredIds: picked.map((p) => p.id) };
 case "categories":
 return { slugs: cats };
 case "list":
 return { type, sort, count, categorySlugs: cats, tagSlugs: tagSel, display, paged, ratio };
 case "featured":
 return { featuredIds: picked.map((p) => p.id), display, ratio };
 case "feed":
 return { showTags };
 case "creators":
 return { count };
 case "tags":
 return { count, slugs: tagSel };
 case "stats":
 return {};
 case "ad":
 return { ...ad, image: ad.image.trim(), link: ad.link.trim(), alt: ad.alt.trim() };
 }
 }

 function save() {
 start(async () => {
 const r = await updateHomeSectionAction({
 id: row.id,
 title: title.trim() ? title.trim().slice(0, 80) : null,
 config: buildConfig(),
 });
 if (!r.ok) {
 setMsg(r.error ?? "保存失败");
 return;
 }
 onDone();
 });
 }

 const kindLabel = HOME_KIND_META[kind].label;

 return (
 <div className="mt-2 rounded-none border border-brand-200 bg-neutral-50/60 p-4 sm:p-5">
 <div className="flex items-center justify-between">
 <p className="text-sm font-semibold text-neutral-800">编辑 · {kindLabel}</p>
 <button type="button" onClick={onDone} aria-label="关闭编辑" className="rounded-none p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700">
 <X size={15} />
 </button>
 </div>

 <div className="mt-4 grid gap-4 sm:grid-cols-2">
 {/* 标题（通用） */}
 <div className="sm:col-span-2">
 <label className={field} htmlFor={`t-${row.id}`}>
 {kind === "hero"
 ? "大标语（可选，留空则不显示文字标题）"
 : kind === "ad"
 ? "备注名（仅后台列表标识，前台不显示）"
 : "板块标题（留空隐藏）"}
 </label>
 <input
 id={`t-${row.id}`}
 value={title}
 onChange={(e) => setTitle(e.target.value)}
 maxLength={80}
 placeholder={HOME_KIND_META[kind].defaultTitle ?? "给这个板块起个标题…"}
 className={input}
 />
 </div>

 {/* 通用：大类 / 排序 / 数量 / 显示形态 */}
 {kind === "list" && (
 <div>
 <label className={field} htmlFor={`ty-${row.id}`}>内容大类</label>
 <select id={`ty-${row.id}`} value={type} onChange={(e) => setTypeWithFilter(e.target.value as TypeFilter)} className={input}>
 <option value="ALL">全部（含通用）</option>
 <option value="IMAGE">仅图片作品</option>
 <option value="GAME">仅游戏</option>
 <option value="ARTICLE">仅文章</option>
 </select>
 </div>
 )}

 {kind === "list" && (
 <>
 <div>
 <label className={field} htmlFor={`so-${row.id}`}>排序</label>
 <select id={`so-${row.id}`} value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={input}>
 <option value="latest">最新上架</option>
 <option value="popular">最热</option>
 <option value="downloads">最多下载</option>
 </select>
 </div>
 <div>
 <label className={field} htmlFor={`n-${row.id}`}>每页展示数量（1–48）</label>
 <input id={`n-${row.id}`} type="number" min={1} max={48} value={count} onChange={(e) => setCount(Math.max(1, Math.min(48, Number(e.target.value) || 1)))} className={input} />
 <p className="mt-1 text-[11px] text-neutral-400">首屏展示数；开启下方翻页后即每页条数</p>
 </div>
 </>
 )}

 {kind === "list" && (
 <div className="sm:col-span-2">
 <label className={`${field} flex items-center gap-2`}>
 <input type="checkbox" checked={paged} onChange={(e) => setPaged(e.target.checked)} className="h-4 w-4 accent-brand-500" />
 允许「下一页」翻页（点按钮按相同条件加载后续页）
 </label>
 <p className="text-[11px] text-neutral-400">关闭时板块只显示首屏静态内容；内容很多时建议开启。</p>
 </div>
 )}

 {(kind === "list" || kind === "featured") && (
 <div>
 <label className={field} htmlFor={`d-${row.id}`}>显示形态</label>
 <select id={`d-${row.id}`} value={display} onChange={(e) => setDisplay(e.target.value as Display)} className={input}>
 {DISPLAY_OPTIONS.map((o) => (
 <option key={o.value} value={o.value}>
 {o.label}
 </option>
 ))}
 </select>
 <p className="mt-1 text-[11px] text-neutral-400">{DISPLAY_META[display].hint}</p>
 </div>
 )}

 {/* list/featured：卡片比例（列表行不适用；auto=卡片沿用 4:3、瀑布保留原图） */}
 {(kind === "list" || kind === "featured") && display !== "list" && (
 <div>
 <label className={field} htmlFor={`r-${row.id}`}>卡片比例</label>
 <select id={`r-${row.id}`} value={ratio} onChange={(e) => setRatio(e.target.value as CardRatio)} className={input}>
 {CARD_RATIO_KEYS.map((k) => (
 <option key={k} value={k}>
 {CARD_RATIOS[k].label}
 </option>
 ))}
 </select>
 <p className="mt-1 text-[11px] text-neutral-400">
 {ratio === "auto"
 ? display === "card"
 ? "卡片沿用默认 4:3 封面"
 : "瀑布流保留每张原图比例（错落）"
 : `所选比例下卡片统一裁剪，瀑布流会变为整齐的 ${CARD_RATIOS[ratio].label} 网格`}
 </p>
 </div>
 )}

 {/* list：分类/标签多选 */}
 {kind === "list" && (
 <>
 <div className="sm:col-span-2">
 <ChipPicker
 label="挑分类（可多选；不选 = 不限）"
 options={categories.map((c) => ({ key: c.slug, label: c.name }))}
 selected={cats}
 onChange={setCats}
 empty="该类下暂无分类"
 />
 </div>
 <div className="sm:col-span-2">
 <ChipPicker
 label="挑标签（可多选；任一命中即展示）"
 options={tags.map((t) => ({ key: t.slug, label: `#${t.name}` }))}
 selected={tagSel}
 onChange={setTagSel}
 empty="暂无标签"
 />
 </div>
 </>
 )}

 {/* categories：手动挑选分类（可选） */}
 {kind === "categories" && (
 <div className="sm:col-span-2">
 <ChipPicker
 label="挑分类（可多选；不选 = 该大类下的全部分类）"
 options={categories.map((c) => ({ key: c.slug, label: c.name }))}
 selected={cats}
 onChange={setCats}
 empty="该类下暂无分类"
 />
 </div>
 )}

 {/* tags：手动挑选标签（可选） */}
 {kind === "tags" && (
 <>
 <div>
 <label className={field} htmlFor={`n-${row.id}`}>未挑选时的热度数量（1–24）</label>
 <input id={`n-${row.id}`} type="number" min={1} max={24} value={count} onChange={(e) => setCount(Math.max(1, Math.min(24, Number(e.target.value) || 1)))} className={input} />
 </div>
 <div className="sm:col-span-2">
 <ChipPicker
 label="挑标签（可多选；不选 = 按热度取上方数量）"
 options={tags.map((t) => ({ key: t.slug, label: `#${t.name}` }))}
 selected={tagSel}
 onChange={setTagSel}
 empty="暂无标签"
 />
 </div>
 </>
 )}

 {/* 内容流（全站浏览）：顶部热门标签 */}
 {kind === "feed" && (
 <div>
 <label className={`${field} flex items-center gap-2`}>
 <input type="checkbox" checked={showTags} onChange={(e) => setShowTags(e.target.checked)} className="h-4 w-4 accent-brand-500" />
 顶部显示热门标签行
 </label>
 <p className="text-xs text-neutral-400">与「浏览」页一致；也可单独加一个“热门标签”板块置于下方</p>
 </div>
 )}

 {/* 人气创作者：数量 */}
 {kind === "creators" ? (
 <div>
 <label className={field} htmlFor={`n-${row.id}`}>展示数量（1–12）</label>
 <input id={`n-${row.id}`} type="number" min={1} max={12} value={count} onChange={(e) => setCount(Math.max(1, Math.min(12, Number(e.target.value) || 1)))} className={input} />
 </div>
 ) : null}

 {/* 主推 / 专题：手动挑选资源 */}
 {(kind === "hero" || kind === "featured") && (
 <div className="sm:col-span-2">
 <HeroPick
 value={picked}
 onChange={setPicked}
 max={kind === "hero" ? 8 : 24}
 placeholder={kind === "featured" ? "搜索已上架资源标题，组成专题…" : undefined}
 />
 <p className="mt-1 text-xs text-neutral-400">
 {kind === "hero"
 ? "可挑选 1–8 个已上架资源；不挑选时自动展示近期最热内容。挑选后第一张作为大图主推，其余作副推。"
 : "可挑选最多 24 个资源组成专题；不挑选时自动兜底近期最热内容。"}
 </p>
 </div>
 )}

 {/* 数据一览：无需配置 */}
 {kind === "stats" && <p className="text-xs text-neutral-400">自动读取：已上架内容 / 注册用户 / 累计下载 / 累计浏览。</p>}

 {/* 广告位：图片+链接 或 HTML/联盟代码（共享字段） */}
 {kind === "ad" && (
 <AdConfigFields idPrefix={`ad-${row.id}`} value={ad} onChange={setAd} emptyNote="未配置（无图、无代码）时该板块前台不显示。" />
 )}
 </div>

 {msg && <p className="mt-2 text-xs text-red-500">{msg}</p>}

 <div className="mt-4 flex justify-end gap-2">
 <button type="button" onClick={onDone} className="rounded-none px-3 py-1.5 text-xs text-neutral-500 hover:bg-neutral-200">
 取消
 </button>
 <button
 type="button"
 disabled={pending}
 onClick={save}
 className="rounded-none border border-brand-600 bg-brand-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
 >
 {pending ? "保存中…" : "保存板块"}
 </button>
 </div>
 </div>
 );
}
