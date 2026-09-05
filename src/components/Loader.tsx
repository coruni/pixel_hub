/**
 * 三方块跳动加载指示（oO0 0Oo 波浪相位：方块依次弹起放大、落回缩小）。
 * 纯 CSS 动画（keyframes 在 globals.css），server/client 组件通用，无 hydration 开销。
 */
export default function Loader({
  label,
  className = "",
}: {
  label?: string; // 方块下的可选小字（如「加载中…」）
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center gap-2 ${className}`}
      role="status"
      aria-live="polite"
    >
      <div className="loader-bounce" aria-hidden>
        <span />
        <span />
        <span />
      </div>
      {label ? <span className="text-xs text-neutral-400">{label}</span> : null}
      <span className="sr-only">加载中</span>
    </div>
  );
}
