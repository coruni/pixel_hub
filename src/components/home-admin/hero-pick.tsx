"use client";

import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Gamepad2, Search, X } from "lucide-react";
import { searchResourcesAction, type ResourcePick } from "@/lib/actions/home";
import type { HeroPickMeta } from "./SectionEditor";

const input =
 "w-full rounded-none border border-brand-200 bg-surface pl-8 pr-3 py-2 text-sm outline-none transition focus:border-brand-500";

export default function HeroPick({
 value,
 onChange,
 max = 8,
 placeholder,
}: {
 value: HeroPickMeta[];
 onChange: (v: HeroPickMeta[]) => void;
 max?: number;
 placeholder?: string;
}) {
 const [q, setQ] = useState("");
 const [results, setResults] = useState<ResourcePick[]>([]);
 const [searching, setSearching] = useState(false);
 const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

 useEffect(() => () => {
 if (timer.current) clearTimeout(timer.current);
 }, []);

 function onQuery(v: string) {
 setQ(v);
 if (timer.current) clearTimeout(timer.current);
 const kw = v.trim();
 if (!kw) {
 setResults([]);
 return;
 }
 timer.current = setTimeout(async () => {
 setSearching(true);
 const r = await searchResourcesAction(kw);
 setSearching(false);
 setResults(r.ok ? r.items : []);
 }, 250);
 }

 function add(p: ResourcePick) {
 if (value.length >= max) return;
 if (value.some((x) => x.id === p.id)) return;
 onChange([...value, { id: p.id, title: p.title, slug: p.slug }]);
 setQ("");
 setResults([]);
 }

 function remove(id: string) {
 onChange(value.filter((x) => x.id !== id));
 }

 return (
 <div>
 {/* 已选 */}
 {value.length > 0 && (
 <div className="mb-2 flex flex-wrap gap-1.5">
 {value.map((p) => (
 <span key={p.id} className="inline-flex items-center gap-1.5 rounded-none border border-brand-200 bg-surface px-2.5 py-1 text-xs text-neutral-700">
 {p.title}
 <button type="button" onClick={() => remove(p.id)} aria-label="移除" className="text-neutral-400 hover:text-red-500">
 <X size={12} />
 </button>
 </span>
 ))}
 </div>
 )}

 <div className="relative">
 <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400">
 <Search size={14} />
 </span>
 <input
 value={q}
 onChange={(e) => onQuery(e.target.value)}
 maxLength={50}
 placeholder={placeholder ?? "搜索已上架资源标题，选择主推内容…"}
 className={input}
 />
 </div>

 {q.trim() && (
 <div className="mt-2 max-h-56 overflow-auto rounded-none border border-brand-200 bg-surface p-1">
 {searching ? (
 <p className="px-3 py-2 text-xs text-neutral-400">搜索中…</p>
 ) : results.length === 0 ? (
 <p className="px-3 py-2 text-xs text-neutral-400">没有匹配的结果</p>
 ) : (
 results.map((p) => {
 const chosen = value.some((x) => x.id === p.id);
 const full = value.length >= max;
 return (
 <button
 key={p.id}
 type="button"
 disabled={chosen || full}
 onClick={() => add(p)}
 className="flex w-full items-center gap-2 rounded-none px-2 py-1.5 text-left text-xs text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-50"
 >
 <span className="grid h-8 w-11 shrink-0 place-items-center overflow-hidden rounded-none bg-neutral-100">
 {p.thumbUrl ? (
 /* eslint-disable-next-line @next/next/no-img-element */
 <img src={p.thumbUrl} alt="" className="h-full w-full object-cover" />
 ) : p.type === "GAME" ? (
 <Gamepad2 size={14} className="text-neutral-400" />
 ) : (
 <ImageIcon size={14} className="text-neutral-400" />
 )}
 </span>
 <span className="min-w-0 flex-1 truncate">{p.title}</span>
 {chosen && <span className="text-neutral-300">已选</span>}
 </button>
 );
 })
 )}
 </div>
 )}
 </div>
 );
}
