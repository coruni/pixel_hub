"use client";

// 结算台（/admin/settlement）交互层。
//
// 【这一页的纪律】所有数字都来自服务端算好的 `SettlementDraft`，本组件**不做任何重算** ——
// 一旦前端也有一份「池子怎么算」的逻辑，它就迟早会跟服务端不一致，
// 而结算页上出现两个不同的池子金额，是比算错更难查的事故。
//
// 【安全的按钮顺序】确认结算期 = 向创作者入账 PIX（负债上升），不可草率。
// 所以：收入未录 → 池子为 0 → 确认按钮直接禁用；闸门不通过 → 按钮禁用并解释原因。
// 重置草稿是破坏性操作（删掉已算出的明细），必须过确认弹窗。
import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Coins, Download, Lock, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { confirmDialog } from "@/components/ui/feedback";
import { useAction } from "@/lib/hooks";
import { formatCoin, formatYuan, yuanText } from "@/lib/money";
import { INPUT_SM, LABEL_STRONG } from "@/lib/ui/cls";
import type { RevenueRow, SettlementAnomalies, SettlementDraft } from "@/lib/settle";
import {
  addRevenueAction,
  confirmSettlementAction,
  deleteRevenueAction,
  markPeriodPaidAction,
  resetDraftAction,
} from "@/lib/actions/settlement";

function HintDetails({ text }: { text: string }) {
  return (
    <details className="mt-1 text-[10px] leading-4 text-neutral-400">
      <summary className="w-fit cursor-pointer list-none underline decoration-dotted underline-offset-2">
        说明
      </summary>
      <p className="mt-1 max-w-prose">{text}</p>
    </details>
  );
}

type PeriodMeta = {
  periodKey: string;
  status: "DRAFT" | "CONFIRMED" | "PAID";
  poolFen: number;
  paidFen: number;
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "草稿", cls: "border-amber-300 bg-amber-50 text-amber-700" },
  CONFIRMED: { label: "已确认", cls: "border-brand-300 bg-brand-50 text-brand-700" },
  PAID: { label: "已发放", cls: "border-emerald-300 bg-emerald-50 text-emerald-700" },
};

function Metric({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "brand" | "warn";
}) {
  return (
    <div className="border border-brand-100 bg-background px-3 py-2">
      <p className="text-[11px] text-neutral-500">{label}</p>
      <p
        className={`mt-0.5 text-base font-semibold tabular-nums ${
          tone === "brand" ? "text-brand-700" : tone === "warn" ? "text-red-700" : "text-neutral-900"
        }`}
      >
        {value}
      </p>
      {hint && <HintDetails text={hint} />}
    </div>
  );
}

