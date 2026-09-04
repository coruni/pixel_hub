"use client";

import { useState } from "react";
import { Flag } from "lucide-react";
import { reportResourceAction } from "@/lib/actions/report";
import { REASONS } from "@/lib/report-options";

export default function ReportButton({
  resourceId,
  resourceTitle,
}: {
  resourceId: string;
  resourceTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>(REASONS[0]);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setMsg(null);
    const r = await reportResourceAction(resourceId, reason, detail);
    setBusy(false);
    if (r.ok) {
      setOpen(false);
      setDetail("");
      setMsg("✓ 举报已提交，感谢你帮助维护社区");
    } else {
      setMsg(r.error ?? "提交失败");
    }
  }

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-none border border-brand-200 bg-surface px-3.5 py-2 text-sm text-neutral-400 transition hover:border-red-300 hover:text-red-500"
      >
        <Flag size={15} aria-hidden /> 举报
      </button>

      {msg && <span className="ml-2 text-xs text-emerald-600">{msg}</span>}

      {open && (
        <div className="absolute right-0 top-9 z-30 w-72 rounded-none border border-brand-200 bg-surface p-4">
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
              placeholder="补充说明（可选）"
              className="w-full rounded-none border border-brand-200 px-2.5 py-1.5 text-sm outline-none focus:border-brand-500"
            />
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-none px-3 py-1.5 text-xs text-neutral-500 hover:bg-neutral-100"
            >
              取消
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="rounded-none border border-red-600 bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
            >
              提交举报
            </button>
          </div>
          {msg && !msg.startsWith("✓") && <p className="mt-2 text-xs text-red-500">{msg}</p>}
        </div>
      )}
    </span>
  );
}
