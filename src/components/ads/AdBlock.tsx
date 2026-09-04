// 通用广告位渲染：图片+链接 或 HTML 片段，带「广告」角标；无内边距让横幅贴边。
// 侧边栏/内容槽位组件（SiteSidebar）与首页板块（HomeRenderer）共用。
// 配置仅管理员可写；HTML 模式为联盟广告代码（AdSense 等）原样注入，非用户输入。

export type AdCfg = {
    mode: "image" | "html";
    image: string;
    link: string;
    alt: string;
    html: string;
    /** 是否显示「广告」角标；缺省视为 true（兼容旧配置） */
    badge?: boolean;
};

const adBoxCls = "relative rounded-none border border-brand-200 bg-surface";

function AdBadge() {
    return (
        <span className="absolute right-1.5 top-1.5 z-10 rounded-none bg-black/45 px-1 py-px text-[9px] leading-3 text-white/90">
            广告
        </span>
    );
}

/** 内容为空（无图、无代码）时返回 null，由调用方决定占位 */
export default function AdBlock({ cfg }: { cfg: AdCfg }) {
    const badge = cfg.badge !== false ? <AdBadge /> : null;

    if (cfg.mode === "html") {
        const html = cfg.html?.trim();
        if (!html) return null;
        return (
            <section className={adBoxCls}>
                {badge}
                <div dangerouslySetInnerHTML={{ __html: html }} />
            </section>
        );
    }

    const image = cfg.image?.trim();
    if (!image) return null;
    /* eslint-disable-next-line @next/next/no-img-element */
    const img = <img src={image} alt={cfg.alt || "广告"} loading="lazy" decoding="async" className="block h-auto w-full" />;
    const ext = /^https?:\/\//i.test(cfg.link);
    return (
        <section className={adBoxCls}>
            {badge}
            {cfg.link ? (
                <a href={cfg.link} target={ext ? "_blank" : undefined} rel={ext ? "noopener noreferrer sponsored" : undefined}>
                    {img}
                </a>
            ) : (
                img
            )}
        </section>
    );
}