function SectionShell({
  title,
  desc,
  children,
  aside,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <section className="border border-brand-200 bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-brand-100 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
          <p className="mt-0.5 text-[11px] leading-4 text-neutral-500">{desc}</p>
        </div>
        {aside}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export default function SettlementManager({
  draft,
  revenues,
  anomalies,
  periods,
  names,
  today,
}: {
  draft: SettlementDraft;
  revenues: RevenueRow[];
  anomalies: SettlementAnomalies;
  /** 有关键信息的期列表（含草稿） */
  periods: PeriodMeta[];
  /** userId → 展示名（预览明细里的 userId 在服务端解析） */
  names: Record<string, string>;
  /** 服务端当天的 YYYY-MM-DD（用于收入到账日默认值，避免水合不一致） */
  today: string;
}) {
  const { run, pending } = useAction();
  const [source, setSource] = useState("");
  const [amount, setAmount] = useState("");
  const [receivedAt, setReceivedAt] = useState(today);
  const [note, setNote] = useState("");

  const status = draft.period?.status ?? null;
  const label = names;
  const nameOf = (id: string) => label[id] ?? id.slice(0, 8);

  function submitRevenue(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      const r = await addRevenueAction({
        periodKey: draft.periodKey,
        source,
        amountYuan: amount,
        receivedAt,
        note,
      });
      if (r.ok) {
        setSource("");
        setAmount("");
        setNote("");
      }
      return r;
    });
  }

  async function onConfirm() {
    const ok = await confirmDialog({
      title: "确认结算期并向创作者入账？",
      message:
        `归属期：${draft.label}\n` +
        `本次将向 ${draft.outcome.rows.length} 位创作者入账 ${formatCoin(draft.newCoin)}。\n\n` +
        `这会立刻增加平台代币负债，且确认后不可重置。请先核对收入是否都已实际到账。`,
      confirmLabel: "确认并入账",
    });
    if (!ok) return;
    run(() => confirmSettlementAction(draft.periodKey));
  }

  async function onReset() {
    const ok = await confirmDialog({
      title: "重置本期草稿？",
      message: `将删除 ${draft.label} 已算出的分配明细，下次打开会按当前配置重新计算。仅在还没有任何一条入账时可用。`,
      confirmLabel: "重置草稿",
      danger: true,
    });
    if (!ok) return;
    run(() => resetDraftAction(draft.periodKey));
  }

  async function onMarkPaid() {
    const ok = await confirmDialog({
      title: "标记本期已发放？",
      message:
        `这只推进状态，不会发起任何打款。\n只有当本期全部提现都已线下处理完毕时才该点。`,
      confirmLabel: "标记已发放",
    });
    if (!ok) return;
    run(() => markPeriodPaidAction(draft.periodKey));
  }

  async function onDeleteRevenue(r: RevenueRow) {
    const ok = await confirmDialog({
      title: "冲正这笔收入？",
      message: `${r.source}｜${formatYuan(r.amountFen)}\n只在结算期仍是草稿时允许，已公示的数字不可事后修改。`,
      confirmLabel: "冲正",
      danger: true,
    });
    if (!ok) return;
    run(() => deleteRevenueAction(r.id));
  }

  return (
    <div className="space-y-4">
      {/* 期选择：横向滚动 + 状态徽标 */}
      <div className="overflow-x-auto border border-brand-200 bg-surface">
        <ul className="flex min-w-max divide-x divide-brand-100">
          {periods.map((p) => {
            const meta = STATUS_META[p.status]!;
            const active = p.periodKey === draft.periodKey;
            return (
              <li key={p.periodKey}>
                <Link
                  href={`/admin/settlement?period=${p.periodKey}`}
                  aria-current={active ? "page" : undefined}
                  className={`flex flex-col gap-1 px-4 py-2.5 transition ${
                    active ? "bg-brand-50" : "hover:bg-neutral-50"
                  }`}
                >
                  <span
                    className={`text-xs tabular-nums ${active ? "font-semibold text-brand-700" : "text-neutral-700"}`}
                  >
                    {p.periodKey}
                  </span>
                  <span className={`rounded-none border px-1.5 py-0.5 text-[10px] ${meta.cls}`}>
                    {meta.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      {/* 本期计算链 */}
      <SectionShell
        title={`${draft.label}｜计算链`}
        desc="收入 × 分成比例 + 上期结转 = 本期货池；池子按贡献分权重分给达标创作者。carryIn 全额并入、不再乘比例 —— 少算的那部分不会有任何账目能追到。"
        aside={
          status ? (
            <span className={`shrink-0 rounded-none border px-2 py-1 text-[11px] ${STATUS_META[status]!.cls}`}>
              {STATUS_META[status]!.label}
            </span>
          ) : (
            <span className="shrink-0 rounded-none border border-neutral-300 bg-neutral-50 px-2 py-1 text-[11px] text-neutral-500">
              未落快照
            </span>
          )
        }
      >
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="本期收入" value={formatYuan(draft.revenueFen)} hint="已实际到账的收入录入合计" />
          <Metric
            label="分成比例"
            value={`${(draft.ratePermille / 100).toFixed(1)}%`}
            hint={`只对公司收入切；本期计入 ${formatYuan(Math.floor((draft.revenueFen * draft.ratePermille) / 10000))}`}
          />
          <Metric label="上期结转" value={formatYuan(draft.carryInFen)} hint="原样并入，不再乘比例" />
          <Metric label="本期货池" value={formatYuan(draft.poolFen)} tone="brand" hint="可分配总额" />
          <Metric label="参与分值" value={draft.totalScore.toLocaleString("zh-CN")} hint="计入结算的贡献分合计" />
          <Metric label="本次发放" value={formatYuan(draft.outcome.paidFen)} hint={`${draft.outcome.rows.length} 人达标`} />
          <Metric label="结转下期" value={formatYuan(draft.outcome.carryOutFen)} hint="门槛/最低额过滤 + 取整残值" />
          <Metric
            label="折合代币"
            value={formatCoin(draft.newCoin)}
            tone="brand"
            hint={`负债新增 ${formatYuan(draft.newLiabilityFen)}`}
          />
        </dl>

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="border border-brand-100 bg-background px-3 py-2 text-[11px] leading-5 text-neutral-500">
            可用资金 <span className="tabular-nums text-neutral-800">{formatYuan(draft.solvency.cashFen)}</span>
          </div>
          <div className="border border-brand-100 bg-background px-3 py-2 text-[11px] leading-5 text-neutral-500">
            现有代币负债 <span className="tabular-nums text-neutral-800">{formatYuan(draft.solvency.liabilityFen)}</span>
          </div>
          <div className="border border-brand-100 bg-background px-3 py-2 text-[11px] leading-5 text-neutral-500">
            安全额度{" "}
            <span className="tabular-nums text-neutral-800">{formatYuan(draft.solvency.safeLimitFen)}</span>
            <span className="ml-1">（水位 {draft.solvency.usagePermille / 100}%）</span>
          </div>
        </div>

        {!draft.gate.ok && (
          <p className="mt-3 flex gap-2 border border-red-300 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span>{draft.gate.message}</span>
          </p>
        )}
      </SectionShell>

      {/* 收入录入 */}
      <SectionShell
        title="收入录入"
        desc="只有在钱**已实际到账**后才录。录了还没到账的收入，等于把偿付水位算成一个假数字 —— 最终会在创作者提现时炸掉。"
      >
        <form onSubmit={submitRevenue} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <label className={LABEL_STRONG} htmlFor="rev-source">
              收入来源
            </label>
            <input
              id="rev-source"
              value={source}
              maxLength={40}
              onChange={(e) => setSource(e.target.value)}
              placeholder="如：站点赞助 / 联盟广告"
              className={`${INPUT_SM} w-full`}
            />
          </div>
          <div className="min-w-0">
            <label className={LABEL_STRONG} htmlFor="rev-amount">
              金额（元）
            </label>
            <input
              id="rev-amount"
              value={amount}
              inputMode="decimal"
              onChange={(e) => setAmount(e.target.value)}
              placeholder="如：128.50"
              className={`${INPUT_SM} w-full tabular-nums`}
            />
          </div>
          <div className="min-w-0">
            <label className={LABEL_STRONG} htmlFor="rev-date">
              到账日期
            </label>
            <input
              id="rev-date"
              type="date"
              value={receivedAt}
              onChange={(e) => setReceivedAt(e.target.value)}
              className={`${INPUT_SM} w-full`}
            />
          </div>
          <div className="min-w-0">
            <label className={LABEL_STRONG} htmlFor="rev-note">
              备注（可选）
            </label>
            <input
              id="rev-note"
              value={note}
              maxLength={200}
              onChange={(e) => setNote(e.target.value)}
              className={`${INPUT_SM} w-full`}
            />
          </div>
          <div className="sm:col-span-2">
            <Button
              type="submit"
              variant="primary"
              disabled={pending || !amount.trim() || !receivedAt}
              className="min-h-9"
            >
              录入本期收入
            </Button>
            <span className="ml-3 text-[11px] text-neutral-400">
              归属期固定为当前查看期 {draft.periodKey}，不能跨期补录。
            </span>
          </div>
        </form>

        {revenues.length > 0 && (
          <ul className="mt-4 divide-y divide-brand-100 border-t border-brand-100">
            {revenues.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0 text-xs text-neutral-700">
                  {r.source}
                  <span className="ml-2 text-[11px] text-neutral-400">{r.receivedAt.toISOString().slice(0, 10)}</span>
                  {r.note && <span className="ml-2 text-[11px] text-neutral-400">{r.note}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-xs tabular-nums text-neutral-800">{formatYuan(r.amountFen)}</span>
                  <Button
                    type="button"
                    variant="danger"
                    aria-label={`冲正 ${r.source}`}
                    disabled={pending || status === "CONFIRMED" || status === "PAID"}
                    onClick={() => onDeleteRevenue(r)}
                    className="h-7 w-7 justify-center p-0"
                  >
                    <Trash2 size={13} aria-hidden />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionShell>

      {/* 分配明细 */}
      <SectionShell
        title="分配明细"
        desc="池子按贡献分权重分配（最大余数法，逐分守恒）；单人超封顶的部分回流给其余人再分，超出迭代轮数则与残值一同结转下期。"
        aside={
          <span className="shrink-0 text-[11px] text-neutral-400">
            实发 {formatYuan(draft.outcome.paidFen)} / 池子 {formatYuan(draft.poolFen)}
          </span>
        }
      >
        {draft.outcome.rows.length === 0 ? (
          <p className="border border-dashed border-brand-300 px-4 py-8 text-center text-sm text-neutral-500">
            本期还没有可发放的分配明细。先录入已到账收入；若已有收入，请检查「计入结算」的分值项与分门槛是否过高。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-brand-100 text-left text-xs text-neutral-400">
                  <th className="py-2 pr-3 font-medium">名次</th>
                  <th className="py-2 pr-3 font-medium">创作者</th>
                  <th className="py-2 pr-3 text-right font-medium">贡献分</th>
                  <th className="py-2 pr-3 text-right font-medium">发放</th>
                  <th className="py-2 pr-3 text-right font-medium">折合代币</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-100">
                {draft.outcome.rows.map((r) => (
                  <tr key={r.userId}>
                    <td className="py-2 pr-3 text-xs tabular-nums text-neutral-400">{r.rank}</td>
                    <td className="min-w-0 py-2 pr-3 text-neutral-800">
                      <span className="truncate">{nameOf(r.userId)}</span>
                      {r.capped && (
                        <span className="ml-2 rounded-none border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
                          已封顶
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right text-xs tabular-nums text-neutral-600">
                      {r.score.toLocaleString("zh-CN")}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-neutral-800">
                      {formatYuan(r.amountFen)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-brand-700">
                      {formatCoin(Math.floor((r.amountFen * draft.solvency.perYuan) / 100))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(draft.outcome.belowMin.length > 0 || draft.outcome.excluded.length > 0) && (
          <details className="mt-4 border-t border-brand-100 pt-3">
            <summary className="cursor-pointer text-xs text-neutral-500">
              未发放明细（低于最低发放额 {draft.outcome.belowMin.length} 人 / 未达结算分门槛{" "}
              {draft.outcome.excluded.length} 人）
            </summary>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-400">
              {draft.outcome.belowMin.map((r) => (
                <li key={`b-${r.userId}`}>
                  {nameOf(r.userId)}：{formatYuan(r.amountFen)} → 结转
                </li>
              ))}
              {draft.outcome.excluded.map((e) => (
                <li key={`e-${e.userId}`}>
                  {nameOf(e.userId)}：{e.score} 分 → 未达门槛
                </li>
              ))}
            </ul>
          </details>
        )}
      </SectionShell>

      {/* 异常提示 */}
      {(anomalies.hotUsers.length > 0 || anomalies.hotActors.length > 0) && (
        <section className="border border-amber-300 bg-amber-50/60 px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-800">
            <AlertTriangle size={14} aria-hidden /> 分值集中提示
          </h3>
          <p className="mt-1 text-[11px] leading-5 text-amber-700">
            以下账号本期分值占比超过告警阈值。这只提示、不拦截 —— 请人工确认是否有异常刷分。
          </p>
          {anomalies.hotUsers.length > 0 && (
            <div className="mt-2">
              <p className="text-[11px] font-medium text-amber-800">得分集中于单人</p>
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-amber-800">
                {anomalies.hotUsers.map((a) => (
                  <li key={a.userId}>
                    {a.username}：{a.score} 分（占 {(a.sharePermille / 100).toFixed(1)}%）
                  </li>
                ))}
              </ul>
            </div>
          )}
          {anomalies.hotActors.length > 0 && (
            <div className="mt-2">
              <p className="text-[11px] font-medium text-amber-800">
                分值集中于单一触发者（刷分的典型形态：自己分不高，但分值是它产出的）
              </p>
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-amber-800">
                {anomalies.hotActors.map((a) => (
                  <li key={a.actorId}>
                    {a.username}：产出 {a.score} 分（占 {(a.sharePermille / 100).toFixed(1)}%）
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* 操作区 */}
      <section className="border border-brand-200 bg-surface p-4">
        <h3 className="text-sm font-semibold text-neutral-900">操作</h3>
        <p className="mt-0.5 text-[11px] leading-4 text-neutral-500">
          确认并发放在服务端是幂等的：中断后重跑会沿用已落库的快照，只补没入账的人，不会重复入账。
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="primary"
            disabled={pending || !draft.canConfirm}
            onClick={onConfirm}
            className="min-h-9"
          >
            <Lock size={13} aria-hidden />
            {status === "DRAFT" ? `确认并发放入账（${draft.outcome.rows.length} 人）` : "确认并发放入账"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={pending || status !== "DRAFT" || draft.creditedCount > 0}
            onClick={onReset}
            className="min-h-9"
          >
            <RotateCcw size={13} aria-hidden /> 重置草稿
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={pending || status !== "CONFIRMED"}
            onClick={onMarkPaid}
            className="min-h-9"
          >
            <CheckCircle2 size={13} aria-hidden /> 标记已发放
          </Button>
          {(status === "CONFIRMED" || status === "PAID") && (
            <a
              href={`/api/settle/export?period=${draft.periodKey}`}
              className="inline-flex min-h-9 items-center gap-1 rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs text-neutral-600 transition hover:border-brand-400 hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              <Download size={13} aria-hidden /> 导出明细（CSV）
            </a>
          )}
          {!draft.canConfirm && status === null && draft.poolFen > 0 && (
            <span className="text-[11px] text-amber-700">闸门未通过，暂不可确认。</span>
          )}
          {status === "CONFIRMED" && (
            <span className="ml-auto flex items-center gap-3 text-[11px] text-neutral-500">
              <span>
                已入账 {draft.creditedCount}/{draft.payouts.length} 人
              </span>
              <Link
                href="/admin/withdrawals"
                className="inline-flex items-center gap-1 text-brand-700 underline underline-offset-2"
              >
                <Coins size={12} aria-hidden /> 去处理提现
              </Link>
            </span>
          )}
          {status === "PAID" && (
            <span className="ml-auto flex items-center gap-1 text-[11px] text-emerald-700">
              <Undo2 size={12} aria-hidden /> 本期已终结
            </span>
          )}
        </div>

        {draft.payouts.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-400">
            {draft.payouts.map((p) => (
              <li key={p.userId}>
                {p.name ?? p.username}：{yuanText(p.amountFen)} / {formatCoin(p.coin)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
