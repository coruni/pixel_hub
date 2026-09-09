"use client";

// 全站统一的命令式反馈：confirmDialog / promptDialog / toast。
// 替代 window.confirm / window.prompt / window.alert，视觉沿用直角像素语言与暖色 token。
// 实现为惰性挂载的全局 host（首次调用时在 document.body 下创建），调用点零 Provider 侵入，
// 明暗主题由 html.dark 下的 CSS 变量自动跟随；toast 用固定暖黑底保证双主题可读。
import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Button } from "@/components/ui/Button";

export type ConfirmOptions = {
  title: string;
  /** 支持 \n 换行 */
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 危险操作：确认按钮红色实底 */
  danger?: boolean;
};

export type PromptOptions = {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  /** true 时使用多行输入（textarea） */
  multiline?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
};

export type ToastKind = "error" | "success" | "info";

type ConfirmReq = { opts: ConfirmOptions; resolve: (v: boolean) => void };
type PromptReq = { opts: PromptOptions; resolve: (v: string | null) => void; value: string };
type Toast = { id: number; kind: ToastKind; text: string };

type HostState = {
  confirm: ConfirmReq | null;
  prompt: PromptReq | null;
  toasts: Toast[];
};

type Dispatch = (update: (s: HostState) => HostState) => void;

let dispatchRef: Dispatch | null = null;
let queued: ((d: Dispatch) => void)[] = [];
let rootRef: Root | null = null;
let hostNode: HTMLDivElement | null = null;
let seq = 0;

/** 惰性挂载全局 host；把更新命令投递给 host，未就绪时先入队待挂载后执行 */
function ensureHost() {
  if (typeof document === "undefined") return;
  if (rootRef && hostNode) return;
  hostNode = document.createElement("div");
  document.body.appendChild(hostNode);
  rootRef = createRoot(hostNode);
  rootRef.render(<FeedbackHost />);
}

function dispatch(update: (s: HostState) => HostState) {
  ensureHost();
  if (dispatchRef) dispatchRef(update);
  else queued.push((d) => d(update));
}

/** 确认框：resolve(true) 确认 / resolve(false) 取消（含 Esc） */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    dispatch((s) => ({ ...s, confirm: { opts, resolve } }));
  });
}

/** 输入框：resolve(值) 确认 / resolve(null) 取消；required 为空点确认不关闭并 toast 提示 */
export function promptDialog(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    dispatch((s) => ({
      ...s,
      prompt: { opts, resolve, value: opts.defaultValue ?? "" },
    }));
  });
}

/** 轻量提示条：约 4 秒自动消失，error/success/info 仅以图标与语义区分（不依赖颜色单独表达） */
export function toast(text: string, kind: ToastKind = "error") {
  const id = ++seq;
  dispatch((s) => ({ ...s, toasts: [...s.toasts, { id, kind, text }] }));
  window.setTimeout(() => {
    dispatch((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) }));
  }, 4000);
}

const CARD =
  "w-full max-w-sm rounded-none border border-neutral-300 bg-surface p-5 shadow-xl";
const TITLE = "text-sm font-semibold text-neutral-900";
const MESSAGE = "mt-2 text-sm leading-6 break-words whitespace-pre-line text-neutral-600";
const BTN_BASE =
  "rounded-none px-3 py-1.5 text-xs font-medium transition focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50";
const BTN_CANCEL = `${BTN_BASE} border border-brand-200 bg-surface text-neutral-600 hover:border-brand-400 hover:text-brand-700`;
const BTN_CONFIRM = `${BTN_BASE} border border-brand-700 bg-brand-600 text-white hover:bg-brand-700`;
const BTN_DANGER = `${BTN_BASE} border border-red-600 bg-red-600 text-white hover:bg-red-500`;
const INPUT =
  "w-full rounded-none border border-brand-200 bg-surface px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-400";

