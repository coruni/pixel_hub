"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { FileText, Link as LinkIcon, Plus, Settings2, Trash2, UploadCloud, X } from "lucide-react";
import {
  attachmentExtsSample,
  mbText,
  type UploadLimits,
} from "@/lib/upload-config";
import { uploadAttachment } from "@/lib/upload-attachment-client";
import { wizInput, wizLabel, SectionTitle, STEP } from "./wizard-shared";
import { AttachmentUpload } from "./AttachmentUpload";
import { useFileDrop } from "@/lib/hooks/use-file-drop";
import { SquareCheckbox } from "../admin/SquareCheckbox";
import { Button } from "@/components/ui/Button";

/** 下载源清单行的初始值（已有版本记录回填用） */
export type InitialDownload = { name: string; url: string; note?: string };

export function GameSection({
  downloads,
  fieldErrors,
  limits,
  showChangelog = false,
  onBusyChange,
}: {
  /** 已有下载源（改稿时来自 resourceVersions）；发布时为空 */
  downloads?: InitialDownload[];
  fieldErrors?: Record<string, string[]>;
  limits: UploadLimits;
  /** 仅发布时创建版本记录需要更新日志；改稿不复用版本，故默认隐藏 */
  showChangelog?: boolean;
  /** 上传任务数量变化：宿主据此禁用提交 */
  onBusyChange?: (busy: number) => void;
}) {
  // 下载源清单是 GAME 唯一的下载入口（原来的「下载外链」必填项已并入本清单）
  const [rows, setRows] = useState<AttachRow[]>(() =>
    (downloads ?? []).map((d) => ({
      key: uid(),
      name: d.name,
      kind: "link" as const,
      url: d.url,
      size: "",
    })),
  );

  return (
    <section className="mt-4 space-y-4 rounded-none border border-brand-200 bg-surface p-5">
      <SectionTitle n={STEP.TYPE}>游戏信息</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={wizLabel} htmlFor="version">
            版本
          </label>
          <input
            id="version"
            name="version"
            maxLength={40}
            placeholder="v1.2.3"
            className={wizInput}
          />
        </div>
        <div>
          <label className={wizLabel} htmlFor="lang">
            语言
          </label>
          <input
            id="lang"
            name="lang"
            maxLength={40}
            placeholder="简体中文 / English…"
            className={wizInput}
          />
        </div>
      </div>
      {showChangelog && (
        <div>
          <label className={wizLabel} htmlFor="changelog">
            更新日志
          </label>
          <textarea
            id="changelog"
            name="changelog"
            rows={3}
            maxLength={2000}
            placeholder="这个版本包含什么内容…"
            className={wizInput}
          />
        </div>
      )}
      <div>
        <label className={wizLabel} htmlFor="platforms">
          平台
        </label>
        <input
          id="platforms"
          name="platforms"
          maxLength={100}
          placeholder="Windows / Android / Switch…"
          className={wizInput}
        />
      </div>
      <div className="rounded-none border border-brand-200 p-4">
        <p className="text-sm font-medium text-neutral-700">
          下载源<span className="text-red-500">*</span>
        </p>
        <AttachmentListEditor
          rows={rows}
          setRows={setRows}
          limits={limits}
          errors={fieldErrors?.downloads}
          addLinkLabel="添加附件"
          showSize={false}
          emptyHint="还没有下载源，至少添加一条才能发布"
          onBusyChange={onBusyChange}
        />
      </div>
    </section>
  );
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/** 附件直传：OneDrive 走浏览器分片直传，其他存储回退既有 API */
async function postAttachment(
  file: File,
): Promise<{ url: string; name: string; size: number } | null> {
  try {
    return await uploadAttachment(file);
  } catch {
    return null;
  }
}

/** 按后缀给文件配一个中性色调，纯装饰、不参与信息表达 */
const EXT_TONES = [
  "bg-brand-50 text-brand-700",
  "bg-stone-100 text-stone-600",
  "bg-sky-50 text-sky-700",
  "bg-emerald-50 text-emerald-700",
  "bg-amber-50 text-amber-700",
] as const;

function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,12})$/.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

/** 无后缀时按文件名长度兜底配色，保证同一文件每次渲染颜色稳定 */
function extTone(name: string): string {
  const ext = extOf(name);
  if (!ext) return EXT_TONES[name.length % EXT_TONES.length];
  let sum = 0;
  for (let i = 0; i < ext.length; i += 1) sum += ext.charCodeAt(i);
  return EXT_TONES[sum % EXT_TONES.length];
}

