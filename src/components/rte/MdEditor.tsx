"use client";

// Markdown 所见即所得编辑器（Milkdown Crepe 封装）。
// 非受控：defaultValue 仅在挂载时消费；输入经 onChange 以 markdown 字符串上抛。
// 主题映射见 globals.css 的 .md-editor 段（token 化，明暗跟随站点）。
import { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";

export default function MdEditor({
  defaultValue = "",
  onChange,
  placeholder = "直接输入，至少 10 个字…",
  minHeight = "16rem",
  ariaLabel = "Markdown 编辑器",
}: {
  defaultValue?: string;
  onChange?: (markdown: string) => void;
  placeholder?: string;
  minHeight?: string;
  ariaLabel?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // 全屏时锁定背景滚动 + Esc 退出
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [fullscreen]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    const crepe = new Crepe({
      root: host,
      defaultValue,
      // 裁掉重特性：LaTeX(Ab/KaTeX)、AI、CodeMirror 代码块编辑器（保留 ProseMirror 原生代码块）
      features: {
        [Crepe.Feature.Latex]: false,
        [Crepe.Feature.AI]: false,
        [Crepe.Feature.CodeMirror]: false,
      },
      featureConfigs: {
        [Crepe.Feature.Placeholder]: { text: placeholder, mode: "doc" },
        // 行内图/块图共用：走站内 /api/upload 媒体接口，回填原图地址
        [Crepe.Feature.ImageBlock]: {
          onUpload: async (file: File) => {
            const fd = new FormData();
            fd.append("files", file);
            try {
              const res = await fetch("/api/upload?max=1", { method: "POST", body: fd });
              const data = (await res.json()) as {
                ok?: boolean;
                error?: string;
                files?: { ok: boolean; error?: string; origUrl?: string | null; bigUrl?: string | null; thumbUrl?: string | null }[];
              };
              const f = data.files?.[0];
              if (!res.ok || !data.ok || !f?.ok) {
                throw new Error(f?.error ?? data.error ?? "图片上传失败");
              }
              const url = f.origUrl ?? f.bigUrl ?? f.thumbUrl;
              if (!url) throw new Error("图片上传失败");
              return url;
            } catch (err) {
              console.error("editor image upload failed", err);
              throw err instanceof Error ? err : new Error("图片上传失败");
            }
          },
        },
      },
    });
    crepe.on((listener) =>
      listener.markdownUpdated((_ctx, markdown) => {
        if (!disposed) onChangeRef.current?.(markdown);
      }),
    );
    const created = crepe
      .create()
      .then(() => {
        // ProseMirror 节点补可访问名称（表单 label 关联用）
        host.querySelector(".ProseMirror")?.setAttribute("aria-label", ariaLabel);
      })
      .catch((err) => {
        console.error("editor init failed", err);
      });
    return () => {
      disposed = true;
      // StrictMode 双挂载：create 完成后再销毁，避免半初始化实例泄漏
      void created.then(() => crepe.destroy().catch(() => {}));
    };
    // 仅挂载时创建一次，编辑器内部自管状态
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={rootRef}
      className="md-editor relative rounded-none border border-brand-200 bg-surface"
      data-fullscreen={fullscreen || undefined}
      style={fullscreen ? undefined : { minHeight }}
    >
      <div ref={hostRef} className="md-editor-host" />
      <Button
        type="button"
        onClick={() => setFullscreen((v) => !v)}
        aria-label={fullscreen ? "退出全屏" : "全屏编写"}
        title={fullscreen ? "退出全屏（Esc）" : "全屏编写"}
        className="absolute right-1.5 top-1.5 z-10 rounded-none border border-brand-200 bg-surface p-1.5 text-neutral-400 transition hover:border-brand-500 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        {fullscreen ? <Minimize2 size={14} aria-hidden /> : <Maximize2 size={14} aria-hidden />}
      </Button>
    </div>
  );
}

import { Button } from "@/components/ui/Button";