// 统一下载面板 —— IMAGE/ARTICLE/GAME/MUSIC/VIDEO 均按 meta 分发，下载清单只存 meta.downloads；
// 版本历史功能已下线（ResourceVersion 表与 VersionSection 均已移除），本面板即唯一下载入口。
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
          ? "border-brand-300 bg-brand-50 text-brand-700"
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
    <section className="mt-6 rounded-none border border-brand-300 bg-surface p-5">
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

/** 逐行下载清单卡片 —— IMAGE 图包 / ARTICLE 附件 / MUSIC·VIDEO 下载源 / GAME 下载源共用同一形态。
 *  四个入口原来是四份字面相同的 JSX，收敛在这里；差异只有标题文案与外层留白。 */
function DownloadListCard({
  ctx,
  title,
  list,
  size = "sm",
}: {
  ctx: DetailCtx;
  title: string;
  list: { name: string; kind: "file" | "link"; url: string; size?: string }[];
  /** lg = 文章那种更松的留白（mt-8 / p-6），其余 mt-6 / p-5 */
  size?: "sm" | "lg";
}) {
  const { detail, authed } = ctx;
  if (list.length === 0) return null;
  return (
    <section
      className={`rounded-none border border-brand-300 bg-surface ${
        size === "lg" ? "mt-8 p-6" : "mt-6 p-5"
      }`}
    >
      <DownloadCountScope initial={detail.downloadCount}>
        <CardHead title={title} fallbackCount={detail.downloadCount} />
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

/** IMAGE：多附件图包/整套下载清单（新），逐行下载；区别于 GAME 版本表 */
function ImageDownloadsCard({
  ctx,
  list,
}: {
  ctx: DetailCtx;
  list: Extract<DetailCtx["meta"], { kind: "IMAGE" }>["downloads"];
}) {
  return <DownloadListCard ctx={ctx} title={`图包 / 整套下载（${list.length}）`} list={list} />;
}

/** ARTICLE：文末附件清单，逐行下载（区别于 GAME 版本历史） */
function ArticleAttachmentsCard({ ctx }: { ctx: DetailCtx }) {
  const { meta } = ctx;
  if (meta.kind !== "ARTICLE") return null;
  return (
    <DownloadListCard
      ctx={ctx}
      title={`附件（${meta.downloads.length}）`}
      list={meta.downloads}
      size="lg"
    />
  );
}

/** MUSIC / VIDEO：作者填写的「下载源」清单（meta.downloads 与其它类型同源）。
 *  与播放列表完全独立 —— 无损音轨、外挂字幕包、离线副本这类额外分发内容放这里。 */
function AvDownloadsCard({ ctx }: { ctx: DetailCtx }) {
  const { meta } = ctx;
  if (meta.kind !== "MUSIC" && meta.kind !== "VIDEO") return null;
  return (
    <DownloadListCard ctx={ctx} title={`下载源（${meta.downloads.length}）`} list={meta.downloads} />
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
  const { meta } = ctx;
  if (meta.kind !== "GAME") return null;
  const rows = meta.downloads.filter((d) => d.url);
  return (
    <DownloadListCard
      ctx={ctx}
      title={`游戏下载${rows.length > 1 ? `（${rows.length}）` : ""}`}
      list={rows}
    />
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
  // GAME：清单即唯一下载入口
  if (meta.kind === "GAME") return <GameExternalCard ctx={ctx} />;
  // MUSIC / VIDEO：额外下载源（空清单时卡片自身返回 null）
  if (meta.kind === "MUSIC" || meta.kind === "VIDEO") return <AvDownloadsCard ctx={ctx} />;
  return null;
}
