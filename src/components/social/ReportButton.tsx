"use client";

import { useEffect, useRef, useState } from "react";
import { Flag } from "lucide-react";
import { reportResourceAction } from "@/lib/actions/report";
import { REASONS } from "@/lib/report-options";
import { Button } from "@/components/ui/Button";

const PANEL_W = 288;

/**
 * 举报按钮 + 原因弹层。
 * 弹层用 fixed + 按钮锚点（视口内 clamp）定位并带透明遮罩，避免在窄屏/贴边布局下
 * 被内容裁掉或溢出视口而“看不到选择框”；打开时锁定背景滚动。
 */
export default function ReportButton({
  resourceId,
  resourceTitle,
}: {
  resourceId: string;
  resourceTitle: string;
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const open = pos !== null;
  const [reason, setReason] = useState<string>(REASONS[0]);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function place() {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(
      12,
      Math.min(r.left + r.width - PANEL_W, window.innerWidth - PANEL_W - 12),
    );
    // 下方放不下时向上翻（估算面板高）
    const top = Math.max(12, Math.min(r.bottom + 8, window.innerHeight - 320));
    setPos({ top, left });
  }

  function togglePanel() {
    if (pos) {
      setPos(null);
      return;
    }
    setMsg(null);
    place();
  }

  // 打开时锁背景滚动 + Esc 关闭 + 视口变化重定位
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPos(null);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  async function submit() {
    setBusy(true);
    setMsg(null);
    const res = await reportResourceAction(resourceId, reason, detail);
    setBusy(false);
    if (res.ok) {
      setPos(null);
      setDetail("");
      setMsg("✓ 举报已提交，感谢维护社区");
    } else {
      setMsg(res.error ?? "提交失败");
    }
  }

  return (
    <span className="relative inline-flex">
      <Button
        ref={btnRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={togglePanel}
        className="inline-flex items-center gap-1.5 rounded-none border border-brand-200 bg-surface px-3.5 py-2 text-sm text-neutral-400 transition hover:border-red-300 hover:text-red-500"
      >
        <Flag size={15} aria-hidden /> 举报
      </Button>

      {msg && msg.startsWith("✓") && <span className="ml-2 text-xs text-emerald-600">{msg}</span>}

      {open && (
        <>
          {/* 透明遮罩：拦截面板外点击并关闭（面板自身 z 更高，交互不受影响） */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setPos(null)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-label="举报资源"
            className="fixed z-50 w-72 rounded-none border border-brand-200 bg-surface p-4 shadow-lg"
            style={{ top: pos.top, left: pos.left }}
          >
            <p className="text-sm font-medium text-neutral-900">举报「{resourceTitle}」</p>
            <div className="mt-3 space-y-2">
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full rounded-none border border-brand-200 px-2.5 py-1.5 text-sm outline-none focus:border-brand-500"
              >
                {REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <textarea
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="补充说明（选填）"
                className="w-full rounded-none border border-brand-200 px-2.5 py-1.5 text-sm outline-none focus:border-brand-500"
              />
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button
                type="button"
                onClick={() => setPos(null)}
                className="rounded-none px-3 py-1.5 text-xs text-neutral-500 hover:bg-neutral-100"
              >
                取消
              </Button>
              <Button
                type="button"
                onClick={submit}
                disabled={busy}
                className="rounded-none border border-red-600 bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
              >
                提交举报
              </Button>
            </div>
            {msg && !msg.startsWith("✓") && (
              <p className="mt-2 text-xs text-red-500" role="alert">
                {msg}
              </p>
            )}
          </div>
        </>
      )}
    </span>
  );
}
