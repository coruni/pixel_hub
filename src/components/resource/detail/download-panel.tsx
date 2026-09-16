// 统一下载面板 —— IMAGE/ARTICLE/GAME 均按 meta 分发，GAME 读 meta.downloads 清单；
// GAME 不再渲染版本历史（VersionSection 对其返回 null），本面板即唯一下载入口。
// 服务端决定渲染什么（null = 无下载）；真正的下载/登录墙由客户端 MetaDownloadButton 处理。
// 下载次数是资源级单值，标在各清单的区块头（CardHead），不逐行重复。
import { Download, ExternalLink, FileText } from "lucide-react";
import { MetaDownloadButton } from "@/components/social/interactions";
import { DownloadCountLabel, DownloadCountScope } from "./download-count";
import type { DetailCtx } from "./parts";

function DlBadge({ kind }: { kind: "file" | "link" }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-none border px-2 py-0.5 text-[11px] font-medium ${
        kind === "file"
          ? "border-brand-200 bg-brand-50 text-brand-700"
          : "border-sky-200 bg-sky-50 text-sky-700"
      }`}
    >
      {kind === "file" ? <FileText size={11} aria-hidden /> : <ExternalLink size={11} aria-hidden />}
      {kind === "file" ? "附件" : "外链"}
    </span>
  );
}

/** 清单区块头：左标题、右下载次数（次数由 DownloadCountScope 提供，点下载即刻 +1） */
function CardHead({ title, fallbackCount }: { title: string; fallbackCount: number }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <h2 className="text-sm font-semibold text-neutral-400">{title}</h2>
      <DownloadCountLabel fallback={fallbackCount} />
    </div>
  );
}

/** IMAGE：单条「图包 / 整套」主下载（无版本表，区别于 GAME） */
function ImageDownloadCard({
  ctx,
  dl,
}: {
  ctx: DetailCtx;
  dl: Extract<DetailCtx["meta"], { kind: "IMAGE" }>["download"];
}) {
  const { detail, authed } = ctx;
  return (
    <section className="mt-6 rounded-none border border-brand-200 bg-surface p-5">
      <DownloadCountScope initial={detail.downloadCount}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs text-neutral-400">
              <Download size={13} aria-hidden /> 图包下载
            </p>
            {(dl.fileName || dl.size) && (
              <p className="mt-1 truncate text-sm text-neutral-700">
                {dl.fileName}
                {dl.fileName && dl.size ? " · " : ""}
                {dl.size}
              </p>
            )}
            <p className="mt-0.5">
              <DownloadCountLabel fallback={detail.downloadCount} />
            </p>
          </div>
          <MetaDownloadButton
            resourceId={detail.id}
            url={dl.url}
            name={dl.fileName}
            kind={dl.mode === "file" ? "file" : "link"}
            label="下载"
            loginRequired={detail.loginRequired}
            authed={authed}
            callbackPath={`/resources/${detail.slug}`}
          />
        </div>
      </DownloadCountScope>
    </section>
  );
}

/** IMAGE：多附件图包/整套下载清单（新），逐行下载；区别于 GAME 版本表 */
function ImageDownloadsCard({
  ctx,
  list,
}: {
  ctx: DetailCtx;
  list: Extract<DetailCtx["meta"], { kind: "IMAGE" }>["downloads"];
}) {
  const { detail, authed } = ctx;
  return (
    <section className="mt-6 rounded-none border border-brand-200 bg-surface p-5">
      <DownloadCountScope initial={detail.downloadCount}>
        <CardHead title={`图包 / 整套下载（${list.length}）`} fallbackCount={detail.downloadCount} />
        <ul className="mt-3 divide-y divide-neutral-100">
          {list.map((a, i) => (
            <li
              key={i}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
            >
              <DlBadge kind={a.kind} />
              <span className="min-w-0 flex-1 truncate text-sm text-neutral-800">{a.name}</span>
              {a.size && <span className="shrink-0 text-xs text-neutral-400">{a.size}</span>}
              <MetaDownloadButton
                resourceId={detail.id}
                url={a.url}
                name={a.name}
                kind={a.kind}
                label="下载"
                small
                loginRequired={detail.loginRequired}
                authed={authed}
                callbackPath={`/resources/${detail.slug}`}
              />
            </li>
          ))}
        </ul>
      </DownloadCountScope>
    </section>
  );
}

/** ARTICLE：文末附件清单，逐行下载（区别于 GAME 版本历史） */
function ArticleAttachmentsCard({ ctx }: { ctx: DetailCtx }) {
  const { detail, meta, authed } = ctx;
  if (meta.kind !== "ARTICLE") return null;
  const list = meta.downloads;
  if (list.length === 0) return null;
  return (
    <section className="mt-8 rounded-none border border-brand-200 bg-surface p-6">
      <DownloadCountScope initial={detail.downloadCount}>
        <CardHead title={`附件（${list.length}）`} fallbackCount={detail.downloadCount} />
        <ul className="mt-3 divide-y divide-neutral-100">
          {list.map((a, i) => (
            <li
              key={i}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
            >
              <DlBadge kind={a.kind} />
              <span className="min-w-0 flex-1 truncate text-sm text-neutral-800">{a.name}</span>
              {a.size && <span className="shrink-0 text-xs text-neutral-400">{a.size}</span>}
              <MetaDownloadButton
                resourceId={detail.id}
                url={a.url}
                name={a.name}
                kind={a.kind}
                label="下载"
                small
                loginRequired={detail.loginRequired}
                authed={authed}
                callbackPath={`/resources/${detail.slug}`}
              />
            </li>
          ))}
        </ul>
      </DownloadCountScope>
    </section>
  );
}

/** GAME：作者填写的下载源清单（meta.downloads 是唯一存储）。
 *  样式对齐图包下载清单：同款标题行 + 徽标行 + 小号下载按钮。
 *
 *  注意：这里**不能**用 detail.externalUrl 当首行——它只是 meta.downloads[0].url 的冗余副本
 *  （发布/改稿时由清单首条推导，见 actions/resource.ts 的 externalUrlFromDownloads），
 *  单独渲染它会丢掉用户在清单里给首条起的标题，表现为「附件有标题却显示游戏本体」。
 *  externalUrl 仍保留在资源表上，供下载计数守卫与 /api/dl 代理使用，但不参与展示。 */
function GameExternalCard({ ctx }: { ctx: DetailCtx }) {
  const { detail, authed } = ctx;
  if (ctx.meta.kind !== "GAME") return null;
  const rows = ctx.meta.downloads.filter((d) => d.url);
  if (rows.length === 0) return null;
  return (
    <section className="mt-6 rounded-none border border-brand-200 bg-surface p-5">
      <DownloadCountScope initial={detail.downloadCount}>
        <CardHead
          title={`游戏下载${rows.length > 1 ? `（${rows.length}）` : ""}`}
          fallbackCount={detail.downloadCount}
        />
        <ul className="mt-3 divide-y divide-neutral-100">
          {rows.map((r, i) => (
            <li
              key={i}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
            >
              <DlBadge kind={r.kind} />
              <span className="min-w-0 flex-1 truncate text-sm text-neutral-800">{r.name}</span>
              {r.size && <span className="shrink-0 text-xs text-neutral-400">{r.size}</span>}
              <MetaDownloadButton
                resourceId={detail.id}
                url={r.url}
                name={r.name}
                kind={r.kind}
                label="下载"
                small
                loginRequired={detail.loginRequired}
                authed={authed}
                callbackPath={`/resources/${detail.slug}`}
              />
            </li>
          ))}
        </ul>
      </DownloadCountScope>
    </section>
  );
}

export function DownloadPanel({ ctx }: { ctx: DetailCtx }) {
  const { meta } = ctx;
  // IMAGE：多附件图包/整套优先（新）；旧单 download 回退兼容
  if (meta.kind === "IMAGE") {
    if (meta.downloads.length > 0) return <ImageDownloadsCard ctx={ctx} list={meta.downloads} />;
    if (meta.download.mode !== "none" && meta.download.url)
      return <ImageDownloadCard ctx={ctx} dl={meta.download} />;
    return null;
  }
  // ARTICLE 附件清单
  if (meta.kind === "ARTICLE") return <ArticleAttachmentsCard ctx={ctx} />;
  // GAME：清单即唯一下载入口（VersionSection 对 GAME 隐藏）
  if (meta.kind === "GAME") return <GameExternalCard ctx={ctx} />;
  return null;
}
