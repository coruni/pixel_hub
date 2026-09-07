import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { timeAgo } from "@/lib/format";
import { intParam, str, type SP } from "@/lib/search-params";
import { ADMIN_PAGE_SIZE, STABLE_NEWEST, adminQuery } from "@/lib/admin/paging";
import { TableFooter } from "@/components/admin/DataTable";
import type { Prisma } from "@prisma/client";

export const metadata: Metadata = { title: "操作日志" };

// 高权限动作中文标签（覆盖全站 audit 调用过的 action；未列出的回退原值）
const ACTION_LABELS: Record<string, string> = {
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
  EDIT_CATEGORY: "编辑分类",
  EDIT_TAG: "编辑标签",
  UPDATE_RESOURCE: "修改内容",
  DELETE_MEDIA: "删除媒体",
  DELETE_MEDIA_BULK: "批量删除媒体",
  SET_ACTIVE_DRIVE: "切换活跃云盘",
  EDIT_CLOUD_DRIVE: "编辑云盘",
  DELETE_CLOUD_DRIVE: "删除云盘",
  TEST_CLOUD_DRIVE: "测试云盘连通",
  ADD_HOME: "新建首页板块",
  REMOVE_HOME: "删除首页板块",
  REORDER_HOME: "调整首页顺序",
  EDIT_THEME_SIDEBAR: "编辑侧栏",
  EDIT_THEME_WIDGET: "编辑组件",
  REMOVE_THEME_WIDGET: "删除组件",
  REORDER_THEME_WIDGET: "调整组件顺序",
  EDIT_THEME_NAV: "编辑导航",
  EDIT_SEO: "编辑 SEO 配置",
  EDIT_UPLOAD_LIMITS: "编辑上传限制",
  RESET_UPLOAD_LIMITS: "重置上传限制",
  DELETE_COMMENT: "删除评论",
};

const ACTIONS = Object.keys(ACTION_LABELS);

const input =
  "rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-sm outline-none transition focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-400";

export default async function LogsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN" && session?.user?.role !== "MODERATOR") redirect("/");

  const sp = await searchParams;
  const action = str(sp, "action") ?? "";
  const adminId = str(sp, "admin") ?? "";
  const page = intParam(sp, "page", 1);
  const pageSize = Math.min(100, intParam(sp, "size", ADMIN_PAGE_SIZE));

  const where: Prisma.AuditLogWhereInput = {
    ...(ACTIONS.includes(action) ? { action } : {}),
    ...(adminId ? { adminId } : {}),
  };

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
      <div className="mb-4">
        <h2 className="text-lg font-medium text-neutral-900">操作日志</h2>
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="log-action">
          动作类型
        </label>
        <select id="log-action" name="action" defaultValue={action} className={input}>
          <option value="">全部动作</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {ACTION_LABELS[a] ?? a}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="log-admin">
          操作人
        </label>
        <select id="log-admin" name="admin" defaultValue={adminId} className={input}>
          <option value="">全部操作人</option>
          {[...adminMap.values()].map((u) => (
            <option key={u.id} value={u.id}>
              {u.name ?? u.username}
            </option>
          ))}
        </select>
        <button type="submit" className={input}>
          筛选
        </button>
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
                        {ACTION_LABELS[r.action] ?? r.action}
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
