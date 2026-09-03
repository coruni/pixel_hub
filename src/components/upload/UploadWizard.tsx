"use client";

import Link from "next/link";
import { Gamepad2, Image as ImageIcon, Newspaper, X } from "lucide-react";
import { useActionState, useRef, useState } from "react";
import { createResourceAction, type ResourceActionState } from "@/lib/actions/resource";

type Uploaded = {
 id: string;
 name: string;
 ok: boolean;
 error?: string;
 thumbUrl: string | null;
 bigUrl: string | null;
 origUrl: string | null;
 width?: number | null;
 height?: number | null;
};

type Cat = { id: string; name: string };

const input =
 "w-full rounded-none border border-brand-200 bg-surface px-3.5 py-2.5 text-sm outline-none transition placeholder:text-neutral-400 focus:border-brand-500";
const label = "mb-1 block text-sm font-medium text-neutral-700";
const fieldErr = (msg?: string[]) =>
 msg && msg.length > 0 ? <p className="mt-1 text-xs text-red-500">{msg[0]}</p> : null;

export default function UploadWizard({ categories }: { categories: Cat[] }) {
 const [type, setType] = useState<"GAME" | "IMAGE" | "ARTICLE">("IMAGE");
 const [files, setFiles] = useState<Uploaded[]>([]);
 const [coverId, setCoverId] = useState<string>("");
 const [uploading, setUploading] = useState(false);
 const [uploadMsg, setUploadMsg] = useState<string | null>(null);
 const fileRef = useRef<HTMLInputElement>(null);
 const [catId, setCatId] = useState("");

 const [state, formAction, pending] = useActionState<ResourceActionState, FormData>(
 createResourceAction,
 {}
 );

 const showCats = categories;
 const ids = files.filter((f) => f.ok).map((f) => f.id);

 function applyType(t: "GAME" | "IMAGE" | "ARTICLE") {
 setType(t);
 if (!showCats.some((c) => c.id === catId)) setCatId("");
 }

 async function onFiles(fl: FileList | null) {
 if (!fl || fl.length === 0) return;
 setUploading(true);
 setUploadMsg(null);
 const fd = new FormData();
 for (const f of Array.from(fl)) fd.append("files", f);
 try {
 const res = await fetch("/api/upload", { method: "POST", body: fd });
 const data = await res.json();
 if (!data.ok) {
 setUploadMsg(data.error ?? "上传失败");
 return;
 }
 const list = (data.files ?? []) as Uploaded[];
 const good = list.filter((f) => f.ok);
 const bad = list.filter((f) => !f.ok);
 if (good.length > 0) {
 setFiles((prev) => {
 const next = [...prev, ...good].slice(0, 12);
 if (!coverId && next.length > 0) setCoverId(next[0].id);
 return next;
 });
 }
 if (bad.length > 0) setUploadMsg(`${bad.map((b) => b.name).join("、")} 上传失败：${bad[0]?.error ?? "未知原因"}`);
 } catch {
 setUploadMsg("上传失败，请检查网络后重试");
 } finally {
 setUploading(false);
 if (fileRef.current) fileRef.current.value = "";
 }
 }

 function remove(id: string) {
 setFiles((prev) => {
 const next = prev.filter((f) => f.id !== id);
 if (coverId === id) setCoverId(next.find((f) => f.ok)?.id ?? "");
 return next;
 });
 }

 return (
 <form action={formAction} className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
 <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">发布资源</h1>
 <p className="mt-2 rounded-none border border-brand-200 bg-brand-50/60 px-3 py-2 text-xs leading-5 text-brand-800">
 支持图片、游戏（外链）与文章发布。可信用户免审直发，普通用户提交后进入审核队列。
 </p>

 {/* 隐藏字段 */}
 <input type="hidden" name="type" value={type} />
 <input type="hidden" name="mediaIds" value={JSON.stringify(ids)} />
 <input type="hidden" name="coverId" value={coverId} />

 {/* 类型切换 */}
 <div className="mt-6 grid grid-cols-3 gap-3">
 {(
 [
 { k: "IMAGE", label: "图片", desc: "原创 / AI / 壁纸 / 截图", Icon: ImageIcon },
 { k: "GAME", label: "游戏", desc: "整包外链发布", Icon: Gamepad2 },
 { k: "ARTICLE", label: "文章", desc: "图文教程 / 心得 / 资讯", Icon: Newspaper },
 ] as const
 ).map((t) => (
 <button
 key={t.k}
 type="button"
 onClick={() => applyType(t.k)}
 className={`flex items-center gap-3 rounded-none border p-3 text-left transition ${
 type === t.k ? "border-brand-600 bg-brand-500 text-white" : "border-brand-200 bg-surface text-neutral-500 hover:border-brand-400 hover:text-neutral-800"
 }`}
 >
 <t.Icon size={20} className="shrink-0" aria-hidden />
 <span className="min-w-0">
 <span className="block text-sm font-medium leading-tight">{t.label}</span>
 <span className="mt-0.5 block text-[11px] font-normal opacity-75">{t.desc}</span>
 </span>
 </button>
 ))}
 </div>

 {/* 基础信息 */}
 <section className="mt-6 space-y-4 rounded-none border border-brand-200 bg-surface p-5">
 <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-800"><span className="grid h-6 w-6 place-items-center rounded-none border border-brand-600 bg-brand-500 text-[11px] text-white">1</span>基础信息</h2>
 <div>
 <label className={label} htmlFor="title">标题</label>
 <input id="title" name="title" required maxLength={80} placeholder="给内容起一个清晰的名字" className={input} />
 {fieldErr(state.fieldErrors?.title)}
 </div>
 <div>
 <label className={label} htmlFor="summary">一句话简介（可选）</label>
 <input id="summary" name="summary" maxLength={160} placeholder="出现在卡片与详情页的副标题" className={input} />
 </div>
 <div>
 <label className={label} htmlFor="description">{type === "ARTICLE" ? "正文" : "详细描述"}</label>
 <textarea
 id="description"
 name="description"
 required
 rows={type === "ARTICLE" ? 12 : 5}
 maxLength={20000}
 placeholder={type === "ARTICLE" ? "文章正文（Markdown）……\n（至少 10 个字）" : "介绍内容、玩法/用途、使用方法、注意事项……\n（至少 10 个字）"}
 className={input}
 />
 {fieldErr(state.fieldErrors?.description)}
 <p className="mt-1 text-xs leading-5 text-neutral-400">
 支持 Markdown 排版：空行分段；<code className="rounded-none bg-neutral-100 px-1">#</code> 标题、<code className="rounded-none bg-neutral-100 px-1">-</code> 列表、<code className="rounded-none bg-neutral-100 px-1">**加粗**</code>、<code className="rounded-none bg-neutral-100 px-1">`代码`</code>、<code className="rounded-none bg-neutral-100 px-1">[链接](地址)</code>。
 </p>
 </div>
 <div className="grid gap-4 sm:grid-cols-2">
 <div>
 <label className={label} htmlFor="categoryId">分类</label>
 <select
 id="categoryId"
 name="categoryId"
 value={catId}
 onChange={(e) => setCatId(e.target.value)}
 className={input}
 >
 <option value="">选择分类…</option>
 {showCats.map((c) => (
 <option key={c.id} value={c.id}>{c.name}</option>
 ))}
 </select>
 {fieldErr(state.fieldErrors?.categoryId)}
 </div>
 <div>
 <label className={label} htmlFor="tags">标签</label>
 <input id="tags" name="tags" maxLength={400} placeholder="用空格/逗号分隔，如：像素风 开放世界" className={input} />
 </div>
 </div>
 </section>

 {/* 类型化信息（文章无额外信息，正文即内容） */}
 {type === "IMAGE" && (
 <section className="mt-4 space-y-4 rounded-none border border-brand-200 bg-surface p-5">
 <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-800"><span className="grid h-6 w-6 place-items-center rounded-none border border-brand-600 bg-brand-500 text-[11px] text-white">2</span>图片信息<span className="font-normal text-neutral-400">D2 声明</span></h2>
 <div className="grid gap-3 sm:grid-cols-2">
 <label className="flex items-center gap-2 rounded-none border border-brand-200 px-3 py-2.5 text-sm text-neutral-700">
 <input type="checkbox" name="isAiGenerated" className="h-4 w-4 accent-brand-500" />
 由 AI 生成
 </label>
 <label className="flex items-center gap-2 rounded-none border border-brand-200 px-3 py-2.5 text-sm text-neutral-700">
 <input type="checkbox" name="original" className="h-4 w-4 accent-brand-500" />
 本人原创
 </label>
 </div>
 <div className="grid gap-4 sm:grid-cols-2">
 <div>
 <label className={label} htmlFor="aiTool">生成工具（如选 AI）</label>
 <input id="aiTool" name="aiTool" maxLength={60} placeholder="Midjourney / Stable Diffusion…" className={input} />
 </div>
 <div>
 <label className={label} htmlFor="aiModel">模型/参数（可选）</label>
 <input id="aiModel" name="aiModel" maxLength={60} placeholder="v6.1 / SDXL…" className={input} />
 </div>
 </div>
 <div className="grid gap-4 sm:grid-cols-2">
 <div>
 <label className={label} htmlFor="license">授权/许可（可选）</label>
 <input id="license" name="license" maxLength={40} placeholder="仅自用 / CC BY / 可商用…" className={input} />
 </div>
 <div>
 <label className={label} htmlFor="sourceNote">素材来源（转素材请填）</label>
 <input id="sourceNote" name="sourceNote" maxLength={200} placeholder="作者/原址，避免侵权纠纷" className={input} />
 </div>
 </div>
 <p className="text-xs text-neutral-400">上传图片需尊重版权：转载须注明来源，AI 生成建议如实标注。</p>
 </section>
 )}
 {type === "GAME" && (
 <section className="mt-4 space-y-4 rounded-none border border-brand-200 bg-surface p-5">
 <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-800"><span className="grid h-6 w-6 place-items-center rounded-none border border-brand-600 bg-brand-500 text-[11px] text-white">2</span>游戏信息</h2>
 <div>
 <label className={label} htmlFor="externalUrl">下载外链 *</label>
 <input
 id="externalUrl"
 name="externalUrl"
 required
 placeholder="https://pan.xxx / 官网直链…"
 className={input}
 />
 {fieldErr(state.fieldErrors?.externalUrl)}
 </div>
 <div className="grid gap-4 sm:grid-cols-2">
 <div>
 <label className={label} htmlFor="version">版本</label>
 <input id="version" name="version" maxLength={40} placeholder="v1.2.3" className={input} />
 </div>
 <div>
 <label className={label} htmlFor="size">大小</label>
 <input id="size" name="size" maxLength={40} placeholder="1.2 GB" className={input} />
 </div>
 </div>
 <div className="grid gap-4 sm:grid-cols-2">
 <div>
 <label className={label} htmlFor="platforms">平台</label>
 <input id="platforms" name="platforms" maxLength={100} placeholder="Windows / Android / Switch…" className={input} />
 </div>
 <div>
 <label className={label} htmlFor="lang">语言</label>
 <input id="lang" name="lang" maxLength={40} placeholder="简体中文 / English…" className={input} />
 </div>
 </div>
 <div className="grid gap-4 sm:grid-cols-2">
 <div>
 <label className={label} htmlFor="license">授权</label>
 <input id="license" name="license" maxLength={40} placeholder="免费 / 商业 / 待授权…" className={input} />
 </div>
 <div>
 <label className={label} htmlFor="note">说明</label>
 <input id="note" name="note" maxLength={300} placeholder="如：仅供学习交流，请在 24h 内删除" className={input} />
 </div>
 </div>
 <p className="text-xs text-neutral-400">
 仅允许发布<b>有权分发</b>的内容（原创/已获授权/免费资源）。严禁盗版与侵权资源。
 </p>
 </section>
 )}

 {/* 图片上传（文章为可选插图） */}
 <section className="mt-4 rounded-none border border-brand-200 bg-surface p-5">
 <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-800"><span className="grid h-6 w-6 place-items-center rounded-none border border-brand-600 bg-brand-500 text-[11px] text-white">{type === "ARTICLE" ? 2 : 3}</span>{type === "ARTICLE" ? "插图" : "预览图"}{type !== "ARTICLE" && <span className="text-red-500">*</span>}<span className="font-normal tabular-nums text-neutral-400">{files.filter((f) => f.ok).length}/12</span></h2>
 <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4">
 {files.map((f) => (
 <div key={f.id} className="group relative overflow-hidden rounded-none border border-brand-200 bg-neutral-100">
 {f.ok && f.bigUrl ? (
 <button
 type="button"
 onClick={() => setCoverId(f.id)}
 title="设为封面"
 className="block w-full"
 >
 {/* eslint-disable-next-line @next/next/no-img-element */}
 <img src={f.bigUrl} alt={f.name} className="aspect-square w-full object-cover" />
 </button>
 ) : (
 <div className="grid aspect-square w-full place-items-center p-2 text-center text-[11px] text-red-500">
 {f.error ?? "失败"}
 </div>
 )}
 {f.ok && coverId === f.id && (
 <span className="absolute left-1.5 top-1.5 rounded-none border border-brand-600 bg-brand-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
 封面
 </span>
 )}
 <button
 type="button"
 onClick={() => remove(f.id)}
 aria-label="移除"
 className="absolute right-1.5 top-1.5 rounded-none bg-black/55 p-1 text-white opacity-0 transition group-hover:opacity-100"
 >
 <X size={12} />
 </button>
 </div>
 ))}
 <label className="grid aspect-square w-full cursor-pointer place-items-center rounded-none border-2 border-dashed border-brand-300 bg-brand-50/40 text-center text-brand-700 transition hover:border-brand-500 hover:bg-brand-50">
 <span className="px-2 text-xs">
 {uploading ? "处理中…" : files.length >= 12 ? "已达上限" : "＋ 上传图片"}
 <span className="mt-0.5 block font-normal text-[10px] opacity-70">png/jpg/webp ≤20MB</span>
 </span>
 <input
 ref={fileRef}
 type="file"
 accept="image/*"
 multiple
 disabled={uploading || files.length >= 12}
 onChange={(e) => onFiles(e.target.files)}
 className="hidden"
 />
 </label>
 </div>
 {fieldErr(state.fieldErrors?.mediaIds)}
 {uploadMsg && <p className="mt-2 text-xs text-amber-600">{uploadMsg}</p>}
 </section>

 {/* 发布选项 */}
 <section className="mt-4 flex flex-wrap gap-x-6 gap-y-2 rounded-none border border-brand-200 bg-surface p-5 text-sm text-neutral-700">
 <h2 className="flex w-full items-center gap-2 text-sm font-semibold text-neutral-800"><span className="grid h-6 w-6 place-items-center rounded-none border border-brand-600 bg-brand-500 text-[11px] text-white">{type === "ARTICLE" ? 3 : 4}</span>发布选项</h2>
 <label className="flex items-center gap-2">
 <input type="checkbox" name="loginRequired" className="h-4 w-4 accent-brand-500" />
 下载需登录
 </label>
 <label className="flex items-center gap-2">
 <input type="checkbox" name="allowComments" defaultChecked className="h-4 w-4 accent-brand-500" />
 允许评论
 </label>
 </section>

 {/* 提交 */}
 <div className="mt-6 flex flex-wrap items-center gap-4">
 <button
 type="submit"
 disabled={pending || uploading}
 className="rounded-none border border-brand-600 bg-brand-500 px-8 py-3 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
 >
 {pending ? "提交中…" : type !== "ARTICLE" && files.length === 0 ? "先上传图片" : "提交发布"}
 </button>
 {state.ok && state.pending && (
 <span className="flex items-center gap-2 text-sm text-emerald-600">
 ✓ 已提交审核，通过后将自动上架
 <Link href="/" className="underline">返回首页</Link>
 </span>
 )}
 {state.error && <span className="text-sm text-red-500">{state.error}</span>}
 </div>
 </form>
 );
}
