// 统一下载面板 —— IMAGE/ARTICLE 按 meta 分发，GAME 走 externalUrl 外链；版本历史由 VersionSection 单独渲染。
// 服务端决定渲染什么（null = 无下载）；真正的下载/登录墙由客户端 MetaDownloadButton 处理。
import { Download, ExternalLink, FileText } from "lucide-react";
import { formatCount } from "@/lib/format";
import { MetaDownloadButton } from "@/components/social/interactions";
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
          <p className="mt-0.5 text-xs text-neutral-400">已下载 {formatCount(detail.downloadCount)} 次</p>
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
      <h2 className="text-sm font-semibold text-neutral-400">图包 / 整套下载（{list.length}）</h2>
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
      <h2 className="text-sm font-semibold text-neutral-400">附件（{list.length}）</h2>
      <ul className="mt-3 divide-y divide-neutral-100">
        {list.map((a, i) => (
          <li key={i} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
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
    </section>
  );
}

/** GAME：作者填写的下载源清单（externalUrl 为必填主源，meta.downloads 追加其余）；
 *  样式对齐图包下载清单：同款标题行 + 徽标行 + 小号下载按钮。
 *  版本历史由 VersionSection 单独渲染，两者各自可达、互不替代。 */
function GameExternalCard({ ctx }: { ctx: DetailCtx }) {
  const { detail, authed } = ctx;
  if (!detail.externalUrl) return null;
  const version = ctx.meta.kind === "GAME" ? ctx.meta.version : undefined;
  const versionText = version ? `版本 ${version}` : "游戏本体";
  // 主源用 externalUrl（必填、未被删除保护），其余清单项按 url 去重后追加
  const extra =
    ctx.meta.kind === "GAME"
      ? ctx.meta.downloads.filter((d) => d.url && d.url !== detail.externalUrl)
      : [];
  const rows = [
    { name: versionText, url: detail.externalUrl },
    ...extra.map((d) => ({ name: d.name || versionText, url: d.url })),
  ];
  return (
    <section className="mt-6 rounded-none border border-brand-200 bg-surface p-5">
      <h2 className="text-sm font-semibold text-neutral-400">
        游戏下载{rows.length > 1 ? `（${rows.length}）` : ""}
      </h2>
      <ul className="mt-3 divide-y divide-neutral-100">
        {rows.map((r, i) => (
          <li
            key={i}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
          >
            <DlBadge kind="link" />
            <span className="min-w-0 flex-1 truncate text-sm text-neutral-800">{r.name}</span>
            {i === 0 && (
              <span className="shrink-0 text-xs text-neutral-400">
                已下载 {formatCount(detail.downloadCount)} 次
              </span>
            )}
            <MetaDownloadButton
              resourceId={detail.id}
              url={r.url}
              kind="link"
              label="下载"
              small
              loginRequired={detail.loginRequired}
              authed={authed}
              callbackPath={`/resources/${detail.slug}`}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function DownloadPanel({ ctx }: { ctx: DetailCtx }) {
  const { meta, detail } = ctx;
  // IMAGE：多附件图包/整套优先（新）；旧单 download 回退兼容
  if (meta.kind === "IMAGE") {
    if (meta.downloads.length > 0) return <ImageDownloadsCard ctx={ctx} list={meta.downloads} />;
    if (meta.download.mode !== "none" && meta.download.url)
      return <ImageDownloadCard ctx={ctx} dl={meta.download} />;
    return null;
  }
  // ARTICLE 附件清单
  if (meta.kind === "ARTICLE") return <ArticleAttachmentsCard ctx={ctx} />;
  // GAME：externalUrl 外链主下载；版本历史另行渲染（VersionSection）
  if (meta.kind === "GAME" && detail.externalUrl) return <GameExternalCard ctx={ctx} />;
  return null;
}
