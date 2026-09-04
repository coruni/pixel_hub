// 后台各页多为表格/卡片，统一一个简单骨架（统计卡 + 列表行）
export default function Loading() {
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-none border border-neutral-200 bg-surface"
          />
        ))}
      </div>
      <div className="mt-6 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-none border border-neutral-200 bg-surface"
          />
        ))}
      </div>
    </div>
  );
}
