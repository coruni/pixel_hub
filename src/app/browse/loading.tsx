// 骨架屏只放在不会 notFound 的列表页（根级 loading 会让动态路由的 notFound 变成软 404）
import Loader from "@/components/Loader";

export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="h-8 w-40 animate-pulse rounded-none bg-neutral-100" />
      <div className="mt-4 h-9 w-full animate-pulse rounded-none bg-neutral-100" />
      <Loader label="加载中…" className="mt-24" />
    </div>
  );
}
