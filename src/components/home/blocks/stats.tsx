import { Database, Download, Eye, Users } from "lucide-react";
import BlockShell from "@/components/home/BlockShell";
import { getHomeStats } from "@/lib/home";
import { formatCount } from "@/lib/format";

export default async function StatsBlock({ title }: { title: string | null }) {
 const stats = await getHomeStats();
 const items = [
 { Icon: Database, label: "已上架内容", v: stats.resources },
 { Icon: Users, label: "注册用户", v: stats.users },
 { Icon: Download, label: "累计下载", v: stats.downloads },
 { Icon: Eye, label: "累计浏览", v: stats.views },
 ];
 return (
<BlockShell title={title}>
 <div className="grid grid-cols-2 gap-3 rounded-none border border-brand-200 bg-surface p-5 sm:grid-cols-4 sm:p-6">
 {items.map((it) => (
 <div key={it.label} className="flex items-center gap-3">
 <span className="grid h-10 w-10 shrink-0 place-items-center rounded-none bg-neutral-100 text-neutral-600">
 <it.Icon size={18} aria-hidden />
 </span>
 <span>
 <span className="block text-xl font-semibold text-neutral-900">{formatCount(it.v)}</span>
 <span className="block text-[11px] text-neutral-400">{it.label}</span>
 </span>
 </div>
 ))}
 </div>
 </BlockShell>
 );
}
