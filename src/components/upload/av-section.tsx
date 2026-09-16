"use client";

// 音乐 / 视频分节 —— 发布向导与后台改稿共用。
//
// 两种上传模式（用户要的「上传模式选择」）：
//   ① 在线挂载：只填地址，不落存储；直链用原生播放器，页面地址用 iframe 嵌入
//   ② 上传文件：文件走上传接口，去向由服务端按运行配置决定，前端不判断
// 两种模式互斥由 source 单选控制，切换时保留已填 URL，避免手滑丢输入。
//
// 信息抓取：选文件后自动读取内嵌标签（音频 ID3/MP4）与时长、分辨率；挂载直链时读时长与分辨率。
// 自动读到的值只填「空字段」，用户手改过的字段不再覆盖。

import { useCallback, useEffect, useRef, useState } from "react";
import { Link2, Trash2, UploadCloud } from "lucide-react";
import {
  avExtsSample,
  avMountPlaceholder,
  avClassFor,
  suggestMode,
  type AvKind,
  type AvMode,
  type AvSource,
} from "@/lib/av";
import { probeFile, probeSummary, probeUrl, type AvProbe } from "@/lib/av-probe";
import { mbText, type UploadLimits } from "@/lib/upload-config";
import { uploadAttachment } from "@/lib/upload-attachment-client";
import { fieldErr, wizInput, wizLabel, SectionTitle, STEP } from "./wizard-shared";
import { AttachmentUpload } from "./AttachmentUpload";
import { Button } from "@/components/ui/Button";

const btnBase =
  "inline-flex items-center justify-center gap-1.5 rounded-none border px-3 py-2 text-sm transition";

/** 可自动抓取的字段 */
type FieldKey = "duration" | "artist" | "resolution";

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

export type AvSectionInitial = Partial<Record<FieldKey, string>> & {
  source?: AvSource;
  mode?: AvMode;
  url?: string;
};

