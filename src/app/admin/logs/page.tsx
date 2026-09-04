import { prisma } from "@/lib/db/prisma";
import { timeAgo } from "@/lib/format";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "操作日志" };

const actionLabel: Record<string, string> = {
  APPROVE: "通过审核",
  REJECT: "打回",
  REMOVE_RESOURCE: "下架内容",
  RESTORE: "恢复上架",
  REPORT_RESOLVE: "处置举报",
  REPORT_DISMISS: "驳回举报",
  TRUST: "设为免审",
  UNTRUST: "取消免审",
  SET_ROLE: "修改角色",
  BAN: "封禁",
  UNBAN: "解封",
};

export default async function LogsPage() {
  const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 200 });

  const adminIds = [...new Set(rows.map((r) => r.adminId))];
  const adminMap = new Map(
    (adminIds.length
      ? await prisma.user.findMany({
          where: { id: { in: adminIds } },
          select: { id: true, username: true, name: true },
        })
      : []
    ).map((u) => [u.id, u] as const),
  );

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-medium text-neutral-900">最近操作</h2>
        <p className="text-xs text-neutral-400">记录审核、下架、用户管理等高权限动作</p>
      </div>
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
                    <td className="px-4 py-2.5 text-neutral-800">@{admin?.username ?? "已删除"}</td>
                    <td className="px-4 py-2.5">
                      <span className="rounded-none bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600">
                        {actionLabel[r.action] ?? r.action}
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
    </div>
  );
}
