"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { HOME_KIND_META } from "@/lib/home-config";
import { updateHomeSectionAction } from "@/lib/actions/home";
import { CARD_RATIO_KEYS, CARD_RATIOS, DISPLAY_META, DISPLAY_OPTIONS } from "@/lib/display";
import type { CardRatio, ContentType } from "@/lib/display";
import { INPUT, LABEL_STRONG } from "@/lib/ui/cls";
import { SquareCheckbox } from "../admin/SquareCheckbox";
import type { HomeSectionConfig, HomeSectionKind } from "@/lib/home-config";
import AdConfigFields, { initAdConfig } from "@/components/admin-shared/ad-config-fields";
import ChipPicker from "@/components/ui/ChipPicker";
import HeroPick from "./hero-pick";
import { Button } from "@/components/ui/Button";

export type ManagerRow = {
  id: string;
  kind: HomeSectionKind;
  title: string | null;
  order: number;
  enabled: boolean;
  /** 设备端可见性：all / pc / mobile */
  visibleOn?: "all" | "pc" | "mobile";
  /** 是否仅登录用户可见 */
  requireAuth?: boolean;
  config: HomeSectionConfig;
};

export type HeroPickMeta = { id: string; title: string; slug: string };
export type PickOptionCat = { slug: string; name: string };
export type PickOptionTag = { slug: string; name: string };

const input = INPUT;
const field = LABEL_STRONG;

