"use client";

// 提现审核队列（/admin/withdrawals）。
//
// 【系统绝不自动打款】这是已锁定的决定：通过 = 「同意处理」，真钱由管理员线下转出后
// 回来回填流水号。所以本组件里没有任何「一键打款」的入口，只有「标记已打款（需填流水号）」。
//
// 【为什么驳回要醒目】驳回触发的是**解冻**（钱原样退回可用余额）。点错驳回不会造成损失，
// 但会让创作者多等一轮；点错通过才会进入「钱必须出去」的状态。两个方向都用确认弹窗拦一道。
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, Send, XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { confirmDialog, promptDialog, toast } from "@/components/ui/feedback";
import { useAction } from "@/lib/hooks";
import { formatCoin, formatYuan } from "@/lib/money";
import {
  markWithdrawalPaidAction,
  reviewWithdrawalAction,
} from "@/lib/actions/withdrawal";

export type QueueRow = {
  id: string;
  username: string;
  displayName: string | null;
  coinAmount: number;
  fiatFen: number;
  feeFen: number;
  rateSnapshot: number;
  method: string;
  accountInfo: string | null;
  status: string;
  createdAt: Date;
  handledAt: Date | null;
  paidAt: Date | null;
  payRef: string | null;
  rejectNote: string | null;
};

const METHOD_LABEL: Record<string, string> = { alipay: "支付宝", wechat: "微信" };

const STATUS_META: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "待审核", cls: "border-amber-300 bg-amber-50 text-amber-700" },
  APPROVED: { label: "待打款", cls: "border-brand-300 bg-brand-50 text-brand-700" },
  PAID: { label: "已打款", cls: "border-emerald-300 bg-emerald-50 text-emerald-700" },
  REJECTED: { label: "已驳回", cls: "border-neutral-300 bg-neutral-50 text-neutral-500" },
};

function splitAccount(accountInfo: string | null): { name: string; account: string } {
  if (!accountInfo) return { name: "—", account: "—" };
  const [name = "", account = ""] = accountInfo.split("｜");
  return { name: name || "—", account: account || "—" };
}

