"use client";

// 后台「创作者激励」总配置页。
//
// 三层次口径（页面上必须能看懂，否则调参必然调错）：
//   贡献分 = 荣誉层，只增不减，决定等级与**结算权重**；
//   PIX    = 资产层，用户可提现或打赏给别人，会减少；
//   元      = 结算层，只在提现页与后台出现。
// 两个池也别混：**激励池 P**（本期应发额 = 收入 × 分成比例 + 上期结转，是记账口径，不是真钱）
// 与 **现金池 C**（站上真钱 = 收入 − 成本 − 已发，是真的钱）。见 creator-incentive-plan.md §3.1。
//
// 表单是**整份替换**：数值字段用字符串草稿（允许中途清空），提交前并入深拷贝的配置文档，
// 服务端以 zod schema 为唯一权威（缺失字段回落默认、越界报错）。见 actions/incentive.ts。
import { useState } from "react";
import {
  Banknote,
  Coins,
  Gift,
  Info,
  Repeat2,
  Save,
  Scale,
  ShieldAlert,
  SlidersHorizontal,
  Trophy,
  TrendingUp,
  Wallet,
  RotateCcw,
} from "lucide-react";
import {
  LEVEL_BADGE_CLASSES,
  POINT_REASONS,
  PERMILLE_BASE,
  pointReasonLabel,
  permilleText,
  type IncentiveConfig,
  type IncentiveLevel,
} from "@/lib/points-config";
import { useAction } from "@/lib/hooks";
import { confirmDialog } from "@/components/ui/feedback";
import { resetIncentiveAction, saveIncentiveAction } from "@/lib/actions/incentive";
import { BTN_DANGER_SM, BTN_PRIMARY_SM, INPUT_SM } from "@/lib/ui/cls";
import { Button } from "@/components/ui/Button";
import {
  LevelEditor,
  NumRow,
  Row,
  Section,
  SegmentedRow,
  SelectRow,
  SwitchRow,
  TextRow,
  ToggleRow,
} from "./incentive-parts";

/** 含数值/布尔叶子的分组（数组与布尔总开关单独持有） */
const GROUPS = [
  "scores",
  "settleEligible",
  "profile",
  "download",
  "coin",
  "withdraw",
  "tip",
  "settlement",
  "solvency",
  "ranking",
  "risk",
  "disclosure",
] as const;
type GroupKey = (typeof GROUPS)[number];

/** 客户端草稿：分组内容保持宽松类型 —— 服务端 schema 才是权威校验 */
type Draft = {
  enabled: boolean;
  levels: IncentiveLevel[];
  groups: Record<GroupKey, Record<string, unknown>>;
};

function toDraft(c: IncentiveConfig): { draft: Draft; text: Record<string, string> } {
  const groups = {} as Record<GroupKey, Record<string, unknown>>;
  const text: Record<string, string> = {};
  for (const g of GROUPS) {
    const src = c[g] as Record<string, unknown>;
    groups[g] = { ...src };
    for (const [k, v] of Object.entries(src)) {
      if (typeof v === "number") text[`${g}.${k}`] = String(v);
    }
  }
  return {
    draft: { enabled: c.enabled, levels: c.levels.map((l) => ({ ...l })), groups },
    text,
  };
}