type TypeFilter = "ALL" | ContentType;
type SortKey = "latest" | "popular" | "downloads";
type Display = "card" | "list";

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
    (cfg.type as TypeFilter) === "IMAGE" ||
      (cfg.type as TypeFilter) === "GAME" ||
      (cfg.type as TypeFilter) === "ARTICLE"
      ? (cfg.type as TypeFilter)
      : "ALL",
  );
  const [sort, setSort] = useState<SortKey>(
    (cfg.sort as SortKey) === "latest" || (cfg.sort as SortKey) === "downloads"
      ? (cfg.sort as SortKey)
      : "popular",
  );
  const [showTags, setShowTags] = useState(cfg.showTags === true);
  const [count, setCount] = useState(
    typeof cfg.count === "number" ? cfg.count : kind === "creators" ? 6 : kind === "list" ? 12 : 12,
  );
  const [cats, setCats] = useState<string[]>(
    kind === "categories" ? strArr(cfg.slugs) : kind === "list" ? strArr(cfg.categorySlugs) : [],
  );
  const [tagSel, setTagSel] = useState<string[]>(
    kind === "tags" ? strArr(cfg.slugs) : kind === "list" ? strArr(cfg.tagSlugs) : [],
  );
  const [display, setDisplay] = useState<Display>(cfg.display === "list" ? "list" : "card");
  const [ratio, setRatio] = useState<CardRatio>(
    (CARD_RATIO_KEYS as string[]).includes(String(cfg.ratio)) ? (cfg.ratio as CardRatio) : "auto",
  );
  const [paged, setPaged] = useState(kind === "list" && cfg.paged === true);
  // 可见性：设备端 + 是否仅登录
  const [visOn, setVisOn] = useState<"all" | "pc" | "mobile">(
    row.visibleOn === "pc" || row.visibleOn === "mobile" ? row.visibleOn : "all",
  );
  const [reqAuth, setReqAuth] = useState(row.requireAuth === true);
  // 为你推荐：个性化 / 全站热门
  const [scope, setScope] = useState<"personal" | "all">(
    cfg.scope === "all" ? "all" : "personal",
  );
  // 为你推荐：精准推荐 / 随机探索（每次刷新换一批）
  const [mode, setMode] = useState<"personalized" | "explore">(
    cfg.mode === "explore" ? "explore" : "personalized",
  );
  // 为你推荐：探索占比（打破信息茧房）
  const [explorationRatio, setExplorationRatio] = useState(
    typeof cfg.explorationRatio === "number" ? cfg.explorationRatio : 0.3,
  );
  // 为你推荐：最少覆盖分类数（0 = 自动）
  const [minCategories, setMinCategories] = useState(
    typeof cfg.minCategories === "number" ? cfg.minCategories : 0,
  );
  // 为你推荐：热度时间窗口（全部时间 / 近 7 天 / 近 30 天）
  const [period, setPeriod] = useState<"all" | "week" | "month">(
    cfg.period === "week" || cfg.period === "month" ? cfg.period : "all",
  );
  // 广告位（共享编辑字段，草稿见 admin-shared/ad-config-fields）
  const [ad, setAd] = useState(() => initAdConfig(cfg));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function setTypeWithFilter(v: TypeFilter) {
    setType(v);
  }

  function buildConfig(): HomeSectionConfig {
    switch (kind) {
      case "hero":
        return { featuredIds: picked.map((p) => p.id), period };
      case "categories":
        return { slugs: cats };
      case "list":
        return {
          type,
          sort,
          count,
          categorySlugs: cats,
          tagSlugs: tagSel,
          display,
          paged,
          ratio,
          period,
        };
      case "featured":
        return { featuredIds: picked.map((p) => p.id), display, ratio, period };
      case "feed":
        return { showTags };
      case "creators":
        return { count };
      case "tags":
        return { count, slugs: tagSel };
      case "stats":
        return {};
      case "recommend":
        return { scope, mode, type, count, categorySlugs: cats, explorationRatio, minCategories, period };
      case "ad":
        return { ...ad, image: ad.image.trim(), link: ad.link.trim(), alt: ad.alt.trim() };
    }
  }

  function save() {
    start(async () => {
      const r = await updateHomeSectionAction({
        id: row.id,
        title: title.trim() ? title.trim().slice(0, 80) : null,
        visibleOn: visOn,
        requireAuth: reqAuth,
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
        <Button
          type="button"
          onClick={onDone}
          aria-label="关闭编辑"
          className="rounded-none p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700"
        >
          <X size={15} />
        </Button>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
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

        {/* 可见性：设备端 + 登录要求 */}
        <div className="sm:col-span-2 grid gap-4 sm:grid-cols-2">
          <div>
            <label className={field} htmlFor={`vo-${row.id}`}>
              设备端可见
            </label>
            <select
              id={`vo-${row.id}`}
              value={visOn}
              onChange={(e) => setVisOn(e.target.value as "all" | "pc" | "mobile")}
              className={input}
            >
              <option value="all">全部设备</option>
              <option value="pc">仅电脑端</option>
              <option value="mobile">仅移动端</option>
            </select>
          </div>
          <div>
            <label className={`${field} flex items-center gap-2`}>
              <SquareCheckbox checked={reqAuth} onChange={(next) => setReqAuth(next)} ariaLabel="仅登录用户可见" />
              仅登录用户可见
            </label>
            <p className="mt-1 text-[11px] text-neutral-400">
              开启后未登录访客看不到此板块；设备端限制用响应式类实现。
            </p>
          </div>
        </div>

        {(kind === "list" || kind === "recommend") && (
          <div>
            <label className={field} htmlFor={`ty-${row.id}`}>
              内容大类
            </label>
            <select
              id={`ty-${row.id}`}
              value={type}
              onChange={(e) => setTypeWithFilter(e.target.value as TypeFilter)}
              className={input}
            >
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
              <label className={field} htmlFor={`so-${row.id}`}>
                排序
              </label>
              <select
                id={`so-${row.id}`}
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className={input}
              >
                <option value="latest">最新上架</option>
                <option value="popular">最热</option>
                <option value="downloads">最多下载</option>
              </select>
            </div>
            <div>
              <label className={field} htmlFor={`pr-${row.id}`}>
                热度时间窗口
              </label>
              <select
                id={`pr-${row.id}`}
                value={period}
                onChange={(e) => setPeriod(e.target.value as "all" | "week" | "month")}
                className={input}
              >
                <option value="all">全部时间（累计热门）</option>
                <option value="week">近 7 天</option>
                <option value="month">近 30 天</option>
              </select>
              <p className="mt-1 text-[11px] text-neutral-400">
                仅「最热 / 最多下载」排序时生效；限定为近期发布的内容。
              </p>
            </div>
            <div>
              <label className={field} htmlFor={`n-${row.id}`}>
                每页展示数量（1–48）
              </label>
              <input
                id={`n-${row.id}`}
                type="number"
                min={1}
                max={48}
                value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(48, Number(e.target.value) || 1)))}
                className={input}
              />
              <p className="mt-1 text-[11px] text-neutral-400">
                首屏数量；开启翻页后即每页条数
              </p>
            </div>
          </>
        )}

        {kind === "list" && (
          <div className="sm:col-span-2">
            <label className={`${field} flex items-center gap-2`}>
              <SquareCheckbox checked={paged} onChange={(next) => setPaged(next)} ariaLabel="允许翻页" />
              允许「下一页」翻页（点按钮按相同条件加载后续页）
            </label>
            <p className="text-[11px] text-neutral-400">
              关闭时仅显示首屏；内容多建议开启。
            </p>
          </div>
        )}

        {(kind === "list" || kind === "featured") && (
          <div>
            <label className={field} htmlFor={`d-${row.id}`}>
              显示形态
            </label>
            <select
              id={`d-${row.id}`}
              value={display}
              onChange={(e) => setDisplay(e.target.value as Display)}
              className={input}
            >
              {DISPLAY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-neutral-400">{DISPLAY_META[display].hint}</p>
          </div>
        )}

        {(kind === "list" || kind === "featured") && display !== "list" && (
          <div>
            <label className={field} htmlFor={`r-${row.id}`}>
              卡片比例
            </label>
            <select
              id={`r-${row.id}`}
              value={ratio}
              onChange={(e) => setRatio(e.target.value as CardRatio)}
              className={input}
            >
              {CARD_RATIO_KEYS.map((k) => (
                <option key={k} value={k}>
                  {CARD_RATIOS[k].label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-neutral-400">
              {ratio === "auto"
                ? "沿用默认 3:4 竖版封面"
                : `卡片统一裁剪为 ${CARD_RATIOS[ratio].label} 网格`}
            </p>
          </div>
        )}

        {kind === "recommend" && (
          <>
            <div>
              <label className={field} htmlFor={`sc-${row.id}`}>
                推荐范围
              </label>
              <select
                id={`sc-${row.id}`}
                value={scope}
                onChange={(e) => setScope(e.target.value as "personal" | "all")}
                className={input}
              >
                <option value="personal">个性化（按登录用户偏好）</option>
                <option value="all">全站热门（游客也适用）</option>
              </select>
              <p className="mt-1 text-[11px] text-neutral-400">
                登录用户走个性化；游客或无偏好信号时自动回退热门。
              </p>
            </div>
            <div>
              <label className={field} htmlFor={`md-${row.id}`}>
                推荐模式
              </label>
              <select
                id={`md-${row.id}`}
                value={mode}
                onChange={(e) => setMode(e.target.value as "personalized" | "explore")}
                className={input}
              >
                <option value="personalized">精准推荐（画像排序）</option>
                <option value="explore">随机探索（每次刷新换一批）</option>
              </select>
              <p className="mt-1 text-[11px] text-neutral-400">
                随机探索不依赖画像，按质量+新颖度抽样并洗牌，每次刷新结果不同，用来破圈。
              </p>
            </div>
            <div>
              <label className={field} htmlFor={`n-${row.id}`}>
                展示数量（1–48）
              </label>
              <input
                id={`n-${row.id}`}
                type="number"
                min={1}
                max={48}
                value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(48, Number(e.target.value) || 1)))}
                className={input}
              />
            </div>
            <div>
              <label className={field} htmlFor={`er-${row.id}`}>
                探索占比（打破信息茧房，0–0.6）
              </label>
              <input
                id={`er-${row.id}`}
                type="number"
                min={0}
                max={0.6}
                step={0.05}
                value={explorationRatio}
                onChange={(e) =>
                  setExplorationRatio(
                    Math.max(0, Math.min(0.6, Number(e.target.value) || 0)),
                  )
                }
                className={input}
              />
              <p className="mt-1 text-[11px] text-neutral-400">
                将部分槽位留给「你很少接触」的优质/新内容，避免越推越窄。冷启动会自动调高。
              </p>
            </div>
            <div>
              <label className={field} htmlFor={`mc-${row.id}`}>
                最少分类覆盖（0 = 自动）
              </label>
              <input
                id={`mc-${row.id}`}
                type="number"
                min={0}
                max={12}
                value={minCategories}
                onChange={(e) =>
                  setMinCategories(Math.max(0, Math.min(12, Number(e.target.value) || 0)))
                }
                className={input}
              />
              <p className="mt-1 text-[11px] text-neutral-400">
                最终列表至少覆盖的不同分类数，进一步防止整页同质。
              </p>
            </div>
            <div>
              <label className={field} htmlFor={`pr-${row.id}`}>
                热度时间窗口
              </label>
              <select
                id={`pr-${row.id}`}
                value={period}
                onChange={(e) => setPeriod(e.target.value as "all" | "week" | "month")}
                className={input}
              >
                <option value="all">全部时间（累计热门）</option>
                <option value="week">近 7 天</option>
                <option value="month">近 30 天</option>
              </select>
              <p className="mt-1 text-[11px] text-neutral-400">
                限定候选/热门池为近期发布的内容，实现「近期热门推荐」。
              </p>
            </div>
          </>
        )}

        {(kind === "list" || kind === "recommend") && (
          <>
            <div className="sm:col-span-2">
              <ChipPicker
                label={
                  kind === "recommend"
                    ? "限定分类（可多选；不选 = 不限）"
                    : "挑分类（可多选；不选 = 不限）"
                }
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

        {kind === "tags" && (
          <>
            <div>
              <label className={field} htmlFor={`n-${row.id}`}>
                未挑选时的热度数量（1–24）
              </label>
              <input
                id={`n-${row.id}`}
                type="number"
                min={1}
                max={24}
                value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(24, Number(e.target.value) || 1)))}
                className={input}
              />
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

        {kind === "feed" && (
          <div>
            <label className={`${field} flex items-center gap-2`}>
              <SquareCheckbox checked={showTags} onChange={(next) => setShowTags(next)} ariaLabel="显示热门标签行" />
              顶部显示热门标签行
            </label>
            <p className="text-xs text-neutral-400">
              与「浏览」页一致；也可单独加「热门标签」板块。
            </p>
          </div>
        )}

        {kind === "creators" ? (
          <div>
            <label className={field} htmlFor={`n-${row.id}`}>
              展示数量（1–12）
            </label>
            <input
              id={`n-${row.id}`}
              type="number"
              min={1}
              max={12}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
              className={input}
            />
          </div>
        ) : null}

        {(kind === "hero" || kind === "featured") && (
          <>
            <div className="sm:col-span-2">
              <HeroPick
                value={picked}
                onChange={setPicked}
                max={kind === "hero" ? 8 : 24}
                placeholder={kind === "featured" ? "搜索已上架资源标题，组成专题…" : undefined}
              />
              <p className="mt-1 text-xs text-neutral-400">
                {kind === "hero"
                  ? "挑选 1–8 个资源；不挑则自动展示近期最热，首图作主推、其余作副推。"
                  : "最多 24 个资源组成专题；不挑则自动兜底近期最热。"}
              </p>
            </div>
            <div>
              <label className={field} htmlFor={`pr-${row.id}`}>
                兜底热门时间窗口
              </label>
              <select
                id={`pr-${row.id}`}
                value={period}
                onChange={(e) => setPeriod(e.target.value as "all" | "week" | "month")}
                className={input}
              >
                <option value="all">全部时间（累计热门）</option>
                <option value="week">近 7 天</option>
                <option value="month">近 30 天</option>
              </select>
              <p className="mt-1 text-[11px] text-neutral-400">
                仅「未挑选资源」时生效，限定兜底热门为近期发布内容。
              </p>
            </div>
          </>
        )}

        {kind === "stats" && (
          <p className="text-xs text-neutral-400">
            自动读取：已上架内容 / 注册用户 / 累计下载 / 累计浏览。
          </p>
        )}

        {kind === "ad" && (
          <AdConfigFields
            idPrefix={`ad-${row.id}`}
            value={ad}
            onChange={setAd}
            emptyNote="未配置（无图、无代码）时该板块前台不显示。"
          />
        )}
      </div>

      {msg && <p className="mt-2 text-xs text-red-500">{msg}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <Button
          type="button"
          onClick={onDone}
          className="rounded-none px-3 py-1.5 text-xs text-neutral-500 hover:bg-neutral-200"
        >
          取消
        </Button>
        <Button
          type="button"
          disabled={pending}
          onClick={save}
          className="rounded-none border border-brand-600 bg-brand-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {pending ? "保存中…" : "保存板块"}
        </Button>
      </div>
    </div>
  );
}
