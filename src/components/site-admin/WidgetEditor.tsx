"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { ContentType } from "@/lib/display";
import { INPUT, INPUT_SM, LABEL_STRONG } from "@/lib/ui/cls";
import { SIDEBAR_KIND_META, type SidebarWidget, type SidebarWidgetConfig } from "@/lib/site-config";
import { updateSidebarWidgetAction } from "@/lib/actions/site";
import AdConfigFields, { initAdConfig } from "@/components/admin-shared/ad-config-fields";
import ChipPicker from "@/components/ui/ChipPicker";
import type { SiteCategories, SiteTags } from "./shared";

// 可编辑行（公告/链接）的稳定 key：模块级自增序号，行内增删改时保持 DOM 复用、避免输入焦点错位
let rowKeySeq = 0;
const nextRowKey = () => `row-${++rowKeySeq}`;

/** 侧栏组件内联编辑：按 kind 渲染对应配置字段，保存调用 updateSidebarWidgetAction */
export default function WidgetEditor({
  widget,
  categories,
  tags,
  onDone,
}: {
  widget: SidebarWidget;
  categories: SiteCategories;
  tags: SiteTags;
  onDone: () => void;
}) {
  const kind = widget.kind;
  const cfg = widget.config as Record<string, unknown>;
  const id = (k: string) => `${k}-${widget.id}`;
  const [title, setTitle] = useState(widget.title ?? "");
  const [type, setType] = useState<"ALL" | ContentType>(
    cfg.type === "IMAGE" || cfg.type === "GAME" || cfg.type === "ARTICLE" ? cfg.type : "ALL",
  );
  const [sort, setSort] = useState<"latest" | "popular" | "downloads">(
    cfg.sort === "latest" || cfg.sort === "downloads" ? cfg.sort : "popular",
  );
  const [count, setCount] = useState<number>(
    typeof cfg.count === "number"
      ? cfg.count
      : kind === "creators"
        ? 3
        : kind === "comments"
          ? 5
          : kind === "random" || kind === "authorWorks" || kind === "sameCategory"
            ? 4
            : 6,
  );
  const [display, setDisplay] = useState<"card" | "list" | "masonry">(
    cfg.display === "card" || cfg.display === "masonry" ? cfg.display : "list",
  );
  const [cats, setCats] = useState<string[]>((cfg.slugs as string[]) ?? []);
  const [text, setText] = useState<string>(typeof cfg.text === "string" ? cfg.text : "");
  const [content, setContent] = useState<string>(
    typeof cfg.content === "string" ? cfg.content : "",
  );
  const [links, setLinks] = useState<{ key: string; label: string; href: string }[]>(
    Array.isArray(cfg.links)
      ? (cfg.links as unknown[]).map((l) => {
          const o = (l && typeof l === "object" ? l : {}) as Record<string, unknown>;
          return {
            key: nextRowKey(),
            label: typeof o.label === "string" ? o.label : "",
            href: typeof o.href === "string" ? o.href : "",
          };
        })
      : [],
  );
  const [notices, setNotices] = useState<{ key: string; level: string; text: string }[]>(
    Array.isArray(cfg.items)
      ? (cfg.items as unknown[]).map((l) => {
          const o = (l && typeof l === "object" ? l : {}) as Record<string, unknown>;
          return {
            key: nextRowKey(),
            level:
              typeof o.level === "string" && ["info", "warn", "event"].includes(o.level)
                ? o.level
                : "info",
            text: typeof o.text === "string" ? o.text : "",
          };
        })
      : [],
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // 广告位（共享编辑字段）
  const [ad, setAd] = useState(() => initAdConfig(cfg));

  const setLink = (i: number, key: "label" | "href", v: string) =>
    setLinks((arr) => arr.map((l, idx) => (idx === i ? { ...l, [key]: v } : l)));
  const setNotice = (i: number, key: "level" | "text", v: string) =>
    setNotices((arr) => arr.map((n, idx) => (idx === i ? { ...n, [key]: v } : n)));

  function buildConfig(): SidebarWidgetConfig {
    switch (kind) {
      case "hot":
        return { type, sort, count, display };
      case "categories":
        return { slugs: cats };
      case "tags":
        return { count, slugs: cats };
      case "creators":
        return { count };
      case "stats":
        return {};
      case "about":
        return { text };
      case "comments":
        return { count };
      case "random":
        return { count };
      case "authorWorks":
        return { count };
      case "sameCategory":
        return { count };
      case "ad":
        return { ...ad, image: ad.image.trim(), link: ad.link.trim(), alt: ad.alt.trim() };
      case "notice":
        // 提交前剔除空行；level 白名单校验（坏值兜底 info）
        return {
          items: notices
            .map((n) => ({
              level: (["info", "warn", "event"] as string[]).includes(n.level) ? n.level : "info",
              text: n.text.trim().slice(0, 200),
            }))
            .filter((n) => n.text)
            .slice(0, 10) as { level: "info" | "warn" | "event"; text: string }[],
        };
      case "custom":
        // 提交前剔除空行（content 可为空 → 纯链接卡片；全空则保存后不渲染）
        return {
          content,
          links: links
            .map((l) => ({ label: l.label.trim(), href: l.href.trim() }))
            .filter((l) => l.label && l.href)
            .slice(0, 20),
        };
    }
  }

  function save() {
    start(async () => {
      const r = await updateSidebarWidgetAction({
        id: widget.id,
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

  return (
    <div className="rounded-none border border-brand-200 bg-neutral-50/60 p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={LABEL_STRONG} htmlFor={id("title")}>
            组件标题（留空用默认）
          </label>
          <input
            id={id("title")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={80}
            placeholder={SIDEBAR_KIND_META[kind].defaultTitle ?? "标题…"}
            className={INPUT}
          />
        </div>

        {kind === "hot" && (
          <>
            <div>
              <label className={LABEL_STRONG} htmlFor={id("type")}>
                内容类型
              </label>
              <select
                id={id("type")}
                value={type}
                onChange={(e) => setType(e.target.value as "ALL" | ContentType)}
                className={INPUT}
              >
                <option value="ALL">全部</option>
                <option value="IMAGE">图片作品</option>
                <option value="GAME">游戏</option>
                <option value="ARTICLE">文章</option>
              </select>
            </div>
            <div>
              <label className={LABEL_STRONG} htmlFor={id("sort")}>
                排序
              </label>
              <select
                id={id("sort")}
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
                className={INPUT}
              >
                <option value="popular">最热</option>
                <option value="latest">最新</option>
                <option value="downloads">最多下载</option>
              </select>
            </div>
            <div>
              <label className={LABEL_STRONG} htmlFor={id("count")}>
                数量（3–12）
              </label>
              <input
                id={id("count")}
                type="number"
                min={3}
                max={12}
                value={count}
                onChange={(e) => setCount(Math.max(3, Math.min(12, Number(e.target.value) || 3)))}
                className={INPUT}
              />
            </div>
            <div>
              <label className={LABEL_STRONG} htmlFor={id("display")}>
                显示形态
              </label>
              <select
                id={id("display")}
                value={display}
                onChange={(e) => setDisplay(e.target.value as typeof display)}
                className={INPUT}
              >
                <option value="list">列表行</option>
                <option value="card">小卡片</option>
                <option value="masonry">小瀑布</option>
              </select>
            </div>
          </>
        )}

        {(kind === "categories" || kind === "tags") && (
          <>
            <div className="sm:col-span-2">
              {kind === "categories" ? (
                <ChipPicker
                  label="挑选要展示的分类（可多选；不选则全部）"
                  options={categories.map((c) => ({ key: c.slug, label: c.name }))}
                  selected={cats}
                  onChange={setCats}
                  empty="该类下暂无分类"
                />
              ) : (
                <ChipPicker
                  label="挑选要展示的标签（可多选；不选则按热度）"
                  options={tags.map((t) => ({ key: t.slug, label: t.name }))}
                  selected={cats}
                  onChange={setCats}
                  empty="暂无标签"
                />
              )}
            </div>
            {kind === "tags" && (
              <div className="sm:col-span-2">
                <label className={LABEL_STRONG} htmlFor={id("count")}>
                  未挑选时按热度的数量（4–24）
                </label>
                <input
                  id={id("count")}
                  type="number"
                  min={4}
                  max={24}
                  value={count}
                  onChange={(e) => setCount(Math.max(4, Math.min(24, Number(e.target.value) || 4)))}
                  className={INPUT}
                />
              </div>
            )}
          </>
        )}

        {kind === "creators" && (
          <div>
            <label className={LABEL_STRONG} htmlFor={id("count")}>
              数量（1–6）
            </label>
            <input
              id={id("count")}
              type="number"
              min={1}
              max={6}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(6, Number(e.target.value) || 1)))}
              className={INPUT}
            />
          </div>
        )}

        {kind === "about" && (
          <div className="sm:col-span-2">
            <label className={LABEL_STRONG} htmlFor={id("text")}>
              说明文字（支持换行；空则不显示）
            </label>
            <textarea
              id={id("text")}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              maxLength={600}
              className={`${INPUT} resize-y`}
              placeholder="一句话介绍站点/公告…"
            />
          </div>
        )}

        {kind === "comments" && (
          <div>
            <label className={LABEL_STRONG} htmlFor={id("count")}>
              展示条数（3–10）
            </label>
            <input
              id={id("count")}
              type="number"
              min={3}
              max={10}
              value={count}
              onChange={(e) => setCount(Math.max(3, Math.min(10, Number(e.target.value) || 3)))}
              className={INPUT}
            />
          </div>
        )}

        {kind === "random" && (
          <div>
            <label className={LABEL_STRONG} htmlFor={id("count")}>
              抽取数量（2–8）
            </label>
            <input
              id={id("count")}
              type="number"
              min={2}
              max={8}
              value={count}
              onChange={(e) => setCount(Math.max(2, Math.min(8, Number(e.target.value) || 2)))}
              className={INPUT}
            />
          </div>
        )}

        {(kind === "authorWorks" || kind === "sameCategory") && (
          <div className="sm:col-span-2">
            <label className={LABEL_STRONG} htmlFor={id("count")}>
              展示数量（2–8）
            </label>
            <input
              id={id("count")}
              type="number"
              min={2}
              max={8}
              value={count}
              onChange={(e) => setCount(Math.max(2, Math.min(8, Number(e.target.value) || 2)))}
              className={INPUT}
            />
            <p className="mt-1 text-[11px] text-neutral-400">
              仅详情页侧边栏生效（
              {kind === "authorWorks"
                ? "按热度展示当前作者的其它作品，自动排除本资源"
                : "同分类其它内容优先，不足补同类型热门，自动排除本资源"}
              ）。
            </p>
          </div>
        )}

        {kind === "notice" && (
          <div className="sm:col-span-2">
            <label className={LABEL_STRONG}>公告列表（最多 10 条；空内容不显示）</label>
            <div className="space-y-1.5">
              {notices.map((n, i) => (
                <div key={n.key} className="flex items-center gap-1.5">
                  <select
                    value={n.level}
                    onChange={(e) => setNotice(i, "level", e.target.value)}
                    className={`w-24 shrink-0 ${INPUT_SM}`}
                    aria-label={`公告 ${i + 1} 级别`}
                  >
                    <option value="info">普通</option>
                    <option value="warn">重要</option>
                    <option value="event">活动</option>
                  </select>
                  <input
                    value={n.text}
                    onChange={(e) => setNotice(i, "text", e.target.value.slice(0, 200))}
                    placeholder="公告内容…"
                    className={`min-w-0 flex-1 ${INPUT_SM}`}
                    aria-label={`公告 ${i + 1} 内容`}
                  />
                  <button
                    type="button"
                    onClick={() => setNotices((arr) => arr.filter((_, idx) => idx !== i))}
                    aria-label="删除该公告"
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-none text-neutral-400 transition hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            {notices.length < 10 && (
              <button
                type="button"
                onClick={() =>
                  setNotices((arr) => [...arr, { key: nextRowKey(), level: "info", text: "" }])
                }
                className="mt-1.5 inline-flex items-center gap-1 rounded-none border border-brand-200 px-2.5 py-1 text-xs text-neutral-500 transition hover:border-brand-400 hover:text-brand-700"
              >
                <Plus size={12} /> 添加公告
              </button>
            )}
          </div>
        )}

        {kind === "custom" && (
          <>
            <div className="sm:col-span-2">
              <label className={LABEL_STRONG} htmlFor={id("content")}>
                内容（Markdown）
              </label>
              <textarea
                id={id("content")}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={8}
                maxLength={8000}
                className={`${INPUT} resize-y font-mono text-xs leading-relaxed`}
                placeholder={"## 公告\n\n任意 markdown…\n\n- 要点一\n- 要点二"}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={LABEL_STRONG}>链接列表（选填）</label>
              <div className="space-y-1.5">
                {links.map((l, i) => (
                  <div key={l.key} className="flex items-center gap-1.5">
                    <input
                      value={l.label}
                      onChange={(e) => setLink(i, "label", e.target.value.slice(0, 60))}
                      placeholder="链接文字"
                      className={`w-40 shrink-0 ${INPUT_SM}`}
                      aria-label={`链接 ${i + 1} 文字`}
                    />
                    <input
                      value={l.href}
                      onChange={(e) => setLink(i, "href", e.target.value.slice(0, 300))}
                      placeholder="/路径 或 https://外链"
                      className={`min-w-0 flex-1 ${INPUT_SM}`}
                      aria-label={`链接 ${i + 1} 地址`}
                    />
                    <button
                      type="button"
                      onClick={() => setLinks((arr) => arr.filter((_, idx) => idx !== i))}
                      aria-label="删除该链接"
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-none text-neutral-400 transition hover:bg-red-50 hover:text-red-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
              {links.length < 20 && (
                <button
                  type="button"
                  onClick={() =>
                    setLinks((arr) => [...arr, { key: nextRowKey(), label: "", href: "" }])
                  }
                  className="mt-1.5 inline-flex items-center gap-1 rounded-none border border-brand-200 px-2.5 py-1 text-xs text-neutral-500 transition hover:border-brand-400 hover:text-brand-700"
                >
                  <Plus size={12} /> 添加链接
                </button>
              )}
            </div>
          </>
        )}

        {kind === "ad" && <AdConfigFields idPrefix={id("ad")} value={ad} onChange={setAd} />}

        {kind === "stats" && (
          <p className="text-xs text-neutral-400">
            自动读取：上架内容 / 注册用户 / 累计下载 / 累计浏览，无需配置。
          </p>
        )}
      </div>

      {msg && <p className="mt-2 text-xs text-red-500">{msg}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded-none px-3 py-1.5 text-xs text-neutral-500 hover:bg-neutral-200"
        >
          取消
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="rounded-none border border-brand-600 bg-brand-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {pending ? "保存中…" : "保存组件"}
        </button>
      </div>
    </div>
  );
}
