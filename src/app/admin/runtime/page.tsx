import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { getRuntimeConfigWithVersion } from "@/lib/runtime-config";
import { getSeoWithVersion } from "@/lib/seo-config";
import { siteUrl as siteUrlOf } from "@/lib/site-url";
import RuntimeConfigManager from "@/components/admin/RuntimeConfigManager";
import SeoManager from "@/components/admin/SeoManager";
import SubTabs from "@/components/admin/SubTabs";

export const metadata: Metadata = { title: "站点配置" };

// 站点配置：运行配置（GitHub OAuth / 存储 / SMTP，原 .env 迁入）+ SEO 配置，tab 切换避免页面过长。
export default async function AdminRuntimePage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/admin");

  const [runtime, seo] = await Promise.all([getRuntimeConfigWithVersion(), getSeoWithVersion()]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium text-neutral-900">站点配置</h2>
      </div>
      <p className="mb-4 rounded-none border border-brand-200 bg-surface px-4 py-3 text-xs leading-5 text-neutral-500">
        运行配置与 SEO 元信息集中管理，保存后立即生效、无需改 .env 重启。运行配置留空的项会回退
        读取旧 .env（迁移期兼容），配置齐全后可从 .env 删除对应变量。仅管理员可见。
      </p>

      <SubTabs
        tabs={[
          { key: "runtime", label: "运行配置" },
          { key: "seo", label: "SEO 配置" },
        ]}
        panels={{
          runtime: (
            <>
              <p className="mb-4 text-xs leading-5 text-neutral-500">
                按「登录 / 存储 / 邮件 / 云盘」分组维护，对应旧 .env 的
                GITHUB_* / STORAGE / S3 / SMTP / GRAPH_* 配置；底部统一保存，立即生效。
              </p>
              <RuntimeConfigManager
                config={runtime.config}
                version={runtime.version}
                siteUrl={siteUrlOf()}
              />
            </>
          ),
          seo: (
            <>
              <p className="mb-4 text-xs leading-5 text-neutral-500">
                站点信息、站长平台验证与结构化数据；保存后前台全站生效。
              </p>
              <SeoManager config={seo.config} version={seo.version} />
            </>
          ),
        }}
      />
    </div>
  );
}
