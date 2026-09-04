"use client";

import { INPUT, LABEL_STRONG } from "@/lib/ui/cls";

/** 广告位草稿配置：图片模式或 HTML 模式 + 角标开关（首页广告板块与侧栏 ad 组件共用） */
export type AdConfigDraft = {
  mode: "image" | "html";
  image: string;
  link: string;
  alt: string;
  html: string;
  badge: boolean;
};

/** 从持久化 config 里解析出编辑草稿（坏值兜底默认） */
export function initAdConfig(cfg: Record<string, unknown>): AdConfigDraft {
  return {
    mode: cfg.mode === "html" ? "html" : "image",
    image: typeof cfg.image === "string" ? cfg.image : "",
    link: typeof cfg.link === "string" ? cfg.link : "",
    alt: typeof cfg.alt === "string" ? cfg.alt : "",
    html: typeof cfg.html === "string" ? cfg.html : "",
    badge: cfg.badge !== false,
  };
}

/** 广告位编辑字段：form grid（sm:grid-cols-2）内的单元格集合，由调用方决定布局容器 */
export default function AdConfigFields({
  idPrefix,
  value,
  onChange,
  emptyNote,
}: {
  /** htmlFor/id 前缀，保证同页多实例不撞 id */
  idPrefix: string;
  value: AdConfigDraft;
  onChange: (next: AdConfigDraft) => void;
  /** 额外提示（如首页板块的“未配置时前台不显示”），渲染在字段末尾 */
  emptyNote?: string;
}) {
  const patch = (p: Partial<AdConfigDraft>) => onChange({ ...value, ...p });
  return (
    <>
      <div>
        <label className={LABEL_STRONG} htmlFor={`${idPrefix}-mode`}>
          形式
        </label>
        <select
          id={`${idPrefix}-mode`}
          value={value.mode}
          onChange={(e) => patch({ mode: e.target.value as "image" | "html" })}
          className={INPUT}
        >
          <option value="image">图片 + 链接</option>
          <option value="html">HTML / JS 代码</option>
        </select>
      </div>
      {value.mode === "image" ? (
        <>
          <div>
            <label className={LABEL_STRONG} htmlFor={`${idPrefix}-image`}>
              图片地址
            </label>
            <input
              id={`${idPrefix}-image`}
              value={value.image}
              onChange={(e) => patch({ image: e.target.value })}
              maxLength={2000}
              placeholder="/uploads/… 或 https://…"
              className={INPUT}
            />
          </div>
          <div>
            <label className={LABEL_STRONG} htmlFor={`${idPrefix}-link`}>
              跳转链接（可空 = 纯展示）
            </label>
            <input
              id={`${idPrefix}-link`}
              value={value.link}
              onChange={(e) => patch({ link: e.target.value })}
              maxLength={500}
              placeholder="https://…"
              className={INPUT}
            />
          </div>
          <div>
            <label className={LABEL_STRONG} htmlFor={`${idPrefix}-alt`}>
              图片替代文字
            </label>
            <input
              id={`${idPrefix}-alt`}
              value={value.alt}
              onChange={(e) => patch({ alt: e.target.value })}
              maxLength={120}
              className={INPUT}
            />
          </div>
        </>
      ) : (
        <div className="sm:col-span-2">
          <label className={LABEL_STRONG} htmlFor={`${idPrefix}-html`}>
            HTML / JS 代码（可接 AdSense 等联盟广告）
          </label>
          <textarea
            id={`${idPrefix}-html`}
            value={value.html}
            onChange={(e) => patch({ html: e.target.value })}
            rows={6}
            maxLength={8000}
            className={`${INPUT} resize-y font-mono text-xs leading-relaxed`}
            placeholder={
              '<a href="https://…"><img src="https://…/banner.png"/></a>\n或联盟广告代码片段…'
            }
          />
          <p className="mt-1 text-[11px] text-neutral-400">代码将原样注入页面，仅管理员可配置。</p>
        </div>
      )}
      {emptyNote && <p className="text-xs text-neutral-400 sm:col-span-2">{emptyNote}</p>}
      <div className="sm:col-span-2">
        <label className={`${LABEL_STRONG} flex items-center gap-2`}>
          <input
            type="checkbox"
            checked={value.badge}
            onChange={(e) => patch({ badge: e.target.checked })}
            className="h-4 w-4 accent-brand-500"
          />
          显示「广告」角标（右上角标识）
        </label>
        <p className="mt-1 text-[11px] text-neutral-400">
          按广告法惯例建议保留；关闭后前台将无任何广告标识。
        </p>
      </div>
    </>
  );
}
