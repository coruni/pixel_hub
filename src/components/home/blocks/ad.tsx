import AdBlock, { type AdCfg } from "@/components/ads/AdBlock";
import BlockShell from "@/components/home/BlockShell";

// 广告位板块：与其他板块同宽对齐；未配置（无图无代码）时不渲染
export default function AdSectionBlock({ cfg }: { cfg: AdCfg }) {
  const empty = cfg.mode === "html" ? !cfg.html.trim() : !cfg.image.trim();
  if (empty) return null;
  return (
    <BlockShell title={null}>
      <AdBlock cfg={cfg} />
    </BlockShell>
  );
}
