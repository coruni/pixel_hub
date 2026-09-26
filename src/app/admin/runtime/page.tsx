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

// 站点配置：运行配置（GitHub OAuth / 存储 / SMTP / 全文搜索，原 .env 迁入）+ SEO 配置，tab 切换避免页面过长。
export default async function AdminRuntimePage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/admin");

  const [runtime, seo] = await Promise.all([getRuntimeConfigWithVersion(), getSeoWithVersion()]);

  return (
    <div>
      <header className="mb-6 border-b border-neutral-200 pb-5">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-600">
          站点设置 / 系统配置
        </p>
        <h2 className="text-xl font-semibold tracking-tight text-neutral-900">站点配置</h2>
        <p className="mt-1 text-sm text-neutral-500">
          集中管理运行参数与 SEO 信息，保存后立即生效，无需修改 .env 或重启服务。
        </p>
      </header>
      <p className="mb-4 border-l-2 border-brand-400 bg-surface px-4 py-3 text-xs leading-5 text-neutral-500">
        运行配置留空的项目会在迁移期回退读取旧 .env；配置齐全后可从 .env 删除对应变量。仅管理员可见。
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
                按「登录 / 存储 / 邮件 / 云盘 / 搜索」分组维护，对应旧 .env 的
                GITHUB_* / STORAGE / S3 / SMTP / GRAPH_* / SEARCH_* / ES_* 配置；
                底部统一保存，立即生效（搜索引擎切换后重跑 npm run search:reindex 重建存量）。
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
                站点信息、站长平台验证、结构化数据与 IndexNow 推送；保存后前台全站生效。
              </p>
              <SeoManager config={seo.config} version={seo.version} siteUrl={siteUrlOf()} />
            </>
          ),
        }}
      />
    </div>
  );
}
