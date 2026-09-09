import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth";
import { enumParam, intParam, type SP } from "@/lib/search-params";
import { ADMIN_PAGE_SIZE, STABLE_NEWEST, adminQuery } from "@/lib/admin/paging";
import { TableFooter } from "@/components/admin/DataTable";
import AiReviewPanel from "@/components/admin/AiReviewPanel";
import Link from "next/link";
import { BTN_FILTER, INPUT_FILTER } from "@/lib/ui/cls";
import type { AiTaskKind, AiTaskStatus } from "@prisma/client";
import { Button } from "@/components/ui/Button";

export const metadata: Metadata = { title: "网站管家" };
const KINDS = ["RESOURCE_ENRICH", "RESOURCE_REVIEW", "IMAGE_DESCRIBE", "GAME_RESEARCH"] as const;
const STATUSES = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED"] as const;
const kindLabel: Record<string, string> = {
  RESOURCE_ENRICH: "内容补全",
  RESOURCE_REVIEW: "内容审核",
  IMAGE_DESCRIBE: "图片描述",
  GAME_RESEARCH: "游戏资料",
};
const statusLabel: Record<string, string> = {
  QUEUED: "排队中",
  RUNNING: "执行中",
  SUCCEEDED: "已完成",
  FAILED: "失败",
};

function taskTitle(inputJson: string) {
  try {
    const input = JSON.parse(inputJson) as {
      resource?: { title?: string };
      title?: string;
      name?: string;
    };
    return input.resource?.title ?? input.title ?? input.name ?? "未命名任务";
  } catch {
    return "未命名任务";
  }
}

export default async function AiAdminPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await auth();
  const role = session?.user?.role;
  if (role !== "ADMIN" && role !== "MODERATOR") redirect("/admin");

  const sp = await searchParams;
  const kind = enumParam(sp, "kind", KINDS, "" as never) as string;
  const status = enumParam(sp, "status", STATUSES, "" as never) as string;
  const page = intParam(sp, "page", 1);
  const pageSize = Math.min(100, intParam(sp, "size", ADMIN_PAGE_SIZE));

  // 站点级建议（SITE_OVERVIEW）归属 /admin 概览「AI 运营建议」卡片，不在此资源管家列表展示
  //（该页 AiReviewPanel 仅处理四类资源任务，避免误渲染/误出现「接受」按钮）。
  const where = {
    ...(kind ? { kind: kind as AiTaskKind } : { kind: { not: "SITE_OVERVIEW" as AiTaskKind } }),
    ...(status ? { status: status as AiTaskStatus } : {}),
  };
  const [tasks, total] = await Promise.all([
    prisma.aiTask.findMany({
      where,
      orderBy: [...STABLE_NEWEST],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        suggestions: { orderBy: { createdAt: "desc" }, take: 10 },
        sources: { orderBy: { createdAt: "desc" }, take: 10 },
        runs: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    prisma.aiTask.count({ where }),
  ]);

  const base = {
    ...(kind ? { kind } : {}),
    ...(status ? { status } : {}),
    ...(pageSize !== ADMIN_PAGE_SIZE ? { size: String(pageSize) } : {}),
  };
  const href = (p: number) => `/admin/ai${adminQuery(base, { page: String(p) })}`;

  const rows = tasks.map((task) => {
    let resource: Record<string, unknown> | undefined;
    try {
      resource = (JSON.parse(task.inputJson) as { resource?: Record<string, unknown> }).resource;
    } catch {
      /* 脱敏输入不可用时不展示当前值 */
    }
    return {
      id: task.id,
      kind: task.kind,
      kindLabel: kindLabel[task.kind] ?? task.kind,
      status: task.status,
      statusLabel: statusLabel[task.status] ?? task.status,
      title: taskTitle(task.inputJson),
      createdAt: task.createdAt.toISOString(),
      current: resource
        ? { title: resource.title, summary: resource.summary, description: resource.description }
        : {},
      suggestions: task.suggestions.map((s) => ({
        id: s.id,
        status: s.status,
        outputJson: s.outputJson,
        decisionJson: s.decisionJson,
      })),
      sources: task.sources.map((s) => ({
        title: s.title,
        locator: s.locator,
        excerpt: s.excerpt,
      })),
      lastRun: task.runs[0] ? { errorMessage: task.runs[0].errorMessage } : null,
    };
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium text-neutral-900">网站管家</h2>
          <p className="mt-1 text-xs text-neutral-400">
            AI 只生成草稿，确认后才会进入内容编辑流程。
          </p>
        </div>
        <span className="text-xs text-neutral-400">共 {total} 个任务</span>
      </div>
      <form method="get" className="mb-4 flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="ai-kind">
          任务类型
        </label>
        <select
          id="ai-kind"
          name="kind"
          defaultValue={kind}
          className={INPUT_FILTER}
        >
          <option value="">全部类型</option>
          {KINDS.map((x) => (
            <option key={x} value={x}>
              {kindLabel[x]}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="ai-status">
          任务状态
        </label>
        <select
          id="ai-status"
          name="status"
          defaultValue={status}
          className={INPUT_FILTER}
        >
          <option value="">全部状态</option>
          {STATUSES.map((x) => (
            <option key={x} value={x}>
              {statusLabel[x]}
            </option>
          ))}
        </select>
        <Button type="submit" className={BTN_FILTER}>
          筛选
        </Button>
        {(kind || status) && (
          <Link
            href="/admin/ai"
            className="text-xs text-neutral-400 underline-offset-2 hover:text-brand-700 hover:underline"
          >
            清空筛选
          </Link>
        )}
      </form>
      <AiReviewPanel
        tasks={rows}
        canOperate={role === "ADMIN" || role === "MODERATOR"}
        isAdmin={role === "ADMIN"}
      />
      <TableFooter
        page={page}
        hasMore={(page - 1) * pageSize + tasks.length < total}
        total={total}
        pageSize={pageSize}
        href={href}
      />
    </div>
  );
}