function FeedbackHost() {
  const [state, setState] = useState<HostState>({
    confirm: null,
    prompt: null,
    toasts: [],
  });

  useEffect(() => {
    dispatchRef = (update) => setState((s) => update(s));
    const q = queued;
    queued = [];
    q.forEach((fn) => fn(dispatchRef!));
    return () => {
      dispatchRef = null;
    };
  }, []);

  // Esc 关闭当前弹层（等于取消）
  useEffect(() => {
    if (!state.confirm && !state.prompt) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (state.confirm) closeConfirm();
      else closePrompt();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.confirm, state.prompt]);

  function closeConfirm() {
    state.confirm?.resolve(false);
    setState((s) => ({ ...s, confirm: null }));
  }
  function acceptConfirm() {
    state.confirm?.resolve(true);
    setState((s) => ({ ...s, confirm: null }));
  }
  function closePrompt() {
    state.prompt?.resolve(null);
    setState((s) => ({ ...s, prompt: null }));
  }
  function acceptPrompt() {
    const p = state.prompt;
    if (!p) return;
    const v = p.value.trim();
    if (p.opts.required && !v) {
      toast("请填写后再确认", "error");
      return;
    }
    p.resolve(p.opts.required ? v : v || null);
    setState((s) => ({ ...s, prompt: null }));
  }

  return (
    <>
      {/* 确认 / 输入弹层：点击遮罩不关闭，防误触丢失危险操作上下文 */}
      {(state.confirm || state.prompt) && (
        <div
          className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-4"
          role="alertdialog"
          aria-modal="true"
          aria-label={state.confirm?.opts.title ?? state.prompt?.opts.title}
        >
          <div className={CARD}>
            <h2 className={TITLE}>{state.confirm?.opts.title ?? state.prompt?.opts.title}</h2>
            {(state.confirm?.opts.message ?? state.prompt?.opts.message) && (
              <p className={MESSAGE}>
                {state.confirm?.opts.message ?? state.prompt?.opts.message}
              </p>
            )}
            {state.prompt &&
              (state.prompt.opts.multiline ? (
                <textarea
                  className={`${INPUT} mt-3`}
                  rows={4}
                  autoFocus
                  value={state.prompt.value}
                  placeholder={state.prompt.opts.placeholder}
                  onChange={(e) =>
                    setState((s) =>
                      s.prompt ? { ...s, prompt: { ...s.prompt, value: e.target.value } } : s,
                    )
                  }
                />
              ) : (
                <input
                  className={`${INPUT} mt-3`}
                  autoFocus
                  value={state.prompt.value}
                  placeholder={state.prompt.opts.placeholder}
                  onChange={(e) =>
                    setState((s) =>
                      s.prompt ? { ...s, prompt: { ...s.prompt, value: e.target.value } } : s,
                    )
                  }
                />
              ))}
            <div className="mt-5 flex justify-end gap-2">
              {state.confirm ? (
                <>
                  <Button type="button" autoFocus className={BTN_CANCEL} onClick={closeConfirm}>
                    {state.confirm.opts.cancelLabel ?? "取消"}
                  </Button>
                  <Button
                    type="button"
                    className={state.confirm.opts.danger ? BTN_DANGER : BTN_CONFIRM}
                    onClick={acceptConfirm}
                  >
                    {state.confirm.opts.confirmLabel ?? "确认"}
                  </Button>
                </>
              ) : (
                <>
                  <Button type="button" autoFocus className={BTN_CANCEL} onClick={closePrompt}>
                    {state.prompt?.opts.cancelLabel ?? "取消"}
                  </Button>
                  <Button type="button" className={BTN_CONFIRM} onClick={acceptPrompt}>
                    {state.prompt?.opts.confirmLabel ?? "确认"}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* toast 通知条 */}
      {state.toasts.length > 0 && (
        <div
          className="pointer-events-none fixed bottom-5 left-1/2 z-[90] flex -translate-x-1/2 flex-col items-center gap-2 px-4"
          role="status"
          aria-live="polite"
        >
          {state.toasts.map((t) => (
            <div
              key={t.id}
              className="pointer-events-auto flex items-center gap-2 rounded-none border border-white/15 bg-black/90 px-3 py-2 text-xs text-white shadow-lg"
            >
              {t.kind === "error" && <AlertTriangle size={14} className="text-red-400" aria-hidden />}
              {t.kind === "success" && (
                <CheckCircle2 size={14} className="text-emerald-400" aria-hidden />
              )}
              {t.kind === "info" && <Info size={14} className="text-neutral-300" aria-hidden />}
              <span className="break-words">{t.text}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
