import AdBlock, { type AdCfg } from "@/components/ads/AdBlock";

const frame = "mx-auto max-w-7xl px-4 sm:px-6";

// 广告位板块：与其他板块同宽对齐；未配置（无图无代码）时不渲染
export default function AdSectionBlock({ cfg }: { cfg: AdCfg }) {
 const empty = cfg.mode === "html" ? !cfg.html.trim() : !cfg.image.trim();
 if (empty) return null;
 return (
 <section className="mt-8">
 <div className={frame}>
 <AdBlock cfg={cfg} />
 </div>
 </section>
 );
}
