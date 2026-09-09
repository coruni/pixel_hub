"use client";

// 站点运行配置表单：GitHub OAuth / 存储驱动 / SMTP 邮件。整体提交 + 乐观锁版本。
// 优先级：此处配置 > 旧 .env（迁移期回退，.env 可删）。
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateRuntimeConfigAction } from "@/lib/actions/runtime-config";
import SubTabs from "@/components/admin/SubTabs";
import type { RuntimeConfig } from "@/lib/runtime-config";
import { SquareCheckbox } from "@/components/admin/SquareCheckbox";
import { BTN_PRIMARY_SM, INPUT, LABEL_STRONG } from "@/lib/ui/cls";
import { Button } from "@/components/ui/Button";

const DRIVERS = [
  { value: "local", label: "本地磁盘（public/uploads）" },
  { value: "chevereto", label: "Chevereto 图床" },
  { value: "s3", label: "S3 兼容对象存储（S3 / R2 / MinIO）" },
] as const;

export default function RuntimeConfigManager({
  config,
  version,
  siteUrl,
}: {
  config: RuntimeConfig;
  version: number;
  siteUrl: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [form, setForm] = useState({
    githubId: config.githubId,
    githubSecret: config.githubSecret,
    storageDriver: config.storageDriver,
    cheveretoBase: config.cheveretoBase,
    cheveretoApiKey: config.cheveretoApiKey,
    s3Endpoint: config.s3Endpoint,
    s3Region: config.s3Region,
    s3Bucket: config.s3Bucket,
    s3AccessKeyId: config.s3AccessKeyId,
    s3SecretAccessKey: config.s3SecretAccessKey,
    s3PublicBase: config.s3PublicBase,
    s3AclPrivate: config.s3AclPrivate,
    attachmentCloud: config.attachmentCloud,
    smtpHost: config.smtpHost,
    smtpPort: config.smtpPort,
    smtpUser: config.smtpUser,
    smtpPass: config.smtpPass,
    mailFrom: config.mailFrom,
    mailNotify: config.mailNotify,
    emailCodeRequired: config.emailCodeRequired,
    graphTenant: config.graphTenant,
    graphClientId: config.graphClientId,
    graphClientSecret: config.graphClientSecret,
    graphEndpoint: config.graphEndpoint,
    graphScope: config.graphScope,
    searchEngine: config.searchEngine,
    esUrl: config.esUrl,
    esIndex: config.esIndex,
    esApiKey: config.esApiKey,
    esUsername: config.esUsername,
    esPassword: config.esPassword,
    esAnalyzer: config.esAnalyzer,
    searchCandidateLimit: config.searchCandidateLimit,
  });

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const save = () =>
    start(async () => {
      setMessage(null);
      // 本页只渲染部分字段：提交时以未编辑的 config 全量打底，避免把其他页（如云盘 Graph 凭据）保存的字段抹掉
      const result = await updateRuntimeConfigAction({ ...config, ...form }, version);
      if (result.ok) {
        setMessage({ kind: "ok", text: "已保存，立即生效（无需重启）" });
        router.refresh();
      } else {
        setMessage({ kind: "error", text: result.error ?? "保存失败，请重试" });
      }
    });

  return (
    <div className="space-y-5">
      <p className="text-xs leading-5 text-neutral-500">
        按分组保存，全部立即生效（无需重启）；留空的项回退读取旧 .env（迁移期兼容）。
      </p>
      <SubTabs
        tabs={[
          { key: "login", label: "登录" },
          { key: "storage", label: "存储" },
          { key: "mail", label: "邮件" },
          { key: "cloud", label: "云盘" },
          { key: "search", label: "搜索" },
        ]}
        panels={{
          login: (
            <>
      {/* ---- 登录 ---- */}
      <section className="border border-brand-200 bg-surface p-5">
        <h3 className="text-sm font-semibold text-neutral-900">GitHub 登录</h3>
        <p className="mt-1 text-xs leading-5 text-neutral-400">
          在 GitHub → Settings → Developer settings → OAuth Apps 创建应用，
          Authorization callback URL 填：
          <code className="mx-1 bg-brand-50 px-1 py-0.5 text-brand-700">
            {siteUrl}/api/auth/callback/github
          </code>
          两项都填写后 GitHub 登录按钮即刻出现（留空则关闭）。此处留空时回退读取旧 .env。
        </p>
        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="rc-github-id" className={LABEL_STRONG}>
              Client ID
            </label>
            <input
              id="rc-github-id"
              value={form.githubId}
              onChange={(e) => set({ githubId: e.target.value })}
              className={INPUT}
              autoComplete="off"
              spellCheck={false}
              placeholder="Iv1.xxxxxxxxxxxxxxxx"
            />
          </div>
          <div>
            <label htmlFor="rc-github-secret" className={LABEL_STRONG}>
              Client Secret
            </label>
            <input
              id="rc-github-secret"
              type="password"
              value={form.githubSecret}
              onChange={(e) => set({ githubSecret: e.target.value })}
              className={INPUT}
              autoComplete="off"
              spellCheck={false}
              placeholder="••••••••••••••••••••"
            />
          </div>
        </div>
      </section>
            </>
          ),
          storage: (
            <>
      {/* ---- 存储 ---- */}
      <section className="border border-brand-200 bg-surface p-5">
        <h3 className="text-sm font-semibold text-neutral-900">存储</h3>
        <p className="mt-1 text-xs leading-5 text-neutral-400">
          上传文件的存放位置。切换驱动只影响之后的上传，已落库的 URL 不变。
        </p>
        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="rc-driver" className={LABEL_STRONG}>
              存储驱动
            </label>
            <select
              id="rc-driver"
              value={form.storageDriver}
              onChange={(e) => set({ storageDriver: e.target.value })}
              className={INPUT}
            >
              {DRIVERS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          <label className="flex cursor-pointer items-start gap-2.5">
            <SquareCheckbox
              checked={
                form.attachmentCloud === "on" ||
                (form.attachmentCloud === "auto" && form.storageDriver === "chevereto")
              }
              onChange={(next) => set({ attachmentCloud: next ? "on" : "off" })}
              ariaLabel="附件上传走云盘"
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm text-neutral-900">附件上传走云盘（OneDrive）</span>
              <span className="mt-0.5 block text-xs text-neutral-400">
                勾选后附件经 Microsoft Graph 分片直传活跃云盘（需已配置云盘凭据与活跃盘）；
                不勾则走上方所选存储驱动。存储驱动为 Chevereto 时默认勾选（大附件分片上传更稳）。
              </span>
            </span>
          </label>

          {form.storageDriver === "chevereto" && (
            <>
              <div>
                <label htmlFor="rc-chev-base" className={LABEL_STRONG}>
                  Chevereto 站点地址
                </label>
                <input
                  id="rc-chev-base"
                  value={form.cheveretoBase}
                  onChange={(e) => set({ cheveretoBase: e.target.value })}
                  className={INPUT}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="https://img.example.com"
                />
              </div>
              <div>
                <label htmlFor="rc-chev-key" className={LABEL_STRONG}>
                  API Key
                </label>
                <input
                  id="rc-chev-key"
                  type="password"
                  value={form.cheveretoApiKey}
                  onChange={(e) => set({ cheveretoApiKey: e.target.value })}
                  className={INPUT}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="••••••••••••••••"
                />
                <p className="mt-1 text-[10px] leading-4 text-neutral-400">
                  Chevereto 用户设置 → API 接入 中获取。
                </p>
              </div>
            </>
          )}

          {form.storageDriver === "s3" && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="rc-s3-endpoint" className={LABEL_STRONG}>
                    Endpoint
                  </label>
                  <input
                    id="rc-s3-endpoint"
                    value={form.s3Endpoint}
                    onChange={(e) => set({ s3Endpoint: e.target.value })}
                    className={INPUT}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="https://s3.example.com"
                  />
                </div>
                <div>
                  <label htmlFor="rc-s3-region" className={LABEL_STRONG}>
                    Region
                  </label>
                  <input
                    id="rc-s3-region"
                    value={form.s3Region}
                    onChange={(e) => set({ s3Region: e.target.value })}
                    className={INPUT}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="auto"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="rc-s3-bucket" className={LABEL_STRONG}>
                  Bucket
                </label>
                <input
                  id="rc-s3-bucket"
                  value={form.s3Bucket}
                  onChange={(e) => set({ s3Bucket: e.target.value })}
                  className={INPUT}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="rc-s3-ak" className={LABEL_STRONG}>
                    Access Key ID
                  </label>
                  <input
                    id="rc-s3-ak"
                    value={form.s3AccessKeyId}
                    onChange={(e) => set({ s3AccessKeyId: e.target.value })}
                    className={INPUT}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <div>
                  <label htmlFor="rc-s3-sk" className={LABEL_STRONG}>
                    Secret Access Key
                  </label>
                  <input
                    id="rc-s3-sk"
                    type="password"
                    value={form.s3SecretAccessKey}
                    onChange={(e) => set({ s3SecretAccessKey: e.target.value })}
                    className={INPUT}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="••••••••••••••••"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="rc-s3-base" className={LABEL_STRONG}>
                  公开访问基址
                </label>
                <input
                  id="rc-s3-base"
                  value={form.s3PublicBase}
                  onChange={(e) => set({ s3PublicBase: e.target.value })}
                  className={INPUT}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="留空用 Endpoint/Bucket 拼接；私有桶填 CDN 地址"
                />
              </div>
              <label className="flex cursor-pointer items-start gap-2.5">
                <SquareCheckbox
                  checked={form.s3AclPrivate}
                  onChange={(next) => set({ s3AclPrivate: next })}
                  ariaLabel="私有桶（不设置 public-read ACL）"
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm text-neutral-900">私有桶</span>
                  <span className="mt-0.5 block text-xs text-neutral-400">
                    上传时不设置 public-read ACL；公开访问基址需指向 CDN。
                  </span>
                </span>
              </label>
            </>
          )}

          {form.storageDriver === "local" && (
            <p className="text-xs leading-5 text-neutral-400">
              本地模式无需配置，文件存放在 public/uploads 下。
            </p>
          )}
        </div>
      </section>
            </>
          ),
          mail: (
            <>
      {/* ---- 邮件 ---- */}
      <section className="border border-brand-200 bg-surface p-5">
        <h3 className="text-sm font-semibold text-neutral-900">SMTP 邮件</h3>
        <p className="mt-1 text-xs leading-5 text-neutral-400">
          用于密码重置与邮件通知（评论回复、审核结果）。主机/用户/密码齐备后发信功能自动启用。
        </p>
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
            <div>
              <label htmlFor="rc-smtp-host" className={LABEL_STRONG}>
                SMTP 主机
              </label>
              <input
                id="rc-smtp-host"
                value={form.smtpHost}
                onChange={(e) => set({ smtpHost: e.target.value })}
                className={INPUT}
                autoComplete="off"
                spellCheck={false}
                placeholder="smtp.example.com"
              />
            </div>
            <div>
              <label htmlFor="rc-smtp-port" className={LABEL_STRONG}>
                端口
              </label>
              <input
                id="rc-smtp-port"
                value={form.smtpPort}
                onChange={(e) => set({ smtpPort: e.target.value })}
                className={INPUT}
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                placeholder="587"
              />
              <p className="mt-1 text-[10px] leading-4 text-neutral-400">465 走 SSL，其余 STARTTLS</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="rc-smtp-user" className={LABEL_STRONG}>
                SMTP 用户名
              </label>
              <input
                id="rc-smtp-user"
                value={form.smtpUser}
                onChange={(e) => set({ smtpUser: e.target.value })}
                className={INPUT}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div>
              <label htmlFor="rc-smtp-pass" className={LABEL_STRONG}>
                SMTP 密码 / 授权码
              </label>
              <input
                id="rc-smtp-pass"
                type="password"
                value={form.smtpPass}
                onChange={(e) => set({ smtpPass: e.target.value })}
                className={INPUT}
                autoComplete="off"
                spellCheck={false}
                placeholder="••••••••••••"
              />
            </div>
          </div>
          <div>
            <label htmlFor="rc-mail-from" className={LABEL_STRONG}>
              发件地址（From）
            </label>
            <input
              id="rc-mail-from"
              value={form.mailFrom}
              onChange={(e) => set({ mailFrom: e.target.value })}
              className={INPUT}
              autoComplete="off"
              spellCheck={false}
              placeholder="留空用 noreply@站点域名"
            />
          </div>
          <label className="flex cursor-pointer items-start gap-2.5">
            <SquareCheckbox
              checked={form.mailNotify}
              onChange={(next) => set({ mailNotify: next })}
              ariaLabel="开启邮件通知"
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm text-neutral-900">开启邮件通知</span>
              <span className="mt-0.5 block text-xs text-neutral-400">
                评论回复与审核结果邮件提醒（每用户每小时最多 5 封）；关闭后仅站内通知。
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2.5">
            <SquareCheckbox
              checked={form.emailCodeRequired}
              onChange={(next) => set({ emailCodeRequired: next })}
              ariaLabel="注册需邮箱验证码"
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm text-neutral-900">注册需邮箱验证码</span>
              <span className="mt-0.5 block text-xs text-neutral-400">
                开启后注册表单要求输入发送到邮箱的 6 位验证码（10 分钟有效）；需 SMTP 可用，
                未配置邮件服务时自动关闭验证以保底可用。
              </span>
            </span>
          </label>
        </div>
      </section>
            </>
          ),
          cloud: (
            <>
      {/* ---- 云盘附件（Microsoft Graph）---- */}
      <section className="border border-brand-200 bg-surface p-5">
        <h3 className="text-sm font-semibold text-neutral-900">云盘附件（Microsoft Graph）</h3>
        <p className="mt-1 text-xs leading-5 text-neutral-400">
          大附件分片上传到 OneDrive / SharePoint 的应用级凭据（client-credentials），
          「云盘」页登记的具体驱动器共用这一套；Endpoint / Scope 留空用默认值。
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="rc-graph-tenant" className={LABEL_STRONG}>
              Tenant ID
            </label>
            <input
              id="rc-graph-tenant"
              value={form.graphTenant}
              onChange={(e) => set({ graphTenant: e.target.value })}
              className={INPUT}
              autoComplete="off"
              spellCheck={false}
              placeholder="租户 GUID 或域名"
            />
          </div>
          <div>
            <label htmlFor="rc-graph-client" className={LABEL_STRONG}>
              Client ID
            </label>
            <input
              id="rc-graph-client"
              value={form.graphClientId}
              onChange={(e) => set({ graphClientId: e.target.value })}
              className={INPUT}
              autoComplete="off"
              spellCheck={false}
              placeholder="应用注册 Client ID"
            />
          </div>
          <div>
            <label htmlFor="rc-graph-secret" className={LABEL_STRONG}>
              Client Secret
            </label>
            <input
              id="rc-graph-secret"
              type="password"
              value={form.graphClientSecret}
              onChange={(e) => set({ graphClientSecret: e.target.value })}
              className={INPUT}
              autoComplete="off"
              spellCheck={false}
              placeholder="••••••••••••••••••••"
            />
          </div>
          <div>
            <label htmlFor="rc-graph-endpoint" className={LABEL_STRONG}>
              Graph Endpoint
            </label>
            <input
              id="rc-graph-endpoint"
              value={form.graphEndpoint}
              onChange={(e) => set({ graphEndpoint: e.target.value })}
              className={INPUT}
              autoComplete="off"
              spellCheck={false}
              placeholder="默认 https://graph.microsoft.com"
            />
          </div>
          <div>
            <label htmlFor="rc-graph-scope" className={LABEL_STRONG}>
              Graph Scope
            </label>
            <input
              id="rc-graph-scope"
              value={form.graphScope}
              onChange={(e) => set({ graphScope: e.target.value })}
              className={INPUT}
              autoComplete="off"
              spellCheck={false}
              placeholder="默认 {endpoint}/.default"
            />
          </div>
        </div>
      </section>
            </>
          ),
          search: (
            <>
      {/* ---- 全文搜索 ---- */}
      <section className="border border-brand-200 bg-surface p-5">
        <h3 className="text-sm font-semibold text-neutral-900">全文搜索</h3>
        <p className="mt-1 text-xs leading-5 text-neutral-400">
          前台搜索的检索引擎与候选规模。默认 PostgreSQL（pg_trgm，无需外部服务，Supabase 自带扩展）；
          数据量大后可切 Elasticsearch——填好下方地址与认证后保存即生效（无需重启），然后跑
          <code className="mx-1 bg-brand-50 px-1 py-0.5 text-brand-700">npm run search:reindex</code>
          全量重建索引。本组留空项回退读取旧 .env（SEARCH_ENGINE / ES_*），全部迁到后台后即可从 .env 删除。
        </p>
        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="rc-search-engine" className={LABEL_STRONG}>
              检索引擎
            </label>
            <select
              id="rc-search-engine"
              value={form.searchEngine}
              onChange={(e) => set({ searchEngine: e.target.value })}
              className={INPUT}
            >
              <option value="">跟随旧 .env / 默认 PostgreSQL</option>
              <option value="postgres">PostgreSQL（pg_trgm）</option>
              <option value="elasticsearch">Elasticsearch</option>
            </select>
            <p className="mt-1 text-xs text-neutral-400">
              切换 Elasticsearch 后新发布内容自动写入 ES；存量内容需跑 search:reindex 重建。
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="rc-es-url" className={LABEL_STRONG}>
                ES 地址
              </label>
              <input
                id="rc-es-url"
                value={form.esUrl}
                onChange={(e) => set({ esUrl: e.target.value })}
                className={INPUT}
                autoComplete="off"
                spellCheck={false}
                placeholder="https://your-cluster.es:9243"
              />
            </div>
            <div>
              <label htmlFor="rc-es-index" className={LABEL_STRONG}>
                ES 索引名
              </label>
              <input
                id="rc-es-index"
                value={form.esIndex}
                onChange={(e) => set({ esIndex: e.target.value })}
                className={INPUT}
                autoComplete="off"
                spellCheck={false}
                placeholder="默认 pixel-hub-resources"
              />
            </div>
            <div>
              <label htmlFor="rc-es-apikey" className={LABEL_STRONG}>
                API Key
              </label>
              <input
                id="rc-es-apikey"
                type="password"
                value={form.esApiKey}
                onChange={(e) => set({ esApiKey: e.target.value })}
                className={INPUT}
                autoComplete="off"
                spellCheck={false}
                placeholder="ApiKey 认证（与账号二选一）"
              />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:col-span-2">
              <div>
                <label htmlFor="rc-es-user" className={LABEL_STRONG}>
                  ES 用户名
                </label>
                <input
                  id="rc-es-user"
                  value={form.esUsername}
                  onChange={(e) => set({ esUsername: e.target.value })}
                  className={INPUT}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Basic 认证用"
                />
              </div>
              <div>
                <label htmlFor="rc-es-pass" className={LABEL_STRONG}>
                  ES 密码
                </label>
                <input
                  id="rc-es-pass"
                  type="password"
                  value={form.esPassword}
                  onChange={(e) => set({ esPassword: e.target.value })}
                  className={INPUT}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="••••••••••••"
                />
              </div>
            </div>
            <div>
              <label htmlFor="rc-es-analyzer" className={LABEL_STRONG}>
                分析器
              </label>
              <input
                id="rc-es-analyzer"
                value={form.esAnalyzer}
                onChange={(e) => set({ esAnalyzer: e.target.value })}
                className={INPUT}
                autoComplete="off"
                spellCheck={false}
                placeholder="中文生产建议 ik_max_word（留空 = 默认）"
              />
            </div>
            <div>
              <label htmlFor="rc-search-limit" className={LABEL_STRONG}>
                候选上限
              </label>
              <input
                id="rc-search-limit"
                type="number"
                min={1000}
                max={50000}
                value={form.searchCandidateLimit}
                onChange={(e) => set({ searchCandidateLimit: e.target.value })}
                className={INPUT}
                placeholder="默认 5000（1000–50000）"
              />
            </div>
          </div>
        </div>
      </section>
            </>
          ),
        }}
      />

      <div className="flex items-center gap-3">

        <Button type="button" onClick={save} disabled={pending} className={BTN_PRIMARY_SM}>
          {pending ? "保存中…" : "保存配置"}
        </Button>
        {message?.kind === "ok" && (
          <span className="text-xs text-emerald-700" role="status">
            {message.text}
          </span>
        )}
        {message?.kind === "error" && (
          <span className="text-xs text-red-600" role="alert">
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}
