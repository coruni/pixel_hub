import Link from "next/link";
import MiniBadge from "@/components/ui/MiniBadge";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth";
import { formatCount, timeAgo } from "@/lib/format";
import { intParam, str, type SP } from "@/lib/search-params";
import { ADMIN_PAGE_SIZE, STABLE_NEWEST, adminQuery } from "@/lib/admin/paging";
import { TableFooter } from "@/components/admin/DataTable";
import { UserActions } from "@/components/admin/buttons";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "用户管理" };

const roleLabel: Record<string, string> = { USER: "用户", MODERATOR: "版主", ADMIN: "管理员" };
const ROLES = ["USER", "MODERATOR", "ADMIN"] as const;

/** "0"/"1" 二值筛选参数，其余值视为不限 */
function yesNo(sp: SP, key: string): "0" | "1" | "" {
  const v = str(sp, key);
  return v === "0" || v === "1" ? v : "";
}

const input =
  "rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-sm outline-none transition focus:border-brand-500";

export default async function UsersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await auth();
  const isAdmin = session?.user?.role === "ADMIN";
  // 全站用户列表（含邮箱等 PII）仅 ADMIN 可见；MODERATOR 直接输 URL 也不放行
  if (!isAdmin) redirect("/admin");

  const sp = await searchParams;
  const q = (str(sp, "q") ?? "").trim().slice(0, 80);
  const roleRaw = str(sp, "role") ?? "";
  const role = (ROLES as readonly string[]).includes(roleRaw)
    ? (roleRaw as (typeof ROLES)[number])
    : "";
  const banned = yesNo(sp, "banned");
  const trusted = yesNo(sp, "trusted");
  const page = intParam(sp, "page", 1);
  const pageSize = Math.min(100, intParam(sp, "size", ADMIN_PAGE_SIZE));

  const where = {
    ...(role ? { role } : {}),
    ...(banned === "1" ? { bannedAt: { not: null } } : banned === "0" ? { bannedAt: null } : {}),
    ...(trusted === "1" ? { trusted: true } : trusted === "0" ? { trusted: false } : {}),
    // 用户名 / 昵称 / 邮箱关键词（邮箱属 PII，仅本 ADMIN 页可搜）
    ...(q
      ? {
          OR: [
            { username: { contains: q, mode: "insensitive" as const } },
            { name: { contains: q, mode: "insensitive" as const } },
            { email: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: [...STABLE_NEWEST],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { _count: { select: { resources: true } } },
    }),
    prisma.user.count({ where }),
  ]);

  const base = {
    q: q || undefined,
    role: role || undefined,
    banned: banned || undefined,
    trusted: trusted || undefined,
    ...(pageSize !== ADMIN_PAGE_SIZE ? { size: String(pageSize) } : {}),
  };
  const href = (p: number) => `/admin/users${adminQuery(base, { page: String(p) })}`;
  const chip = (on: boolean) =>
    `rounded-none px-3 py-1 text-xs transition ${
      on
        ? "bg-brand-500 text-white"
        : "border border-brand-200 bg-surface text-neutral-500 hover:border-brand-500"
    }`;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-medium text-neutral-900">用户管理（{formatCount(total)}）</h2>
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="user-q">
          关键词
        </label>
        <input
          id="user-q"
          name="q"
          defaultValue={q}
          placeholder="用户名 / 昵称 / 邮箱"
          className={`${input} w-52 text-xs`}
        />
        <label className="sr-only" htmlFor="user-role">
          角色
        </label>
        <select id="user-role" name="role" defaultValue={role} className={`${input} text-xs`}>
          <option value="">全部角色</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {roleLabel[r]}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs text-neutral-700 transition hover:border-brand-500"
        >
          筛选
        </button>
        {(q || role || banned || trusted) && (
          <Link
            href="/admin/users"
            className="text-xs text-neutral-400 underline-offset-2 hover:text-brand-700 hover:underline"
          >
            清空筛选
          </Link>
        )}
      </form>

      {/* 状态筛选：封禁 / 免审 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href={`/admin/users${adminQuery(base, { banned: "" })}`} className={chip(!banned)}>
          全部状态
        </Link>
        <Link href={`/admin/users${adminQuery(base, { banned: "1" })}`} className={chip(banned === "1")}>
          已封禁
        </Link>
        <Link href={`/admin/users${adminQuery(base, { banned: "0" })}`} className={chip(banned === "0")}>
          正常
        </Link>
        <span className="mx-1 h-4 w-px bg-neutral-200" aria-hidden />
        <Link href={`/admin/users${adminQuery(base, { trusted: "" })}`} className={chip(!trusted)}>
          不限免审
        </Link>
        <Link href={`/admin/users${adminQuery(base, { trusted: "1" })}`} className={chip(trusted === "1")}>
          已免审
        </Link>
        <Link href={`/admin/users${adminQuery(base, { trusted: "0" })}`} className={chip(trusted === "0")}>
          未免审
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-none border border-brand-200 bg-surface px-5 py-10 text-center text-sm text-neutral-400">
          没有匹配的用户
        </p>
      ) : (
        <div className="overflow-x-auto rounded-none border border-brand-200 bg-surface">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-neutral-100 text-left text-xs text-neutral-400">
                <th className="px-4 py-2.5 font-medium">用户</th>
                <th className="px-4 py-2.5 font-medium">角色</th>
                <th className="px-4 py-2.5 font-medium">状态</th>
                <th className="px-4 py-2.5 font-medium">作品</th>
                <th className="px-4 py-2.5 font-medium">加入</th>
                <th className="px-4 py-2.5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map((u) => (
                <tr key={u.id} className="hover:bg-neutral-50/60">
                  <td className="px-4 py-2.5">
                    <Link href={`/u/${u.username}`} className="flex items-center gap-2.5">
                      <span className="grid h-8 w-8 place-items-center rounded-none bg-neutral-200 text-xs font-semibold text-neutral-700">
                        {(u.name ?? u.username).slice(0, 1).toUpperCase()}
                      </span>
                      <span>
                        <span className="block font-medium text-neutral-900">
                          {u.name ?? u.username}
                        </span>
                        <span className="block text-xs text-neutral-400">
                          @{u.username}
                          {` · ${u.email}`}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-neutral-700">{roleLabel[u.role]}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {u.trusted && (
                        <span className="rounded-none bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
                          免审
                        </span>
                      )}
                      {u.bannedAt ? (
                        <span className="rounded-none bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600">
                          已封禁
                        </span>
                      ) : (
                        <MiniBadge>正常</MiniBadge>
                      )}
                      {u.bannedReason && (
                        <span className="text-[10px] text-neutral-400">· {u.bannedReason}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-neutral-500">
                    {formatCount(u._count.resources)} 作
                  </td>
                  <td className="px-4 py-2.5 text-xs text-neutral-400">{timeAgo(u.createdAt)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <UserActions
                      userId={u.id}
                      isSelf={u.id === session?.user?.id}
                      role={u.role}
                      trusted={u.trusted}
                      banned={!!u.bannedAt}
                    />
                  </td>
                </tr>
              ))}
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