export type AttachRow = {
  key: string;
  name: string;
  kind: "file" | "link";
  url: string;
  size: string;
};

let uidSeed = 0;
const uid = () => `att-${++uidSeed}-${Math.random().toString(36).slice(2, 8)}`;

/** 图片类后缀：抽屉里给缩略图预览（URL 是图片时才敢直接渲染） */
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp", "ico"]);

/**
 * 多附件清单编辑器：IMAGE「整包/图包」、ARTICLE「文末清单」、GAME「下载源」共用。
 * 站内附件上传 + 网盘外链逐行增删；每行独立 kind，切换/增删互相隔离，不会串数据。
 * 隐藏字段 downloads 由本组件受控序列化（客户端唯一来源）。
 */
export function AttachmentListEditor({
  rows,
  setRows,
  limits,
  errors,
  addLinkLabel = "添加附件",
  showSize = true,
  emptyHint,
  onBusyChange,
}: {
  rows: AttachRow[];
  setRows: Dispatch<SetStateAction<AttachRow[]>>;
  limits: UploadLimits;
  errors?: string[];
  addLinkLabel?: string;
  /** GAME 下载源不展示「大小」列（体积配置已从发布页移除） */
  showSize?: boolean;
  /** 清单为空时显示的占位提示（GAME 下载源必填，给出明确指引） */
  emptyHint?: string;
  /** 上传中数量变化时通知宿主：宿主据此禁用提交按钮 */
  onBusyChange?: (busy: number) => void;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  /** 在飞的上传任务数。>0 表示本次发布还不能提交 */
  const [inflight, setInflight] = useState(0);
  /** 上传进度（已完成/总数），仅用于投放区文案 */
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);

  /**
   * 抽屉编辑的是「草稿」而不是清单里的行：
   * - open = 清单里已有行的下标（编辑既有条）
   * - draft = 新增中、尚未进入清单的草稿
   * 二者互斥。只有用户点「添加」且内容有效时才落进 rows，所以「点一下按钮就多一条空行」
   * 的情况不存在了。关掉抽屉不会中断上传，任务完成后照样进清单。
   */
  const [open, setOpen] = useState<number | null>(null);
  const [draft, setDraft] = useState<AttachRow | null>(null);
  /** 打开抽屉前的触发元素，关闭后把焦点还回去（键盘流不断） */
  const openerRef = useRef<HTMLElement | null>(null);
  /** 本次会话累计的完成数 / 总数，用于投放区进度文案 */
  const doneRef = useRef(0);
  const totalRef = useRef(0);
  /** 「抽屉是否被占用」镜像：上传回调是 async，读 state 会拿到旧值 */
  const drawerHeldRef = useRef(false);

  const isNew = draft != null;
  const editing = isNew ? draft : open == null ? null : (rows[open] ?? null);
  const editingIndex = isNew ? rows.length : (open ?? 0);
  const busy = inflight > 0;

  /**
   * 投放区拖拽：拖入整块区域即进入高亮，松手直接上传。
   * 注意 disabled 只跟「清单已满」挂钩，不跟上传中挂钩——上传中可以继续拖入新文件排队，
   * 否则「关掉抽屉后继续上传」就无从操作。
   */
  const { dragging, dropProps } = useFileDrop({ onFiles, disabled: rows.length >= 20 });

  // 把「是否还有上传在飞」同步给宿主，供提交按钮禁用
  useEffect(() => {
    onBusyChange?.(inflight);
  }, [inflight, onBusyChange]);

  // 抽屉占用镜像：上传与关抽屉都可能发生在 await 之间
  useEffect(() => {
    drawerHeldRef.current = isNew || open !== null;
  }, [isNew, open]);

  function closeDrawer() {
    setOpen(null);
    setDraft(null);
    openerRef.current?.focus();
    openerRef.current = null;
  }

  function openDrawer(i: number, e: React.MouseEvent<HTMLElement>) {
    openerRef.current = e.currentTarget;
    setDraft(null);
    setOpen(i);
  }

  /** 新增外链条目：开一条外链草稿，不碰清单 */
  function startAddLink(e: React.MouseEvent<HTMLElement>) {
    if (rows.length >= 20) return;
    openerRef.current = e.currentTarget;
    setOpen(null);
    setMsg(null);
    setDraft({ key: uid(), kind: "link", name: "", url: "", size: "" });
  }

  /** 抽屉里改字段：新增中改草稿，编辑既有改对应行 */
  function patchEditing(part: Partial<Omit<AttachRow, "key">>, files?: { url: string; size: string }) {
    if (isNew) {
      setDraft((d) => (d ? { ...d, ...part, ...files } : d));
      return;
    }
    if (open != null) patch(open, { ...part, ...files });
  }

  /** 草稿落地：有文件名或地址才算有效，否则丢弃（避免产生空行） */
  function commitDraft() {
    if (!draft) return;
    const filled = draft.name.trim() || draft.url.trim();
    if (!filled) {
      closeDrawer();
      setMsg("请先选择文件或填写下载地址");
      return;
    }
    const next: AttachRow = {
      ...draft,
      // 站内附件已带文件名；外链没写标题时退回用地址兜底，避免出现无标题行
      name: draft.name.trim() || draft.url.trim(),
    };
    setRows((p) => (p.length >= 20 ? p : [...p, next]));
    closeDrawer();
  }

  function patch(i: number, part: Partial<Omit<AttachRow, "key">>) {
    setRows((p) => p.map((r, idx) => (idx === i ? { ...r, ...part } : r)));
  }

  function remove(i: number) {
    setRows((p) => p.filter((_, idx) => idx !== i));
    // 删的就是抽屉里那条：关掉抽屉，避免编辑一个已不存在的下标
    if (open === i) closeDrawer();
    else if (open != null && open > i) setOpen(open - 1);
  }

  /**
   * 附件↔外链：切外链时清空 URL（它指向站内路径，不是可编辑的外链）。
   * 草稿态直接改草稿；既有行改对应行。
   */
  function switchKind(kind: AttachRow["kind"]) {
    patchEditing({ kind, url: "", size: "" });
  }

  /**
   * 投放区上传入口。上传任务与抽屉解耦：
   * - 拖入即开始上传，不等抽屉；关掉抽屉也不中断（在飞任务照常跑完）。
   * - 每个文件完成后立刻成为清单里的一行（标题/地址/大小已齐），
   *   并在抽屉空闲时自动打开它，方便顺手改标题。
   * - 串行执行：批量并发容易在反代/云盘侧触发限流。
   *
   * 上传中可以继续拖入：新一批与旧一批各自跑串行循环，进度用「累计」而非每批重置，
   * 否则后拖入的一批会把前一批的计数冲掉。
   */
  async function onFiles(files: FileList) {
    const picked = Array.from(files);
    if (picked.length === 0) return;
    setMsg(null);
    totalRef.current += picked.length;
    setInflight((n) => n + picked.length);
    setBatch({ done: doneRef.current, total: totalRef.current });
    for (const f of picked) {
      // 单张失败只提示、不打断同批其余文件
      const r = await postAttachment(f);
      doneRef.current += 1;
      if (!r) {
        setMsg("有附件上传失败，请重试");
      } else {
        const row: AttachRow = {
          key: uid(),
          kind: "file",
          name: r.name,
          url: r.url,
          size: formatBytes(r.size),
        };
        setRows((p) => (p.length >= 20 ? p : [...p, row]));
        // 抽屉空闲才自动弹出：用户正开着的抽屉（无论编辑哪条）不抢焦点
        if (!drawerHeldRef.current) setDraft(row);
      }
      setBatch({ done: doneRef.current, total: totalRef.current });
      setInflight((n) => Math.max(0, n - 1));
    }
    // 全部落地后收尾：重置累计计数，投放区回到常态文案
    if (doneRef.current >= totalRef.current) {
      doneRef.current = 0;
      totalRef.current = 0;
      setBatch(null);
    }
  }

  const payload = rows
    .filter((r) => r.name.trim() || r.url.trim())
    .map((r) => ({
      name: r.name.trim(),
      kind: r.kind,
      url: r.url.trim(),
      size: r.size.trim() || undefined,
    }));

  const addBtn =
    "inline-flex items-center gap-1.5 rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs text-neutral-600 transition hover:border-brand-400 hover:text-neutral-900 disabled:opacity-50";

  return (
    <>
      {errors && errors.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {errors.map((e, i) => (
            <li key={i} className="text-xs text-red-600">
              {e}
            </li>
          ))}
        </ul>
      )}
      {emptyHint && rows.length === 0 && (
        <p className="mt-2 text-xs text-neutral-400">{emptyHint}</p>
      )}

      {/* 主入口：整块投放区，拖进来或点一下都行。上传完成（或外链填完）才出现上面的清单行 */}
      <div className="mt-3">
        <AttachmentUpload
          variant="dropzone"
          multiple
          onFiles={onFiles}
          limits={limits}
          progress={batch}
          dragging={dragging}
          dropProps={dropProps}
          label={busy ? "继续拖入或点击可追加附件" : "拖入或点击上传附件"}
          hint="可多选"
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={startAddLink}
          disabled={rows.length >= 20}
          className={addBtn}
          aria-haspopup="dialog"
        >
          <Plus size={13} aria-hidden /> {addLinkLabel}
        </Button>
        <span className="text-xs tabular-nums text-neutral-400">{rows.length}/20</span>
        {busy && batch && (
          <span className="text-xs tabular-nums text-neutral-500">
            上传中 {batch.done}/{batch.total}
          </span>
        )}
        {msg && <span className="text-xs text-amber-600">{msg}</span>}
      </div>
      {rows.length > 0 && (
        <ul className="mt-3 space-y-2">
          {rows.map((r, i) => {
            const ext = r.kind === "file" ? extOf(r.name) : "";
            return (
              <li
                key={r.key}
                className="flex min-w-0 items-center gap-2.5 rounded-none border border-brand-200 bg-surface p-2.5"
              >
                <span
                  aria-hidden
                  className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-none border border-black/5 text-[10px] font-semibold uppercase ${extTone(r.name)}`}
                >
                  {ext ? ext.slice(0, 4) : <FileText size={14} />}
                </span>

                {/* 标题就地可改：列表本身承担重命名，不必为改个名进抽屉 */}
                <input
                  value={r.name}
                  onChange={(e) => patch(i, { name: e.target.value })}
                  maxLength={120}
                  required
                  placeholder="附件名"
                  aria-label={`第 ${i + 1} 条：附件名`}
                  className="min-w-0 flex-1 rounded-none border border-transparent bg-transparent px-1.5 py-1 text-sm text-neutral-800 transition hover:border-brand-200 focus:border-brand-500 focus:bg-surface focus:outline-none"
                />

                <span className="hidden max-w-56 truncate text-xs text-neutral-400 sm:block" title={r.url}>
                  {r.url || "未填写地址"}
                </span>

                <Button
                  type="button"
                  onClick={(e) => openDrawer(i, e)}
                  aria-label={`设置第 ${i + 1} 条`}
                  aria-haspopup="dialog"
                  className="shrink-0 rounded-none p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900"
                >
                  <Settings2 size={15} />
                </Button>
                <Button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label={`移除第 ${i + 1} 条`}
                  className="shrink-0 rounded-none p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 size={15} />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {/* 附件清单隐藏字段（单 JSON，客户端受控 state 序列化，规避多兄弟 key 顺序脆弱） */}
      <input type="hidden" name="downloads" value={JSON.stringify(payload)} />

      {editing && (
        <AttachmentDrawer
          row={editing}
          index={editingIndex}
          limits={limits}
          showSize={showSize}
          isNew={isNew}
          uploading={busy}
          onPatch={patchEditing}
          onSwitchKind={switchKind}
          onUpload={onFiles}
          onCommit={commitDraft}
          onClose={closeDrawer}
        />
      )}
    </>
  );
}

/**
 * 单条附件的设置抽屉：来源（站内/外链）、上传/地址、大小都收在这里。
 * 上传入口只在「站内附件」来源下出现，且长在抽屉内部——外部不再单独摆按钮。
 * `isNew` 为 true 时是尚未落库的草稿，底部主按钮变「添加」，点了才进清单。
 */
function AttachmentDrawer({
  row,
  index,
  limits,
  showSize,
  isNew = false,
  uploading = false,
  onPatch,
  onSwitchKind,
  onUpload,
  onCommit,
  onClose,
}: {
  row: AttachRow;
  index: number;
  limits: UploadLimits;
  showSize: boolean;
  /** 草稿态：内容尚未进入清单 */
  isNew?: boolean;
  uploading?: boolean;
  onPatch: (part: Partial<Omit<AttachRow, "key">>, files?: { url: string; size: string }) => void;
  onSwitchKind: (kind: AttachRow["kind"]) => void;
  onUpload: (files: FileList) => void;
  onCommit: () => void;
  onClose: () => void;
}) {
  const ext = extOf(row.name);
  const isImage = row.kind === "link" && IMAGE_EXTS.has(ext);

  /**
   * 抽屉内的投放区：与外层投放区同一套交互（拖入高亮、松手即传、点击兜底）。
   * 这里的 onFiles 走同一个上传入口，所以拖进抽屉的文件照样排队、照样落清单。
   * 关闭抽屉不会中断任务；不做「清单已满」限制——外层已满时 onFiles 会拒绝落行。
   */
  const { dragging: dragOver, dropProps: dropOn } = useFileDrop({ onFiles: onUpload });

  // Esc 关闭 + 锁背景滚动：与站内其他弹层保持同一套行为
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const segBtn = (on: boolean) =>
    `flex-1 rounded-none border px-3 py-2 text-xs transition ${
      on
        ? "border-brand-500 bg-brand-50 font-medium text-brand-700"
        : "border-brand-200 bg-surface text-neutral-600 hover:border-brand-400"
    }`;
  const fieldCls =
    "w-full rounded-none border border-brand-200 bg-surface px-2.5 py-2 text-sm text-neutral-800 focus:border-brand-500 focus:outline-none";

  return (
    <>
      <div className="fixed inset-0 z-40 bg-stone-900/40" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`第 ${index + 1} 条附件的设置`}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col rounded-none border-l border-brand-200 bg-panel shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-brand-200 px-4 py-3">
          <p className="text-sm font-medium text-neutral-900">
            {isNew ? "添加附件" : `第 ${index + 1} 条附件`}
          </p>
          <Button
            type="button"
            onClick={onClose}
            aria-label="关闭设置"
            className="rounded-none p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900"
          >
            <X size={16} />
          </Button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          <div role="group" aria-label="来源">
            <p className={wizLabel}>来源</p>
            <div className="mt-1.5 flex gap-2">
              <Button
                type="button"
                onClick={() => onSwitchKind("file")}
                className={segBtn(row.kind === "file")}
              >
                <UploadCloud size={13} aria-hidden className="mr-1.5 inline" />
                站内附件
              </Button>
              <Button
                type="button"
                onClick={() => onSwitchKind("link")}
                className={segBtn(row.kind === "link")}
              >
                <LinkIcon size={13} aria-hidden className="mr-1.5 inline" />
                网盘外链
              </Button>
            </div>
          </div>

          {/* 站内附件：抽屉本身就是投放区，拖入或点击都能传（与外层投放区同一条上传链路） */}
          {row.kind === "file" && (
            <div>
              <p className={wizLabel}>文件</p>
              <div className="mt-1.5">
                <AttachmentUpload
                  variant="dropzone"
                  onFiles={onUpload}
                  limits={limits}
                  uploading={uploading}
                  dragging={dragOver}
                  dropProps={dropOn}
                  filled={row.url.startsWith("/")}
                  label={row.url ? "拖入或点击更换文件" : "拖入或点击上传附件"}
                />
              </div>
            </div>
          )}

          <div>
            <label className={wizLabel} htmlFor="att-name">
              标题
            </label>
            <input
              id="att-name"
              value={row.name}
              onChange={(e) => onPatch({ name: e.target.value })}
              maxLength={120}
              placeholder="展示给下载者的名称"
              className={`mt-1.5 ${fieldCls}`}
            />
          </div>

          {row.kind === "link" && (
            <div>
              <label className={wizLabel} htmlFor="att-url">
                下载地址
              </label>
              <input
                id="att-url"
                value={row.url}
                onChange={(e) => onPatch({ url: e.target.value })}
                maxLength={2000}
                placeholder="https://pan.xxx/… 或官网直链"
                className={`mt-1.5 ${fieldCls}`}
              />
              {isImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={row.url}
                  alt="链接预览"
                  className="mt-2 max-h-32 w-full rounded-none border border-brand-200 object-cover"
                />
              )}
            </div>
          )}

          {showSize && (
            <div>
              <label className={wizLabel} htmlFor="att-size">
                大小
              </label>
              <input
                id="att-size"
                value={row.size}
                onChange={(e) => onPatch({ size: e.target.value })}
                maxLength={40}
                placeholder="如 1.2 GB"
                className={`mt-1.5 ${fieldCls}`}
              />
            </div>
          )}

          <p className="text-xs leading-5 text-neutral-400">
            站内附件受后台限制：{attachmentExtsSample(limits.attachmentExts, 8)} 等格式，单文件上限{" "}
            {mbText(limits.attachmentMaxMb)}；网盘外链无格式限制。
          </p>
        </div>

        <footer className="border-t border-brand-200 p-4">
          <Button
            type="button"
            onClick={isNew ? onCommit : onClose}
            className="w-full rounded-none border border-brand-600 bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-600"
          >
            {isNew ? "添加" : "完成"}
          </Button>
        </footer>
      </aside>
    </>
  );
}

/** IMAGE 整包/图包下载（可选）：站内附件(zip) 或 网盘外链，多附件清单；区别于 GAME 版本表 */
export function ImageSection({
  initial,
  fieldErrors,
  limits,
  onBusyChange,
}: {
  initial?: {
    isAiGenerated?: boolean;
    original?: boolean;
    downloads?: { name: string; kind: "file" | "link"; url: string; size?: string }[];
  };
  fieldErrors?: Record<string, string[]>;
  limits: UploadLimits;
  /** 上传任务数量变化：宿主据此禁用提交 */
  onBusyChange?: (busy: number) => void;
}) {
  const [rows, setRows] = useState<AttachRow[]>(
    (initial?.downloads ?? []).map((d) => ({
      key: uid(),
      name: d.name,
      kind: d.kind,
      url: d.url,
      size: d.size ?? "",
    })),
  );

  return (
    <section className="mt-4 space-y-4 rounded-none border border-brand-200 bg-surface p-5">
      <SectionTitle n={STEP.TYPE} tail={<span className="font-normal text-neutral-400">D2 声明</span>}>
        图片信息
      </SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 rounded-none border border-brand-200 px-3 py-2.5 text-sm text-neutral-700">
          <SquareCheckbox name="isAiGenerated" defaultChecked={initial?.isAiGenerated} ariaLabel="由 AI 生成" />
          由 AI 生成
        </label>
        <label className="flex items-center gap-2 rounded-none border border-brand-200 px-3 py-2.5 text-sm text-neutral-700">
          <SquareCheckbox name="original" defaultChecked={initial?.original} ariaLabel="本人原创" />
          本人原创
        </label>
      </div>

      <div className="rounded-none border border-brand-200 p-4">
        <p className="text-sm font-medium text-neutral-700">图包下载</p>
        {/* <p className="mt-0.5 text-xs text-neutral-400">
          可放原画集或网盘链接，没有就跳过。
        </p> */}
        <AttachmentListEditor
          rows={rows}
          setRows={setRows}
          limits={limits}
          errors={fieldErrors?.downloads}
          onBusyChange={onBusyChange}
        />
      </div>
    </section>
  );
}

/** ARTICLE 文末附件清单（可选）：站内附件 / 网盘外链多行，逐行展示于详情页底部 */
export function ArticleSection({
  initial,
  fieldErrors,
  limits,
  onBusyChange,
}: {
  initial?: { downloads?: { name: string; kind: "file" | "link"; url: string; size?: string }[] };
  fieldErrors?: Record<string, string[]>;
  limits: UploadLimits;
  /** 上传任务数量变化：宿主据此禁用提交 */
  onBusyChange?: (busy: number) => void;
}) {
  const [rows, setRows] = useState<AttachRow[]>(
    (initial?.downloads ?? []).map((d) => ({
      key: uid(),
      name: d.name,
      kind: d.kind,
      url: d.url,
      size: d.size ?? "",
    })),
  );

  return (
    <section className="mt-4 space-y-4 rounded-none border border-brand-200 bg-surface p-5">
      <SectionTitle n={STEP.TYPE}>附件下载</SectionTitle>

      {/* 与 GAME「下载源」用同一个容器形态（描边盒 + 小标题 + 清单编辑器），
          按钮文案/大小列/空态提示全部对齐，不留「文章一套、游戏一套」的观感差。
          文末清单可选，故标题不带必填星号，空态说明「可选」。 */}
      <div className="rounded-none border border-brand-200 p-4">
        <p className="text-sm font-medium text-neutral-700">下载源</p>
        <AttachmentListEditor
          rows={rows}
          setRows={setRows}
          limits={limits}
          errors={fieldErrors?.downloads}
          addLinkLabel="添加附件"
          showSize={false}
          emptyHint="可选：需要额外下载内容时再添加"
          onBusyChange={onBusyChange}
        />
      </div>
    </section>
  );
}