/** 字符串草稿 → 数值；空串或非法输入按 0（服务端 schema 会再校验一次范围） */
function toNum(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export default function IncentiveManager({
  config,
  frozenNames,
}: {
  config: IncentiveConfig;
  /** 冻结计分名单的用户名（已解析；查不到的保留原始 id），仅用于展示，不参与提交 */
  frozenNames: { id: string; label: string }[];
}) {
  const { run, pending } = useAction();
  const [draft, setDraft] = useState<Draft>(() => toDraft(config).draft);
  const [text, setText] = useState<Record<string, string>>(() => toDraft(config).text);
  const [prev, setPrev] = useState(config);

  // 服务端 refresh（保存后 / 并发冲突后）→ 把最新配置拉回草稿（渲染期派生，无 effect）
  if (prev !== config) {
    setPrev(config);
    const next = toDraft(config);
    setDraft(next.draft);
    setText(next.text);
  }

  const g = (k: GroupKey) => draft.groups[k];
  const setGroup = (k: GroupKey, patch: Record<string, unknown>) =>
    setDraft((d) => ({ ...d, groups: { ...d.groups, [k]: { ...d.groups[k], ...patch } } }));

  /** 数值字段的绑定：读字符串草稿，写回字符串草稿 */
  const num = (path: string) => ({
    value: text[path] ?? "",
    onChange: (v: string) => setText((t) => ({ ...t, [path]: v })),
  });
  const numOf = (path: string) => toNum(text[path] ?? "0");

  function buildPayload() {
    const payload: Record<string, unknown> = {
      enabled: draft.enabled,
      levels: draft.levels,
    };
    for (const k of GROUPS) payload[k] = { ...draft.groups[k] };
    for (const [path, raw] of Object.entries(text)) {
      const [k, leaf] = path.split(".");
      const grp = payload[k!];
      if (grp && typeof grp === "object") (grp as Record<string, unknown>)[leaf!] = toNum(raw);
    }
    return payload;
  }

  function save() {
    void run(() => saveIncentiveAction(buildPayload()));
  }

  function reset() {
    void confirmDialog({
      title: "恢复默认激励配置",
      message:
        "将全部分值、门槛、比例恢复为代码内默认值（分成比例回到默认档）。已产生的贡献分、PIX 与流水不受影响，等级显示会按新门槛重算，确定？",
      confirmLabel: "恢复默认",
      danger: true,
    }).then((ok) => {
      if (ok) run(() => resetIncentiveAction());
    });
  }

  const rate = numOf("settlement.ratePermille");
  const buffer = numOf("solvency.bufferPermille");
  const forCosts = Math.max(0, PERMILLE_BASE - rate - buffer);

  return (
    <div className="space-y-5">
      {/* ---------- 开篇：三层次 + 两个池 ---------- */}
      <div className="border border-brand-200 bg-brand-50/50 px-4 py-4 sm:px-5">
        <div className="flex items-start gap-3">
          <Info size={16} className="mt-0.5 shrink-0 text-brand-600" aria-hidden />
          <div className="min-w-0 text-xs leading-5 text-neutral-600">
            <p className="font-medium text-neutral-800">改之前先分清三个层次和两个池</p>
            <ul className="mt-1.5 space-y-1">
              <li>
                <b className="font-medium text-neutral-700">贡献分</b>
                荣誉层：只增不减（取消点赞不会扣回），决定等级与结算权重，用户看不到钱。
              </li>
              <li>
                <b className="font-medium text-neutral-700">PIX</b>
                资产层：用户可提现、可打赏给他人，会减少；不可购买，只能靠贡献获得。
              </li>
              <li>
                <b className="font-medium text-neutral-700">元</b>
                结算层：只在提现页与后台出现。
              </li>
              <li className="pt-1">
                <b className="font-medium text-neutral-700">激励池 P</b>
                （本期应发额 = 收入 × 分成比例 + 上期结转）是记账口径，
                <b className="font-medium text-neutral-700">不是真钱</b>；
                <b className="font-medium text-neutral-700">现金池 C</b>
                （收入 − 成本 − 已发）才是站上真钱。两者分开记账，永远别拿 P 当余额花。
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        {/* ---------- 总开关 ---------- */}
        <Section
          icon={SlidersHorizontal}
          title="总开关"
          desc="关闭后全站不再计分、不再展示等级徽章与 Creator 榜；已产生的贡献分、PIX 与流水全部保留，重新开启即继续累计。"
          className="lg:col-span-2"
        >
          <SwitchRow
            id="inc-enabled"
            label="启用创作者激励"
            checked={draft.enabled}
            onChange={(v) => setDraft((d) => ({ ...d, enabled: v }))}
            hint="关闭期间新的上架/点赞/收藏/下载/评论/关注都不产生贡献分（也不会补算）。"
          />
        </Section>

        {/* ---------- 分值表 ---------- */}
        <Section
          icon={TrendingUp}
          title="贡献分值与结算权重"
          desc="每一行都是「分值（拿到多少贡献分）× 计入结算（这份贡献分是否参与分钱）」。分值 0 = 该行为不计分。"
          className="lg:col-span-2"
          badge={
            <span className="rounded-none bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">
              已生效
            </span>
          }
        >
          <div className="px-4 py-4 sm:px-5">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[30rem] border-collapse">
                <thead>
                  <tr className="border-b border-brand-100 text-left text-[11px] text-neutral-500">
                    <th className="py-2 pr-3 font-medium">行为</th>
                    <th className="w-28 py-2 pr-3 font-medium">贡献分</th>
                    <th className="w-24 py-2 font-medium">计入结算</th>
                  </tr>
                </thead>
                <tbody>
                  {POINT_REASONS.map((r) => (
                    <tr key={r} className="border-b border-brand-100/70 last:border-0">
                      <td className="py-2.5 pr-3">
                        <label className="text-xs text-neutral-700" htmlFor={`sc-${r}`}>
                          {pointReasonLabel(r)}
                        </label>
                        <span className="ml-2 hidden font-mono text-[10px] text-neutral-400 sm:inline">
                          {r}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3">
                        <input
                          id={`sc-${r}`}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={10000}
                          step={1}
                          value={text[`scores.${r}`] ?? ""}
                          onChange={(e) =>
                            setText((t) => ({ ...t, [`scores.${r}`]: e.target.value }))
                          }
                          className={`${INPUT_SM} w-24 text-right tabular-nums`}
                        />
                      </td>
                      <td className="py-2.5">
                        <input
                          id={`se-${r}`}
                          type="checkbox"
                          checked={Boolean(g("settleEligible")[r])}
                          onChange={(e) => setGroup("settleEligible", { [r]: e.target.checked })}
                          className="h-4 w-4 rounded-none border border-brand-300 accent-brand-500 outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                          aria-label={`${pointReasonLabel(r)}计入结算`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] leading-4 text-neutral-400">
              默认只有「难刷」的指标计入结算（上架/被收藏/被下载/被精选）。点赞、评论、关注默认只给荣誉不计钱
              —— 一旦让它们参与分钱，刷分的动机就从「虚荣」变成「偷钱」，风控成本会高一个数量级。
            </p>
          </div>
        </Section>

        {/* ---------- 等级体系 ---------- */}
        <Section
          icon={Trophy}
          title="等级体系"
          desc="等级是纯荣誉，不直接发钱，只影响展示与「上榜最低等级」。门槛按贡献分累计值判定。"
          className="lg:col-span-2"
        >
          <LevelEditor
            levels={draft.levels}
            maxLevels={LEVEL_BADGE_CLASSES.length}
            onChange={(next) => setDraft((d) => ({ ...d, levels: next }))}
          />
          {/* 等级在这里第一次被当成「门槛」用：主页背景是最底层底图，只给够档的人开放 */}
          <SelectRow
            id="inc-profile-bg-level"
            label="主页背景解锁等级"
            range="0 = 不限"
            hint="达到该等级的用户才能在设置页上传个人主页背景（PC 与移动端各一张，铺满视口的底图）。等级本身不发钱，这里只是拿它当门槛。"
            value={String(g("profile").bgMinLevel ?? 0)}
            onChange={(v) => setGroup("profile", { bgMinLevel: toNum(v) })}
            options={[
              { value: "0", label: "不限（全员可用）" },
              ...[...draft.levels]
                .sort((a, b) => a.min - b.min)
                .map((lv, i) => ({ value: String(i), label: `${lv.name}（${lv.min} 分）` })),
            ]}
          />
        </Section>

        {/* ---------- 下载防刷 ---------- */}
        <Section
          icon={ShieldAlert}
          title="下载计分防刷"
          desc="刷下载是最容易的作弊路径。这里只限制「计分」，任何时候都不会拦用户下载 —— 下载量统计照常计。"
        >
          <NumRow
            id="inc-dl-cap"
            label="每主体每月计分次数上限"
            range="0 = 不限"
            min={0}
            hint="同一个「主体」（登录用户按账号、游客按 IP 哈希）在一个自然月内最多计分多少次下载。超出后继续能下，只是不再产生贡献分。"
            suffix="次/月"
            {...num("download.monthlyScoreCap")}
          />
          <SwitchRow
            id="inc-dl-perres-enabled"
            label="启用单作品每月计分上限"
            hint="默认关闭：热门作品会被大量真实用户下载，卡它容易误伤。仅在发现「同一作品被集中刷量」时开启。"
            checked={Boolean(g("download").perResourceCapEnabled)}
            onChange={(v) => setGroup("download", { perResourceCapEnabled: v })}
          />
          <NumRow
            id="inc-dl-perres"
            label="单作品每月计分上限"
            range="1–1000000"
            min={1}
            disabled={!g("download").perResourceCapEnabled}
            hint={
              g("download").perResourceCapEnabled
                ? "同一作品每月最多计分多少次，超出部分不计分。"
                : "需先打开上面的「单作品每月计分上限」开关才生效；当前该值会被忽略。"
            }
            suffix="次"
            {...num("download.perResourceCap")}
          />
          <SwitchRow
            id="inc-dl-anon"
            label="游客下载也计分"
            hint="关闭后只有登录用户下载才给作者计分，游客下载仍计入下载量。刷量严重时可关。"
            checked={Boolean(g("download").countAnonymous)}
            onChange={(v) => setGroup("download", { countAnonymous: v })}
          />
          <NumRow
            id="inc-dl-retain"
            label="去重记录保留月数"
            range="1–120"
            min={1}
            hint="「谁下过这个作品」的去重记录保留多久。到期后同一下载者会重新计分，所以别设太短；太短等于给刷量开后门。"
            suffix="月"
            {...num("download.retainMonths")}
          />
        </Section>

        {/* ---------- PIX 代币 ---------- */}
        <Section
          icon={Coins}
          title="PIX 代币"
          desc="代币的展示名与兑换比例。代币不可购买，只能靠贡献获得，因此这个比例决定「贡献分的钱味有多浓」。"
        >
          <TextRow
            id="inc-coin-name"
            label="展示名称"
            range="1–12 字"
            maxLength={12}
            hint="全站文案里出现的代币名（提现页、打赏、贡献记录）。"
            value={String(g("coin").name ?? "")}
            onChange={(v) => setGroup("coin", { name: v })}
          />
          <TextRow
            id="inc-coin-symbol"
            label="单位符号"
            range="≤8 字"
            maxLength={8}
            hint="数字后面的短单位，如「PIX」。"
            value={String(g("coin").symbol ?? "")}
            onChange={(v) => setGroup("coin", { symbol: v })}
          />
          <NumRow
            id="inc-coin-peryuan"
            label="兑换比例"
            range="1–100000"
            min={1}
            hint="多少代币 = 1 元。这是**兑出去**的口径，改小等于凭空放大用户手里的购买力，改大等于给已有 PIX 打折。"
            suffix="PIX / 元"
            {...num("coin.perYuan")}
          />
        </Section>

        {/* ---------- 打赏 ---------- */}
        <Section
          icon={Gift}
          title="打赏"
          desc="用户之间用 PIX 互相打赏（平台不经手真钱，只记流水）。打赏只能打赏代币，不能直接付钱。"
        >
          <SwitchRow
            id="inc-tip-enabled"
            label="启用打赏"
            checked={Boolean(g("tip").enabled)}
            onChange={(v) => setGroup("tip", { enabled: v })}
          />
          <NumRow
            id="inc-tip-min"
            label="单次最低打赏"
            range="1–1000000"
            min={1}
            suffix="PIX"
            hint="低于此额不允许提交。"
            {...num("tip.minCoin")}
          />
          <NumRow
            id="inc-tip-max"
            label="单次最高打赏"
            range="1–100000000"
            min={1}
            suffix="PIX"
            hint="打赏上限（可配置）。设小一点能抑制「用打赏搬运 PIX」这类玩法。"
            {...num("tip.maxCoin")}
          />
          <SwitchRow
            id="inc-tip-board"
            label="公开打赏榜"
            hint="默认关闭。打赏是私事，公开容易变成攀比场，也会让「谁给谁打赏过」变成压力。"
            checked={Boolean(g("tip").publicBoard)}
            onChange={(v) => setGroup("tip", { publicBoard: v })}
          />
        </Section>

        {/* ---------- 提现 ---------- */}
        <Section
          icon={Wallet}
          title="提现"
          desc="用户把 PIX 换成真钱。系统绝不自动打款：默认全部走人工审核。提现是否放行还要过下面「资金安全水位」那道闸。"
        >
          <SwitchRow
            id="inc-wd-enabled"
            label="启用提现"
            checked={Boolean(g("withdraw").enabled)}
            onChange={(v) => setGroup("withdraw", { enabled: v })}
            hint="关闭后用户仍可持有、打赏 PIX，只是不能提交提现申请。"
          />
          <NumRow
            id="inc-wd-min"
            label="提现门槛"
            range="1–100000000"
            min={1}
            suffix="PIX"
            hint="低于此额不允许提交提现。设高一点能避免「为了 0.3 元走一次人工审核」。"
            {...num("withdraw.minCoin")}
          />
          <NumRow
            id="inc-wd-fee"
            label="手续费"
            range="0 = 免手续费"
            min={0}
            suffix="分"
            hint="从提现金额里扣除，单位「分」（100 分 = 1 元）。设为 0 即免手续费。"
            {...num("withdraw.feeFen")}
          />
          <NumRow
            id="inc-wd-cooldown"
            label="提现冷却"
            range="0–365"
            min={0}
            suffix="天"
            hint="两次提现申请之间至少要隔多少天。0 = 不限。"
            {...num("withdraw.cooldownDays")}
          />
          <SwitchRow
            id="inc-wd-manual"
            label="必须人工审核"
            hint="强烈建议保持开启。关闭等于让系统自动打款，一旦计算出错就是直接的资金损失，且不可撤回。"
            checked={Boolean(g("withdraw").manualReview)}
            onChange={(v) => setGroup("withdraw", { manualReview: v })}
          />
        </Section>

        {/* ---------- 结算 ---------- */}
        <Section
          icon={Scale}
          title="分成比例与结算"
          desc="结算按自然月一轮：拿本期收入乘以分成比例，得到本期激励池，再按各人「计入结算」的贡献分权重分配。"
          className="lg:col-span-2"
        >
          <NumRow
            id="inc-st-rate"
            label="创作者分成比例"
            range="万分比 · 0–10000"
            min={0}
            max={PERMILLE_BASE}
            suffix={`= ${permilleText(rate)}`}
            hint={
              <>
                对<b className="font-medium text-neutral-600">毛收入</b>切，不是对利润切 ——
                当前 {permilleText(rate)} 表示「收入进来先划走 {permilleText(rate)} 给激励池」，
                成本与站点运营都得从剩下的 {permilleText(PERMILLE_BASE - rate)} 里出。
              </>
            }
            {...num("settlement.ratePermille")}
          />
          {rate + buffer >= PERMILLE_BASE ? (
            <div className="border-y border-red-200 bg-red-50/70 px-4 py-3 text-[11px] leading-4 text-red-600 sm:px-5">
              当前分成比例 {permilleText(rate)} 加上安全水位 {permilleText(buffer)} 已经超出 100%，
              留给成本与运营的空间为 {permilleText(forCosts)}。结算确认会被资金安全闸门拒绝，
              请下调分成比例或下调水位，不要关掉闸门。
            </div>
          ) : (
            <div className="border-y border-amber-200 bg-amber-50/60 px-4 py-3 text-[11px] leading-4 text-amber-700 sm:px-5">
              这 {permilleText(rate)} 是<b className="font-medium">上限</b>而不是实发额：
              实际发多少还取决于本期有多少「计入结算」的贡献分、是否达到结算门槛、单人是否触顶。
              扣掉安全水位 {permilleText(buffer)} 后，只剩 {permilleText(forCosts)} 覆盖服务器与运营成本。
            </div>
          )}
          <NumRow
            id="inc-st-minscore"
            label="结算分门槛"
            range="0 = 不设门槛"
            min={0}
            hint="本期「计入结算」的贡献分低于此值不参与分配（避免给几十个人各发几分钱，人工审核成本远高于金额本身）。"
            suffix="分"
            {...num("settlement.minScore")}
          />
          <NumRow
            id="inc-st-minpayout"
            label="最低发放额"
            range="0 = 不设下限"
            min={0}
            hint="单人本期应发低于此额就不发，金额原封不动转入下期激励池（不会消失）。单位「分」。"
            suffix="分"
            {...num("settlement.minPayoutFen")}
          />
          <NumRow
            id="inc-st-cap"
            label="单人单期封顶"
            range="万分比 · 1–10000"
            min={1}
            max={PERMILLE_BASE}
            suffix={`= ${permilleText(numOf("settlement.capPermille"))}`}
            hint="单人一期最多拿本期池子的多大比例，防止一个人吃掉整池。触顶部分按下一轮分给其他人，轮数用完则结转下期。"
            {...num("settlement.capPermille")}
          />
          <NumRow
            id="inc-st-capiter"
            label="封顶回收轮数"
            range="1–10"
            min={1}
            max={10}
            suffix="轮"
            hint="封顶溢出的钱再分配的轮数。轮完仍有剩余就结转到下期，不会丢。"
            {...num("settlement.capIterations")}
          />
          <Row
            label="结算周期"
            range="固定"
            hint="当前只支持自然月（按本机日历月归属，不按 UTC）。跨期守恒：上期结转 + 本期新增 − 本期实发 = 下期结转，任何一轮都不许出现「钱凭空少掉」。"
          >
            <p className="text-xs text-neutral-500">自然月</p>
          </Row>
          <SwitchRow
            id="inc-st-auto"
            label="自动结算"
            hint={
              <>
                开启后由服务器按下面的时点自动确认到期的结算期（等价于在这里点「确认结算」）。
                <b className="font-medium text-neutral-600">只自动到入账这一步，打款永远是人工</b>
                —— 提现队列不会被自动处理。默认关闭。
                停机后想立刻追平历史缺口，可以带密钥调一次 /api/cron/settle，不必等定时器。
              </>
            }
            checked={Boolean(g("settlement").autoEnabled)}
            onChange={(v) => setGroup("settlement", { autoEnabled: v })}
          />
          <NumRow
            id="inc-st-autodelay"
            label="自动结算延迟"
            range="0–28"
            min={0}
            max={28}
            suffix="天"
            disabled={!g("settlement").autoEnabled}
            hint={
              g("settlement").autoEnabled
                ? "归属月结束后第几天开始结算。留几天是为了让上月收入先录完 —— 池子按「已到账收入」切，录晚了这期池子就偏小。"
                : "需先打开上面的「自动结算」开关才生效；当前该值会被忽略。"
            }
            {...num("settlement.autoDelayDays")}
          />
          <NumRow
            id="inc-st-autohour"
            label="每日尝试时点"
            range="0–23"
            min={0}
            max={23}
            suffix="点"
            disabled={!g("settlement").autoEnabled}
            hint={
              g("settlement").autoEnabled
                ? "每天这个点之后才动手，给收入核对留一个固定窗口。到期当天没赶上，次日同一时点会继续。"
                : "需先打开上面的「自动结算」开关才生效；当前该值会被忽略。"
            }
            {...num("settlement.autoHour")}
          />
          <NumRow
            id="inc-st-autoretry"
            label="失败重试间隔"
            range="1–72"
            min={1}
            max={72}
            suffix="小时"
            disabled={!g("settlement").autoEnabled}
            hint={
              g("settlement").autoEnabled
                ? "资金安全闸门拒绝（或执行异常）后，隔多久再试一次。超过这个间隔多试无益，只会刷日志。"
                : "需先打开上面的「自动结算」开关才生效；当前该值会被忽略。"
            }
            {...num("settlement.autoRetryHours")}
          />
          <NumRow
            id="inc-st-autobackfill"
            label="最多补跑月数"
            range="1–36"
            min={1}
            max={36}
            suffix="个月"
            disabled={!g("settlement").autoEnabled}
            hint={
              g("settlement").autoEnabled
                ? "停机数周后向前追平的最大跨度。必须按月先后串行补 —— 跳过某一期，它的结转就永远进不了下一期。"
                : "需先打开上面的「自动结算」开关才生效；当前该值会被忽略。"
            }
            {...num("settlement.autoMaxBackfillMonths")}
          />
        </Section>

        {/* ---------- 资金安全 ---------- */}
        <Section
          icon={Banknote}
          title="资金安全水位"
          desc="唯一目的：不让站点倒贴。判定式为「PIX 总负债 ≤ 可用现金 × (1 − 水位)」。两个时点各查一次：结算确认时、用户发起提现时。"
        >
          <NumRow
            id="inc-sv-buffer"
            label="安全水位"
            range="万分比 · 0–5000"
            min={0}
            max={5000}
            suffix={`= ${permilleText(buffer)}`}
            hint="留出多少现金不当作可兑付资金。设 1000（10%）表示只认 90% 的现金能应付提现，剩下 10% 应付退款与突发。"
            {...num("solvency.bufferPermille")}
          />
          <SegmentedRow
            label="资金不足时的策略"
            hint="只影响「结算确认」这一步。"
            value={String(g("solvency").insufficientStrategy ?? "reject") as "reject" | "scale"}
            onChange={(v) => setGroup("solvency", { insufficientStrategy: v })}
            options={[
              { value: "reject", label: "拒绝结算", note: "推荐" },
              { value: "scale", label: "等比缩减", note: "按可用资金发" },
            ]}
          />
          <div className="px-4 pb-4 text-[11px] leading-4 text-neutral-400 sm:px-5">
            拒绝结算是推荐策略：本期不发、金额结转下期，等收入上来再发，账目始终对得上。
            等比缩减会把「本应发 100 的人只收到 62」这种不可解释的结果写进流水，除非你确实需要当期出账，否则别选。
          </div>
        </Section>

        {/* ---------- 排行榜 ---------- */}
        <Section
          icon={Trophy}
          title="贡献榜"
          desc="/creators 榜与首页「人气创作者」板块共用这里的口径。榜单只展示贡献分，绝不展示 PIX —— 荣誉榜不能变成财富榜。"
        >
          <ToggleRow
            label="开放的榜单周期"
            hint="all = 累计；month/week = 滚动窗口（近 30 / 7 天），刻意不用自然周月，避免月初全员归零的观感。至少保留一个。"
            values={(g("ranking").periods as string[] | undefined) ?? []}
            onChange={(next) => setGroup("ranking", { periods: next.length ? next : ["all"] })}
            options={[
              { value: "all", label: "总榜（累计）" },
              { value: "month", label: "月榜（近 30 天）" },
              { value: "week", label: "周榜（近 7 天）" },
            ]}
          />
          <NumRow
            id="inc-rk-limit"
            label="榜单展示人数"
            range="1–100"
            min={1}
            max={100}
            suffix="人"
            {...num("ranking.limit")}
          />
          <NumRow
            id="inc-rk-minlevel"
            label="上榜最低等级"
            range="0 = 不限"
            min={0}
            hint="0 = 任何有贡献分的用户都能上榜；设为 1 则最低要「创作者」档。"
            suffix="级"
            {...num("ranking.minLevel")}
          />
        </Section>

        {/* ---------- 公示页 ---------- */}
        <Section
          icon={Repeat2}
          title="公示页（资金池）"
          desc="/fund 是唯一对外公开钱的地方：激励池收入与支出明细、捐赠入口与鸣谢墙。公益站点的信任全靠它，配置别设得太保守。"
          badge={
            <span className="rounded-none bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">
              结算功能上线后生效
            </span>
          }
        >
          <NumRow
            id="inc-disc-pagesize"
            label="收支明细分页条数"
            range="5–100"
            min={5}
            max={100}
            suffix="条"
            {...num("disclosure.ledgerPageSize")}
          />
          <SwitchRow
            id="inc-disc-amounts"
            label="展示逐笔金额"
            hint="关闭后 /fund 只显示聚合总额与笔数。公益站点建议开启，越透明越有人愿意捐。"
            checked={Boolean(g("disclosure").showAmounts)}
            onChange={(v) => setGroup("disclosure", { showAmounts: v })}
          />
          <SwitchRow
            id="inc-disc-thanks-amount"
            label="鸣谢墙公开单笔金额"
            hint="默认关闭：公开金额会让「捐少了不好意思」，反而压低捐赠意愿。"
            checked={Boolean(g("disclosure").thanksShowAmount)}
            onChange={(v) => setGroup("disclosure", { thanksShowAmount: v })}
          />
          <SwitchRow
            id="inc-disc-anon"
            label="允许匿名捐赠"
            checked={Boolean(g("disclosure").allowAnonymous)}
            onChange={(v) => setGroup("disclosure", { allowAnonymous: v })}
          />
          <SwitchRow
            id="inc-disc-safety"
            label="对外显示水位安全线"
            hint="把「负债 / 可用现金」的实际水位公开展示。开着能让用户相信 PIX 兑得出来。"
            checked={Boolean(g("disclosure").showSafetyLine)}
            onChange={(v) => setGroup("disclosure", { showSafetyLine: v })}
          />
          <NumRow
            id="inc-disc-cache"
            label="公示页缓存时间"
            range="0 = 不缓存"
            min={0}
            max={86400}
            suffix="秒"
            hint="公示内容是聚合查询，缓存能显著降低数据库压力。设为 0 则每次访问都重算。"
            {...num("disclosure.cacheSeconds")}
          />
        </Section>

        {/* ---------- 风控 ---------- */}
        <Section
          icon={ShieldAlert}
          title="风控"
          desc="只做两件事：冻结可疑账号的计分、把异常份额提示给你。不做任何自动封号或自动扣分。"
          className="lg:col-span-2"
        >
          <div className="px-4 py-4 sm:px-5">
            <label className="text-xs font-medium text-neutral-700" htmlFor="inc-risk-frozen">
              冻结计分名单（用户 ID，一行一个）
            </label>
            <p className="mt-1 text-[11px] leading-4 text-neutral-400">
              冻结只停计分，不影响登录、下载、评论等任何正常功能；已产生的贡献分与 PIX 不动。
              这份名单极长时建议直接在用户管理页操作，这里是兜底入口。
            </p>
            <textarea
              id="inc-risk-frozen"
              rows={5}
              spellCheck={false}
              value={((g("risk").frozenUserIds as string[] | undefined) ?? []).join("\n")}
              onChange={(e) =>
                setGroup("risk", {
                  frozenUserIds: e.target.value
                    .split(/[\s,，;、]+/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              className="mt-2 w-full resize-y rounded-none border border-brand-200 bg-surface px-2.5 py-2 font-mono text-xs leading-5 outline-none transition focus:border-brand-500"
              placeholder="用户 ID（cuid），一行一个"
            />
            {frozenNames.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {frozenNames.map((u) => (
                  <span
                    key={u.id}
                    className="rounded-none border border-brand-200 bg-neutral-50 px-2 py-0.5 text-[10px] text-neutral-500"
                  >
                    {u.label}
                  </span>
                ))}
              </div>
            )}
          </div>
          <NumRow
            id="inc-risk-share"
            label="单人份额异常阈值"
            range="万分比 · 1–10000"
            min={1}
            max={PERMILLE_BASE}
            suffix={`= ${permilleText(numOf("risk.anomalySharePermille"))}`}
            hint="单人一期的计入结算分值占全站的比例超过此值，就在后台标红提示。只提示，不自动拦截。"
            {...num("risk.anomalySharePermille")}
          />
          <NumRow
            id="inc-risk-min"
            label="异常提示的最小增量"
            range="1–100000000"
            min={1}
            suffix="分"
            hint="分值增量低于此值就不提示，避免新人拿 9 分也被标成异常。"
            {...num("risk.anomalyMinDelta")}
          />
        </Section>
      </div>

      {/* ---------- 保存条 ---------- */}
      <div className="flex flex-col gap-2.5 border-t border-brand-100 pt-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        <Button
          type="button"
          disabled={pending}
          onClick={save}
          className={`${BTN_PRIMARY_SM} min-h-10 w-full justify-center px-4 sm:w-auto`}
        >
          {pending ? "保存中…" : (<><Save size={13} aria-hidden /> 保存配置</>)}
        </Button>
        <Button
          type="button"
          disabled={pending}
          onClick={reset}
          className={`${BTN_DANGER_SM} min-h-10 w-full justify-center px-4 sm:w-auto`}
        >
          {pending ? "恢复中…" : (<><RotateCcw size={13} aria-hidden /> 恢复默认</>)}
        </Button>
        <span className="text-xs leading-5 text-neutral-400 sm:ml-1">
          保存为整份替换：表单所有字段一起落库，服务端按 schema 校验（越界会被拒绝并提示字段名）。
          分值、门槛、比例、开关改完立即对之后的行为生效，不会追溯改写已产生的流水。
        </span>
      </div>
    </div>
  );
}
