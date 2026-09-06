// 后台加载统一复用前台 Loader（三方块跳动动画），不再使用 animate-pulse 骨架屏
import Loader from "@/components/Loader";

export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <Loader label="后台加载中…" className="mt-24" />
    </div>
  );
}
