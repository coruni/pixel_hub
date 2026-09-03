// 骨架屏只放在不会 notFound 的列表页（根级 loading 会让动态路由的 notFound 变成软 404）
export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="h-9 w-2/3 animate-pulse rounded-none bg-neutral-100" />
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="animate-pulse">
            <div className="rounded-none border border-brand-200 bg-brand-50/40" style={{ height: `${120 + (i % 4) * 60}px` }} />
            <div className="mt-2 h-3.5 w-3/4 rounded-none bg-neutral-100" />
            <div className="mt-1.5 h-3 w-1/2 rounded-none bg-neutral-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
