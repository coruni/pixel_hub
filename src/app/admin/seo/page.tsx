import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { getSeoWithVersion } from "@/lib/seo-config";
import SeoManager from "@/components/admin/SeoManager";

export const metadata: Metadata = { title: "SEO 配置" };

export default async function AdminSeoPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/admin");

  const { config, version } = await getSeoWithVersion();

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-medium text-neutral-900">SEO 配置</h2>
          <p className="mt-1 text-xs text-neutral-400">
            站长平台验证、展示元信息与结构化数据；保存后前台全站生效。仅管理员可见。
          </p>
        </div>
      </div>
      <SeoManager config={config} version={version} />
    </div>
  );
}
