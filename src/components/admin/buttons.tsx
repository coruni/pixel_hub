"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
 approveResourceAction,
 rejectResourceAction,
 restoreResource,
 setResourceRemoved,
 handleReportBatchAction,
 setUserBanned,
 setUserRole,
 setUserTrusted,
} from "@/lib/actions/moderation";

const b = "rounded-none px-3 py-1.5 text-xs font-medium transition disabled:opacity-50";

export function QueueActions({ resourceId }: { resourceId: string }) {
 const router = useRouter();
 const [pending, start] = useTransition();
 const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
 start(async () => {
 const r = await fn();
 if (!r.ok) window.alert(r.error ?? "操作失败");
 else router.refresh();
 });
 return (
 <div className="flex gap-2">
 <button
 disabled={pending}
 onClick={() => act(() => approveResourceAction(resourceId))}
 className={`${b} bg-emerald-600 text-white hover:bg-emerald-500`}
 >
 通过
 </button>
 <button
 disabled={pending}
 onClick={() => {
 const reason = window.prompt("打回原因（会通知作者）：") ?? "";
 if (reason === null) return;
 act(() => rejectResourceAction(resourceId, reason));
 }}
 className={`${b} border border-amber-300 text-amber-700 hover:bg-amber-50`}
 >
 打回
 </button>
 </div>
 );
}

export function ContentActions({ resourceId, status }: { resourceId: string; status: string }) {
 const router = useRouter();
 const [pending, start] = useTransition();
 const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
 start(async () => {
 const r = await fn();
 if (!r.ok) window.alert(r.error ?? "操作失败");
 else router.refresh();
 });
 if (status === "PUBLISHED")
 return (
 <button
 disabled={pending}
 onClick={() => {
 if (!window.confirm("确认下架该内容？作者将收到通知。")) return;
 act(() => setResourceRemoved(resourceId));
 }}
 className={`${b} border border-red-300 text-red-600 hover:bg-red-50`}
 >
 下架
 </button>
 );
 if (status === "REMOVED")
 return (
 <button
 disabled={pending}
 onClick={() => act(() => restoreResource(resourceId))}
 className={`${b} border border-brand-200 text-neutral-700 hover:bg-neutral-100`}
 >
 恢复上架
 </button>
 );
 return <span className="text-xs text-neutral-400">{status}</span>;
}

export function ReportActions({
 type,
 targetId,
 resourceStatus,
}: {
 type: "RESOURCE" | "COMMENT" | "USER";
 targetId?: string | null;
 resourceStatus?: string | null;
}) {
 const router = useRouter();
 const [pending, start] = useTransition();
 const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
 start(async () => {
 const r = await fn();
 if (!r.ok) window.alert(r.error ?? "操作失败");
 else router.refresh();
 });
 const isRes = type === "RESOURCE";
 const removed = isRes && resourceStatus === "REMOVED";
 const paused = isRes && resourceStatus === "PENDING"; // 因举报正被暂挂复查
 const base = { type, resourceId: isRes ? targetId : null, commentId: type === "COMMENT" ? targetId : null, userId: type === "USER" ? targetId : null };
 const confirm = () => run(() => handleReportBatchAction({ ...base, decision: "confirm" }));
 const dismiss = () => run(() => handleReportBatchAction({ ...base, decision: "dismiss" }));
 return (
 <div className="flex flex-wrap gap-2">
 <button
 disabled={pending}
 onClick={() => {
 if (paused && !window.confirm("驳回举报并将该内容恢复上架？")) return;
 dismiss();
 }}
 className={`${b} border border-brand-200 text-neutral-700 hover:bg-neutral-100`}
 >
 {paused ? "驳回举报·恢复上架" : "驳回举报"}
 </button>
 <button
 disabled={pending}
 onClick={() => {
 if (!removed && !window.confirm("确认违规（内容将被下架）并关闭全部同类举报？")) return;
 confirm();
 }}
 className={`${b} ${
 removed ? "border border-brand-200 text-neutral-500 hover:bg-neutral-100" : "bg-red-600 text-white hover:bg-red-500"
 }`}
 >
 {isRes && !removed ? "确认违规·下架" : "确认违规"}
 </button>
 </div>
 );
}

export function UserActions({
 userId,
 isSelf,
 role,
 trusted,
 banned,
}: {
 userId: string;
 isSelf: boolean;
 role: "USER" | "MODERATOR" | "ADMIN";
 trusted: boolean;
 banned: boolean;
}) {
 const router = useRouter();
 const [pending, start] = useTransition();
 const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
 start(async () => {
 const r = await fn();
 if (!r.ok) window.alert(r.error ?? "操作失败");
 else router.refresh();
 });
 if (isSelf) return <span className="text-xs text-neutral-400">（你）</span>;
 return (
 <div className="flex flex-wrap gap-2">
 <button
 disabled={pending || banned}
 onClick={() => run(() => setUserTrusted(userId, !trusted))}
 className={`${b} ${
 trusted ? "border border-brand-200 text-neutral-600 hover:bg-neutral-100" : "bg-emerald-600 text-white hover:bg-emerald-500"
 }`}
 >
 {trusted ? "取消免审" : "设为免审"}
 </button>
 {!banned && (
 <select
 defaultValue={role}
 disabled={pending}
 onChange={(e) => run(() => setUserRole(userId, e.target.value as "USER" | "MODERATOR" | "ADMIN"))}
 className="rounded-none border border-brand-200 bg-surface px-2 py-1.5 text-xs disabled:opacity-50"
 >
 <option value="USER">普通用户</option>
 <option value="MODERATOR">版主</option>
 <option value="ADMIN">管理员</option>
 </select>
 )}
 <button
 disabled={pending}
 onClick={() => {
 if (banned) return run(() => setUserBanned(userId, false));
 const reason = window.prompt("封禁原因（可选）：") ?? undefined;
 if (reason === null) return;
 run(() => setUserBanned(userId, true, reason || undefined));
 }}
 className={`${b} ${
 banned
 ? "bg-neutral-200 text-neutral-600 hover:bg-neutral-300"
 : "border border-red-300 text-red-600 hover:bg-red-50"
 }`}
 >
 {banned ? "解封" : "封禁"}
 </button>
 </div>
 );
}
