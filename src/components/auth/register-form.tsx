"use client";

import Link from "next/link";
import { useActionState } from "react";
import { registerAction } from "@/lib/actions";

const inputCls =
 "w-full rounded-none border border-brand-200 bg-surface px-3.5 py-2.5 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10";

export default function RegisterForm() {
 const [state, formAction, pending] = useActionState(registerAction, {});

 return (
 <div className="w-full max-w-md">
 <div className="rounded-none border border-brand-200 bg-surface p-8">
 <h1 className="text-xl font-semibold text-neutral-900">创建账号</h1>
 <p className="mt-1 text-sm text-neutral-500">加入社区，发布图片与游戏资源</p>

 {state.error && (
 <p className="mt-4 rounded-none bg-red-50 px-3 py-2 text-sm text-red-600">{state.error}</p>
 )}

 <form action={formAction} className="mt-6 space-y-4">
 <div>
 <label className="mb-1.5 block text-sm font-medium text-neutral-700">邮箱</label>
 <input name="email" type="email" autoComplete="email" required className={inputCls} placeholder="you@example.com" />
 {state.fieldErrors?.email && <p className="mt-1 text-xs text-red-500">{state.fieldErrors.email[0]}</p>}
 </div>
 <div className="grid grid-cols-2 gap-4">
 <div>
 <label className="mb-1.5 block text-sm font-medium text-neutral-700">用户名</label>
 <input name="username" required className={inputCls} placeholder="用英文，用于主页" />
 {state.fieldErrors?.username && <p className="mt-1 text-xs text-red-500">{state.fieldErrors.username[0]}</p>}
 </div>
 <div>
 <label className="mb-1.5 block text-sm font-medium text-neutral-700">昵称</label>
 <input name="name" className={inputCls} placeholder="显示名（可选）" />
 </div>
 </div>
 <div>
 <label className="mb-1.5 block text-sm font-medium text-neutral-700">密码</label>
 <input name="password" type="password" autoComplete="new-password" required className={inputCls} placeholder="至少 8 位" />
 {state.fieldErrors?.password && <p className="mt-1 text-xs text-red-500">{state.fieldErrors.password[0]}</p>}
 </div>
 <button
 type="submit"
 disabled={pending}
 className="w-full rounded-none border border-brand-600 bg-brand-500 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-60"
 >
 {pending ? "创建中…" : "注册并登录"}
 </button>
 </form>
 </div>

 <p className="mt-4 text-center text-sm text-neutral-500">
 已有账号？{" "}
 <Link href="/login" className="font-medium text-neutral-900 hover:underline">
 去登录
 </Link>
 </p>
 <p className="mt-2 text-center text-xs text-neutral-400">
 新用户投稿需经过审核（白名单作者可免审直发）。
 </p>
 </div>
 );
}