export function AvSection({
  avKind,
  initial,
  fieldErrors,
  limits,
}: {
  avKind: AvKind;
  /** audio=音乐 / video=视频 */
  initial?: AvSectionInitial;
  fieldErrors?: Record<string, string[]>;
  limits: UploadLimits;
}) {
  const [source, setSource] = useState<AvSource>(initial?.source ?? "mount");
  const [mode, setMode] = useState<AvMode>(initial?.mode ?? "direct");
  const [url, setUrl] = useState(initial?.url ?? "");
  // 用户手动切过播放形态后，不再被 URL 变化自动覆盖（自动识别只做建议）
  const [modeTouched, setModeTouched] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<FieldKey, string>>({
    duration: initial?.duration ?? "",
    artist: initial?.artist ?? "",
    resolution: initial?.resolution ?? "",
  });

  const isAudio = avKind === "audio";
  const label = avClassFor(avKind);
  const acceptedExts = avExtsSample(avKind, 8);

  // 同步镜像：applyProbe 需要在同一次调用内读到最新值（setState 更新器是延迟执行的）
  const fieldsRef = useRef(fields);
  // 记录各字段「上一次自动填的值」：等于该值说明用户没改过，可继续被新文件覆盖
  const autoRef = useRef<Partial<Record<FieldKey, string>>>({});

  function setField(k: FieldKey, v: string) {
    const next = { ...fieldsRef.current, [k]: v };
    fieldsRef.current = next;
    setFields(next);
  }

  /** 用抓取结果补空字段；返回实际写入的部分，供提示文案使用 */
  const applyProbe = useCallback((p: AvProbe): AvProbe => {
    const cur = fieldsRef.current;
    const auto = autoRef.current;
    const applied: AvProbe = {};
    const put = (k: "duration" | "artist" | "resolution", v?: string) => {
      if (!v) return;
      if (cur[k] && auto[k] !== cur[k]) return; // 用户手改过 → 不覆盖
      applied[k] = v;
      auto[k] = v;
    };
    put("duration", p.duration);
    put("artist", p.artist);
    put("resolution", p.resolution);
    if (Object.keys(applied).length > 0) {
      const next = { ...cur, ...applied };
      fieldsRef.current = next;
      setFields(next);
    }
    return applied;
  }, []);

  // 挂载直链：地址稳定后自动读时长 / 分辨率（嵌入页读不到，直接跳过）
  useEffect(() => {
    if (source !== "mount" || mode !== "direct") return;
    const u = url.trim();
    if (!/^https?:\/\//i.test(u)) return;
    let alive = true;
    const timer = setTimeout(() => {
      void probeUrl(u, avKind).then((p) => {
        if (alive) applyProbe(p);
      });
    }, 900);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [url, mode, source, avKind, applyProbe]);

  function onUrl(next: string) {
    setUrl(next);
    if (!modeTouched) setMode(suggestMode(next, avKind));
    if (msg) setMsg(null);
  }

  function pickSource(next: AvSource) {
    setSource(next);
    setMsg(null);
    if (next === "file" && mode === "embed") setMode("direct");
  }

  function pickMode(next: AvMode) {
    setModeTouched(true);
    setMode(next);
  }

  async function onFile(file: File | null) {
    if (!file) return;
    setUploading(true);
    setProgress(0);
    setMsg(null);
    // 抓取（本地、快）与上传（可能很慢）并行，谁先完成都不互相阻塞
    const probeP = probeFile(file, avKind).catch((): AvProbe => ({}));
    try {
      const r = await uploadAttachment(file, setProgress, isAudio ? "music" : "video");
      setUrl(r.url);
      setSource("file");
      setMode("direct");
      setModeTouched(true);
      const applied = applyProbe(await probeP);
      const summary = probeSummary(applied);
      setMsg(
        `已上传 ${r.name}（${formatBytes(r.size)}）${summary ? `，${summary}` : ""}`,
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : `${label}上传失败，请重试`);
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  function clearUrl() {
    setUrl("");
    setMsg(null);
  }

  return (
    <section className="mt-4 space-y-4 rounded-none border border-brand-200 bg-surface p-5">
      <SectionTitle
        n={STEP.TYPE}
        tail={<span className="font-normal text-neutral-400">{label}来源</span>}
      >
        {isAudio ? "音频" : "视频"}信息
      </SectionTitle>

      {/* ---- 上传模式选择 ---- */}
      <div>
        <span className={wizLabel}>上传模式</span>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              {
                k: "mount" as const,
                icon: Link2,
                title: "在线挂载",
                desc: "只填外部地址，文件不进本站存储",
              },
              {
                k: "file" as const,
                icon: UploadCloud,
                title: "上传文件",
                desc: `上传到站内存储，单文件 ${mbText(limits.attachmentMaxMb)}`,
              },
            ] satisfies { k: AvSource; icon: typeof Link2; title: string; desc: string }[]
          ).map((o) => (
            <Button
              key={o.k}
              type="button"
              onClick={() => pickSource(o.k)}
              aria-pressed={source === o.k}
              className={`${btnBase} items-start gap-3 p-3 text-left ${
                source === o.k
                  ? "border-brand-600 bg-brand-500 text-white"
                  : "border-brand-200 bg-surface text-neutral-500 hover:border-brand-400 hover:text-neutral-800"
              }`}
            >
              <o.icon size={18} className="mt-0.5 shrink-0" aria-hidden />
              <span className="min-w-0">
                <span className="block text-sm font-medium leading-tight">{o.title}</span>
                <span className="mt-0.5 block text-[11px] font-normal opacity-75">{o.desc}</span>
              </span>
            </Button>
          ))}
        </div>
        <input type="hidden" name="avSource" value={source} />
      </div>

      {/* ---- 地址 / 文件 ---- */}
      <div>
        <label className={wizLabel} htmlFor="avUrl">
          {source === "mount" ? `${label}地址` : "站内文件"} *
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="avUrl"
            name="avUrl"
            value={url}
            onChange={(e) => onUrl(e.target.value)}
            placeholder={
              source === "mount"
                ? avMountPlaceholder(avKind)
                : uploading
                  ? "上传中…"
                  : "点右侧上传，或粘贴已上传的站内路径"
            }
            className={`${wizInput} min-w-0 flex-1`}
            autoComplete="off"
            spellCheck={false}
          />
          {url && (
            <Button
              type="button"
              onClick={clearUrl}
              aria-label="清空地址"
              className="rounded-none border border-brand-200 p-2.5 text-neutral-500 hover:border-red-300 hover:text-red-600"
            >
              <Trash2 size={15} />
            </Button>
          )}
        </div>
        {fieldErr(fieldErrors?.avUrl)}

        {source === "file" && (
          <div className="mt-2">
            <AttachmentUpload
              onFiles={(fl) => onFile(fl[0] ?? null)}
              limits={limits}
              uploading={uploading}
              progress={progress == null ? null : { done: progress, total: 100 }}
              label={`选择${label}文件`}
              hint={`仅 ${acceptedExts}`}
            />
          </div>
        )}
        {msg && <p className="mt-1.5 text-xs text-amber-600">{msg}</p>}
      </div>

      {/* ---- 播放形态 ---- */}
      <div>
        <span className={wizLabel}>播放形态</span>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { k: "direct" as const, text: `直链播放（站内播放器）` },
              { k: "embed" as const, text: "嵌入页播放（iframe）" },
            ] satisfies { k: AvMode; text: string }[]
          ).map((o) => (
            <Button
              key={o.k}
              type="button"
              onClick={() => pickMode(o.k)}
              aria-pressed={mode === o.k}
              className={`${btnBase} ${
                mode === o.k
                  ? "border-brand-600 bg-brand-50 text-brand-700"
                  : "border-brand-200 bg-surface text-neutral-500 hover:border-brand-400 hover:text-neutral-800"
              }`}
            >
              {o.text}
            </Button>
          ))}
          <input type="hidden" name="avMode" value={mode} />
        </div>
        {mode === "embed" && (
          <p className="mt-1.5 text-[11px] leading-4 text-neutral-400">
            嵌入页适合分享页地址（如 B 站 / YouTube）；部分站点禁止被嵌套，届时页面会提示打不开。
          </p>
        )}
      </div>

      {/* ---- 类型补充字段（自动抓取，可手改） ---- */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={wizLabel} htmlFor="duration">
            时长（自动读取）
          </label>
          <input
            id="duration"
            name="duration"
            value={fields.duration}
            onChange={(e) => setField("duration", e.target.value)}
            maxLength={20}
            placeholder="3:42"
            className={wizInput}
          />
        </div>
        <div>
          <label className={wizLabel} htmlFor="artist">
            艺术家（自动读取）
          </label>
          <input
            id="artist"
            name="artist"
            value={fields.artist}
            onChange={(e) => setField("artist", e.target.value)}
            maxLength={80}
            placeholder="作曲 / 演奏者"
            className={wizInput}
          />
        </div>
        {!isAudio && (
          <div>
            <label className={wizLabel} htmlFor="resolution">
              分辨率（自动读取）
            </label>
            <input
              id="resolution"
              name="resolution"
              value={fields.resolution}
              onChange={(e) => setField("resolution", e.target.value)}
              maxLength={20}
              placeholder="1920×1080 / 4K"
              className={wizInput}
            />
          </div>
        )}
      </div>
    </section>
  );
}