async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what}已复制`, "success");
  } catch {
    toast("复制失败，请手动选中复制", "error");
  }
}

function RowCard({ row, children }: { row: QueueRow; children: React.ReactNode }) {
  const meta = STATUS_META[row.status] ?? STATUS_META.PENDING!;
  const { name, account } = splitAccount(row.accountInfo);
  const when = (d: Date | null) => (d ? new Date(d).toLocaleString("zh-CN") : "—");

  return (
    <li className="border border-brand-200 bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-brand-100 px-3 py-2.5 sm:px-4">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium text-neutral-900">{row.displayName ?? row.username}</span>
            <span className="text-[11px] text-neutral-400">@{row.username}</span>
            <span className={`shrink-0 rounded-none border px-1.5 py-0.5 text-[10px] ${meta.cls}`}>
              {meta.label}
            </span>
          </p>
          <p className="mt-1 text-[11px] tabular-nums text-neutral-500">申请于 {when(row.createdAt)}</p>
        </div>
        <p className="shrink-0 text-right">
          <span className="block text-base font-semibold tabular-nums text-neutral-900">
            {formatYuan(row.fiatFen)}
          </span>
          <span className="mt-0.5 block text-[11px] tabular-nums text-neutral-500">
            {formatCoin(row.coinAmount)}（1 元 = {row.rateSnapshot} 代币
            {row.feeFen > 0 ? `，手续费 ${formatYuan(row.feeFen)}` : ""}）
          </span>
        </p>
      </div>

      <dl className="grid grid-cols-1 gap-2 px-3 py-2.5 sm:grid-cols-2 sm:px-4">
        <div className="min-w-0">
          <dt className="text-[11px] text-neutral-400">收款方式</dt>
          <dd className="mt-0.5 text-xs text-neutral-800">
            {METHOD_LABEL[row.method] ?? row.method}
            <span className="ml-2 text-neutral-500">
              {name}｜{account}
            </span>
            <button
              type="button"
              onClick={() => copyText(account, "收款账号")}
              title="复制收款账号"
              className="ml-2 inline-flex h-6 w-6 items-center justify-center border border-brand-200 text-neutral-500 transition hover:border-brand-400 hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              <Copy size={12} aria-hidden />
            </button>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] text-neutral-400">处理记录</dt>
          <dd className="mt-0.5 text-xs text-neutral-800">
            {row.status === "PAID" ? (
              <>
                打款于 {when(row.paidAt)}
                {row.payRef && <span className="ml-2 text-neutral-500">流水号 {row.payRef}</span>}
              </>
            ) : row.status === "REJECTED" ? (
              <>
                {when(row.handledAt)}
                {row.rejectNote && <span className="ml-2 text-neutral-500">{row.rejectNote}</span>}
              </>
            ) : (
              when(row.handledAt)
            )}
          </dd>
        </div>
      </dl>

      {children}
    </li>
  );
}

export default function WithdrawalQueue({
  pending,
  approved,
  history,
}: {
  pending: QueueRow[];
  approved: QueueRow[];
  history: QueueRow[];
}) {
  const { run, pending: busy } = useAction();
  const [openHistory, setOpenHistory] = useState(false);

  async function onApprove(row: QueueRow) {
    const ok = await confirmDialog({
      title: "通过这笔提现申请？",
      message: `通过只是「同意处理」，不会自动出钱。随后需要线下打款 ${formatYuan(row.fiatFen)} 到 ${splitAccount(row.accountInfo).account}，再回来回填流水号。`,
      confirmLabel: "通过",
    });
    if (!ok) return;
    run(() => reviewWithdrawalAction({ id: row.id, decision: "approve" }));
  }

  async function onReject(row: QueueRow) {
    const note = await promptDialog({
      title: "驳回这笔提现申请",
      message: `${formatCoin(row.coinAmount)} 将解冻并原样退回可用余额。请填写驳回原因（会通知申请人）。`,
      placeholder: "如：收款信息有误，请重新提交",
      confirmLabel: "确认驳回",
      multiline: true,
    });
    if (note === null) return;
    run(() => reviewWithdrawalAction({ id: row.id, decision: "reject", note }));
  }

  async function onPaid(row: QueueRow) {
    const payRef = await promptDialog({
      title: "回填打款流水号",
      message: `确认已向 ${splitAccount(row.accountInfo).account} 转出 ${formatYuan(row.fiatFen)}。流水号会记录在案并通知创作者。`,
      placeholder: "支付宝 / 微信转账单号",
      required: true,
      confirmLabel: "标记已打款",
    });
    if (!payRef) return;
    run(() => markWithdrawalPaidAction({ id: row.id, payRef }));
  }

  return (
    <div className="space-y-5">
      <section>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-neutral-900">待审核（{pending.length}）</h3>
          <p className="text-[11px] text-neutral-400">通过后进入「待打款」，系统不会自动出钱。</p>
        </div>
        {pending.length === 0 ? (
          <p className="border border-dashed border-brand-300 px-4 py-6 text-center text-sm text-neutral-500">
            没有待审核的提现申请。
          </p>
        ) : (
          <ul className="space-y-2">
            {pending.map((row) => (
              <RowCard key={row.id} row={row}>
                <div className="flex flex-wrap items-center gap-2 border-t border-brand-100 px-3 py-2.5 sm:px-4">
                  <Button
                    type="button"
                    variant="primary"
                    disabled={busy}
                    onClick={() => onApprove(row)}
                    className="min-h-8"
                  >
                    <CheckCircle2 size={13} aria-hidden /> 通过
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    disabled={busy}
                    onClick={() => onReject(row)}
                    className="min-h-8"
                  >
                    <XCircle size={13} aria-hidden /> 驳回并退回
                  </Button>
                </div>
              </RowCard>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-neutral-900">待打款（{approved.length}）</h3>
          <p className="text-[11px] text-neutral-400">
            线下转账完成后回来填流水号 —— 那一刻才产生现金流出记录。
          </p>
        </div>
        {approved.length === 0 ? (
          <p className="border border-dashed border-brand-300 px-4 py-6 text-center text-sm text-neutral-500">
            没有等待打款的申请。
          </p>
        ) : (
          <ul className="space-y-2">
            {approved.map((row) => (
              <RowCard key={row.id} row={row}>
                <div className="flex flex-wrap items-center gap-2 border-t border-brand-100 px-3 py-2.5 sm:px-4">
                  <Button
                    type="button"
                    variant="primary"
                    disabled={busy}
                    onClick={() => onPaid(row)}
                    className="min-h-8"
                  >
                    <Send size={13} aria-hidden /> 标记已打款
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    disabled={busy}
                    onClick={() => onReject(row)}
                    className="min-h-8"
                  >
                    <XCircle size={13} aria-hidden /> 驳回并退回
                  </Button>
                  {row.feeFen > 0 && (
                    <span className="text-[11px] text-neutral-400">
                      实付 {formatYuan(row.fiatFen)}（已扣手续费 {formatYuan(row.feeFen)}）
                    </span>
                  )}
                </div>
              </RowCard>
            ))}
          </ul>
        )}
      </section>

      {history.length > 0 && (
        <section>
          <button
            type="button"
            aria-expanded={openHistory}
            onClick={() => setOpenHistory((v) => !v)}
            className="flex w-full items-center justify-between border border-brand-200 bg-surface px-4 py-2.5 text-left text-sm font-semibold text-neutral-900 transition hover:border-brand-400"
          >
            <span>历史记录（{history.length}）</span>
            <span className="text-[11px] text-neutral-400">{openHistory ? "收起" : "展开"}</span>
          </button>
          {openHistory && (
            <ul className="mt-2 space-y-2">
              {history.map((row) => (
                <RowCard key={row.id} row={row}>
                  {row.status === "REJECTED" && (
                    <p className="flex items-center gap-1.5 border-t border-brand-100 px-3 py-2 text-[11px] text-neutral-400 sm:px-4">
                      <AlertTriangle size={12} aria-hidden /> 代币已解冻退回申请人可用余额。
                    </p>
                  )}
                </RowCard>
              ))}
            </ul>
          )}
        </section>
      )}

      <p className="border border-brand-200 bg-background px-4 py-3 text-[11px] leading-5 text-neutral-500">
        收款账号信息仅在本页可见。前台公示页、创作者个人页都不会出现任何人的收款信息 —— 它是隐私，
        不是可以「顺便展示」的运营数据。
      </p>
    </div>
  );
}
