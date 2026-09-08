import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import AdminTabs from "@/components/admin/AdminTabs";

// 后台整段不收录；子页 title 走「页面 · 管理后台」模板（absolute 为本段兜底标题）
export const metadata: Metadata = {
  title: { absolute: "管理后台", template: "%s · 管理后台" },
  robots: { index: false },
};

const tabs: { href: string; label: string; adminOnly?: boolean }[] = [
  { href: "/admin", label: "概览" },
  { href: "/admin/queue", label: "审核队列" },
  { href: "/admin/content", label: "内容库" },
  { href: "/admin/ai", label: "网站管家" },
  { href: "/admin/reports", label: "举报" },
  { href: "/admin/users", label: "用户管理" },
  { href: "/admin/media", label: "媒体库" },
  { href: "/admin/logs", label: "操作日志" },
  { href: "/admin/categories", label: "分类管理", adminOnly: true },
  { href: "/admin/tags", label: "标签管理", adminOnly: true },
  { href: "/admin/drives", label: "云盘", adminOnly: true },
  { href: "/admin/uploads", label: "上传限制", adminOnly: true },
  { href: "/admin/site", label: "站点布局", adminOnly: true },
  { href: "/admin/docs", label: "内容页面", adminOnly: true },
  { href: "/admin/runtime", label: "站点配置", adminOnly: true },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const role = session?.user?.role;
  if (role !== "ADMIN" && role !== "MODERATOR") redirect("/");

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="lg:flex lg:gap-8">
        {/* 侧栏：桌面左侧竖排，移动端标题下横向滚动 */}
        <aside className="mb-5 lg:mb-0 lg:w-48 lg:shrink-0">
          <div className="mb-3 flex items-center gap-2.5 lg:mb-4">
            <h1 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight text-neutral-900">
              <span className="h-5 w-1.5 rounded-none bg-brand-500" aria-hidden />
              管理后台
            </h1>
          </div>
          <div className="mb-3 lg:mb-4">
            <span className="rounded-none bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700">
              {role === "ADMIN" ? "管理员" : "版主"}
            </span>
          </div>
          <AdminTabs tabs={tabs} isAdmin={role === "ADMIN"} />
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
