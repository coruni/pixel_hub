import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { formatCount, timeAgo } from "@/lib/format";
import { intParam, str, type SP } from "@/lib/search-params";
import { ADMIN_PAGE_SIZE, STABLE_NEWEST, adminQuery } from "@/lib/admin/paging";
import { TableFooter } from "@/components/admin/DataTable";
import ClearLogsButton from "@/components/admin/logs-clear";
import { INPUT_FILTER } from "@/lib/ui/cls";
import { Button } from "@/components/ui/Button";
// 动作标签与筛选语义与「清空日志」action 共用一份（见 src/lib/admin/logs.ts）
import { DELETE_FILTER, LOG_ACTION_LABELS, LOG_ACTIONS, logWhere } from "@/lib/admin/logs";

export const metadata: Metadata = { title: "操作日志" };

export default async function LogsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await auth();
  const role = session?.user?.role;
  if (role !== "ADMIN" && role !== "MODERATOR") redirect("/");

  const sp = await searchParams;
  const action = str(sp, "action") ?? "";
  const adminId = str(sp, "admin") ?? "";
  const page = intParam(sp, "page", 1);
  const pageSize = Math.min(100, intParam(sp, "size", ADMIN_PAGE_SIZE));

  const where = logWhere(action, adminId);

  const [rows, total, operatorIds] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: [...STABLE_NEWEST],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ select: { adminId: true }, distinct: ["adminId"] }),
  ]);

  const adminMap = new Map(
    (
      operatorIds.length
        ? await prisma.user.findMany({
            where: { id: { in: operatorIds.map((o) => o.adminId) } },
            select: { id: true, username: true, name: true },
          })
        : []
    ).map((u) => [u.id, u] as const),
  );

  const base = {
    action: action || undefined,
    admin: adminId || undefined,
    ...(pageSize !== ADMIN_PAGE_SIZE ? { size: String(pageSize) } : {}),
  };
  const href = (p: number) => `/admin/logs${adminQuery(base, { page: String(p) })}`;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium text-neutral-900">
          操作日志（{formatCount(total)}）
        </h2>
        {/* 清空日志：仅管理员；范围＝当前筛选命中（未筛选时才是全部） */}
        {role === "ADMIN" && (
          <ClearLogsButton
            action={action}
            adminId={adminId}
            matched={total}
            href={`/admin/logs${adminQuery(base)}`}
          />
        )}
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="log-action">
          动作类型
        </label>
        <select id="log-action" name="action" defaultValue={action} className={INPUT_FILTER}>
          <option value="">全部动作</option>
          <option value={DELETE_FILTER}>删除类操作（全部）</option>
          {LOG_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {LOG_ACTION_LABELS[a] ?? a}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="log-admin">
          操作人
        </label>
        <select id="log-admin" name="admin" defaultValue={adminId} className={INPUT_FILTER}>
          <option value="">全部操作人</option>
          {[...adminMap.values()].map((u) => (
            <option key={u.id} value={u.id}>
              {u.name ?? u.username}
            </option>
          ))}
        </select>
        <Button type="submit" variant="filter">
          筛选
        </Button>
        {(action || adminId) && (
          <Link
            href="/admin/logs"
            className="text-xs text-neutral-400 underline-offset-2 hover:text-brand-700 hover:underline"
          >
            清空筛选
          </Link>
        )}
      </form>

      {rows.length === 0 ? (
        <p className="rounded-none border border-brand-200 bg-surface px-5 py-10 text-center text-sm text-neutral-400">
          暂无日志
        </p>
      ) : (
        <div className="overflow-x-auto rounded-none border border-brand-200 bg-surface">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-neutral-100 text-left text-xs text-neutral-400">
                <th className="px-4 py-2.5 font-medium">时间</th>
                <th className="px-4 py-2.5 font-medium">操作人</th>
                <th className="px-4 py-2.5 font-medium">动作</th>
                <th className="px-4 py-2.5 font-medium">目标</th>
                <th className="px-4 py-2.5 font-medium">备注</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map((r) => {
                const admin = adminMap.get(r.adminId);
                return (
                  <tr key={r.id} className="hover:bg-neutral-50/60">
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-neutral-400">
                      {timeAgo(r.createdAt)}
                    </td>
                    <td className="px-4 py-2.5 text-neutral-800">
                      @{admin?.username ?? "已删除"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="rounded-none bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600">
                        {LOG_ACTION_LABELS[r.action] ?? r.action}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-neutral-400">
                      {r.targetType ? `${r.targetType}` : "—"}
                      {r.targetId ? (
                        <span className="text-neutral-300"> #{r.targetId.slice(-8)}</span>
                      ) : (
                        ""
                      )}
                    </td>
                    <td className="max-w-[280px] truncate px-4 py-2.5 text-xs text-neutral-500">
                      {r.note ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <TableFooter
        page={page}
        hasMore={(page - 1) * pageSize + rows.length < total}
        total={total}
        pageSize={pageSize}
        href={href}
      />
    </div>
  );
}
