"use client";

// 内容页编辑器：Milkdown 所见即所得编辑 + 保存 / 恢复内置默认。
// docKey 变化时由父级以 key 强制重挂载（MdEditor 的 defaultValue 仅挂载消费）。
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resetDocAction, saveDocAction } from "@/lib/actions/docs";
import MdEditor from "@/components/rte/MdEditor";
import { confirmDialog } from "@/components/ui/feedback";
import { BTN_PRIMARY_SM } from "@/lib/ui/cls";
import { Button } from "@/components/ui/Button";

const btnGhost =
  "inline-flex items-center gap-1.5 rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs text-neutral-600 transition hover:border-brand-500 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50";

export default function DocsEditor({
  docKey,
  label,
  initial,
  isCustom,
  updatedAt,
}: {
  docKey: string;
  label: string;
  initial: string;
  isCustom: boolean;
  updatedAt: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [md, setMd] = useState(initial);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const save = () =>
    start(async () => {
      setMessage(null);
      const r = await saveDocAction(docKey, md);
      if (r.ok) {
        setMessage({ kind: "ok", text: "已保存，前台立即生效" });
        router.refresh();
      } else {
        setMessage({ kind: "error", text: r.error ?? "保存失败，请重试" });
      }
    });

  const reset = async () => {
    const ok = await confirmDialog({
      title: "恢复内置默认",
      message: `恢复「${label}」为内置默认内容？当前自定义内容将被清除。`,
      confirmLabel: "恢复",
      danger: true,
    });
    if (!ok) return;
    start(async () => {
      setMessage(null);
      const r = await resetDocAction(docKey);
      if (r.ok) {
        setMessage({ kind: "ok", text: "已恢复内置默认" });
        router.refresh();
      } else {
        setMessage({ kind: "error", text: r.error ?? "操作失败，请重试" });
      }
    });
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Button type="button" onClick={save} disabled={pending} className={BTN_PRIMARY_SM}>
          {pending ? "保存中…" : "保存"}
        </Button>
        {isCustom && (
          <Button type="button" onClick={reset} disabled={pending} className={btnGhost}>
            {pending ? "处理中…" : "恢复内置默认"}
          </Button>
        )}
        <span
          className={`text-xs ${isCustom ? "text-emerald-700" : "text-neutral-400"}`}
          role="status"
        >
          {isCustom ? "已自定义" : "当前为内置默认内容"}
          {updatedAt && ` · 最后修改 ${updatedAt}`}
        </span>
        {message?.kind === "error" && (
          <span className="text-xs text-red-600" role="alert">
            {message.text}
          </span>
        )}
      </div>

      <MdEditor
        key={docKey}
        defaultValue={initial}
        onChange={setMd}
        minHeight="32rem"
        ariaLabel={`${label}编辑器`}
        placeholder="使用 Markdown 编写，## 为分节标题…"
      />
    </div>
  );
}
