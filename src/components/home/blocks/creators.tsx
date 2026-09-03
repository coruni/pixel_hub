import Link from "next/link";
import { getTopCreators } from "@/lib/home";
import { formatCount } from "@/lib/format";
import SectionTitle from "@/components/home/SectionTitle";

const frame = "mx-auto max-w-7xl px-4 sm:px-6";

export default async function CreatorsBlock({ title, count }: { title: string | null; count: number }) {
 const creators = await getTopCreators(count);
 if (creators.length === 0) return null;

 return (
 <section className="mt-8">
 <div className={frame}>
 {title && <SectionTitle>{title}</SectionTitle>}
 <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
 {creators.map((c) => (
 <Link
 key={c.username}
 href={`/u/${c.username}`}
 className="flex items-center gap-3 rounded-none border border-brand-200 bg-surface p-3 transition hover:border-brand-500"
 >
 <span className="grid h-10 w-10 shrink-0 place-items-center rounded-none border border-brand-600 bg-brand-500 text-sm font-semibold text-white">
 {(c.name ?? c.username).slice(0, 1).toUpperCase()}
 </span>
 <span className="min-w-0">
 <span className="block truncate text-sm font-medium text-neutral-800">{c.name ?? c.username}</span>
 <span className="block truncate text-[11px] text-neutral-400">
 {c.resources} 作品 · {formatCount(c.followers)} 粉丝
 </span>
 </span>
 </Link>
 ))}
 </div>
 </div>
 </section>
 );
}
