"use client";

// SEO 配置表单：站长验证码 / OG 语言区域 / 默认描述 / 结构化数据开关。整体提交 + 乐观锁版本。
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateSeoConfigAction } from "@/lib/actions/seo";
import type { SeoConfig } from "@/lib/seo-config";
import { SquareCheckbox } from "@/components/admin/SquareCheckbox";
import { BTN_PRIMARY_SM, INPUT, LABEL_STRONG } from "@/lib/ui/cls";

const VERIFICATION_FIELDS: { key: keyof SeoConfig["verifications"]; label: string; hint: string }[] =
  [
    { key: "google", label: "Google 验证码", hint: "Google Search Console（google-site-verification）" },
    { key: "bing", label: "Bing 验证码", hint: "Bing 站长工具（msvalidate.01，同时覆盖 Yahoo 网页搜索）" },
    { key: "yandex", label: "Yandex 验证码", hint: "Yandex Webmaster（yandex-verification）" },
    { key: "baidu", label: "百度验证码", hint: "百度搜索资源平台（baidu-site-verification）" },
  ];

export default function SeoManager({
  config,
  version,
}: {
  config: SeoConfig;
  version: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [form, setForm] = useState({
    siteName: config.siteName,
    siteLogo: config.siteLogo,
    keywords: config.keywords,
    footerText: config.footerText,
    icp: config.icp,
    contactEmail: config.contactEmail,
    google: config.verifications.google,
    bing: config.verifications.bing,
    yandex: config.verifications.yandex,
    baidu: config.verifications.baidu,
    ogLocale: config.ogLocale,
    defaultDescription: config.defaultDescription,
    structuredData: config.structuredData,
  });

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const save = () =>
    start(async () => {
      setMessage(null);
      const result = await updateSeoConfigAction(
        {
          siteName: form.siteName,
          siteLogo: form.siteLogo,
          keywords: form.keywords,
          footerText: form.footerText,
          icp: form.icp,
          contactEmail: form.contactEmail,
          verifications: {
            google: form.google,
            bing: form.bing,
            yandex: form.yandex,
            baidu: form.baidu,
          },
          ogLocale: form.ogLocale,
          defaultDescription: form.defaultDescription,
          structuredData: form.structuredData,
        },
        version,
      );
      if (result.ok) {
        setMessage({ kind: "ok", text: "已保存，前台立即生效" });
        router.refresh();
      } else {
        setMessage({ kind: "error", text: result.error ?? "保存失败，请重试" });
      }
    });

  return (
    <div className="space-y-6">
      <section className="border border-brand-200 bg-surface p-5">
        <h3 className="text-sm font-semibold text-neutral-900">站点信息</h3>
        <p className="mt-1 text-xs text-neutral-400">
          站点名称用于 &lt;title&gt;、OG、结构化数据与导航徽标；留空回退环境变量 NEXT_PUBLIC_SITE_NAME。
        </p>
        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="seo-site-name" className={LABEL_STRONG}>
              网站名称
            </label>
            <input
              id="seo-site-name"
              value={form.siteName}
              onChange={(e) => set({ siteName: e.target.value })}
              className={INPUT}
              maxLength={40}
              placeholder="留空使用环境变量配置"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div>
            <label htmlFor="seo-site-logo" className={LABEL_STRONG}>
              站点 Logo
            </label>
            <input
              id="seo-site-logo"
              value={form.siteLogo}
              onChange={(e) => set({ siteLogo: e.target.value })}
              className={INPUT}
              maxLength={300}
              placeholder="留空使用环境变量配置或内置站点图标"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="mt-1 text-[10px] leading-4 text-neutral-400">
              导航栏徽标：填媒体库的 /uploads/… 地址或完整 http(s) URL。
            </p>
          </div>
          <div>
            <label htmlFor="seo-keywords" className={LABEL_STRONG}>
              meta 关键词
            </label>
            <textarea
              id="seo-keywords"
              value={form.keywords}
              onChange={(e) => set({ keywords: e.target.value })}
              className={`${INPUT} min-h-16`}
              maxLength={200}
              placeholder="逗号分隔，如：像素画,游戏资源,壁纸（留空不输出）"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="mt-1 text-[10px] leading-4 text-neutral-400">
              Google 已忽略该标签，百度/Yandex 仍参考；建议 5~10 个，逗号分隔。
            </p>
          </div>
          <div>
            <label htmlFor="seo-footer-text" className={LABEL_STRONG}>
              页脚文案
            </label>
            <input
              id="seo-footer-text"
              value={form.footerText}
              onChange={(e) => set({ footerText: e.target.value })}
              className={INPUT}
              maxLength={120}
              placeholder="站名后的一句话，如：分享与发现 · 请遵守平台规则（留空不显示）"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div>
            <label htmlFor="seo-icp" className={LABEL_STRONG}>
              ICP 备案号
            </label>
            <input
              id="seo-icp"
              value={form.icp}
              onChange={(e) => set({ icp: e.target.value })}
              className={INPUT}
              maxLength={60}
              placeholder="如：粤ICP备XXXXXXXX号（留空不在页脚显示）"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div>
            <label htmlFor="seo-contact-email" className={LABEL_STRONG}>
              联系邮箱
            </label>
            <input
              id="seo-contact-email"
              value={form.contactEmail}
              onChange={(e) => set({ contactEmail: e.target.value })}
              className={INPUT}
              maxLength={200}
              placeholder="用于页脚「联系我们」，留空不显示"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>
      </section>

      <section className="border border-brand-200 bg-surface p-5">
        <h3 className="text-sm font-semibold text-neutral-900">站长平台验证</h3>
        <p className="mt-1 text-xs text-neutral-400">
          填写各站长平台提供的验证码；留空的引擎不输出对应 meta。保存后请到对应平台完成验证。
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {VERIFICATION_FIELDS.map((f) => (
            <div key={f.key}>
              <label htmlFor={`seo-${f.key}`} className={LABEL_STRONG}>
                {f.label}
              </label>
              <input
                id={`seo-${f.key}`}
                value={form[f.key]}
                onChange={(e) => set({ [f.key]: e.target.value })}
                className={INPUT}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="mt-1 text-[10px] leading-4 text-neutral-400">{f.hint}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border border-brand-200 bg-surface p-5">
        <h3 className="text-sm font-semibold text-neutral-900">展示与结构化数据</h3>
        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="seo-locale" className={LABEL_STRONG}>
              OG 语言区域（og:locale）
            </label>
            <input
              id="seo-locale"
              value={form.ogLocale}
              onChange={(e) => set({ ogLocale: e.target.value })}
              className={INPUT}
              placeholder="zh_CN"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="mt-1 text-[10px] leading-4 text-neutral-400">
              形如 zh_CN / en_US；留空或非法时回退 zh_CN。
            </p>
          </div>
          <div>
            <label htmlFor="seo-desc" className={LABEL_STRONG}>
              默认 meta 描述
            </label>
            <textarea
              id="seo-desc"
              value={form.defaultDescription}
              onChange={(e) => set({ defaultDescription: e.target.value })}
              className={`${INPUT} min-h-20`}
              maxLength={300}
              placeholder="留空则使用系统默认文案（含站点名）"
            />
            <p className="mt-1 text-[10px] leading-4 text-neutral-400">
              用于首页等未单独设置描述的页面，建议 80~160 字。
            </p>
          </div>
          <label className="flex cursor-pointer items-start gap-2.5">
            <SquareCheckbox
              checked={form.structuredData}
              onChange={(next) => set({ structuredData: next })}
              ariaLabel="输出结构化数据（JSON-LD）"
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm text-neutral-900">输出结构化数据（JSON-LD）</span>
              <span className="mt-0.5 block text-xs text-neutral-400">
                全站 WebSite + 详情页 Article 与面包屑；关闭后不再输出任何结构化数据。
              </span>
            </span>
          </label>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={pending} className={BTN_PRIMARY_SM}>
          {pending ? "保存中…" : "保存配置"}
        </button>
        {message?.kind === "ok" && (
          <span className="text-xs text-emerald-700" role="status">
            {message.text}
          </span>
        )}
        {message?.kind === "error" && (
          <span className="text-xs text-red-600" role="alert">
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}
