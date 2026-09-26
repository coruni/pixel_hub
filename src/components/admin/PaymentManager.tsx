"use client";

// 支付与赞助配置（/admin/payment）。
//
// 【密钥纪律 · 本页最关键的一条】`epay.key` **永远不会被送到浏览器**：
// 服务端只传下来 `keySet: boolean`（是否已配置），密钥输入框初始为空。
// 保存时若没换密钥，提交的是哨兵值 `KEEP_SECRET`，由服务端把它替换回库里那份。
// 这样「密钥不出服务端」就不是一句注释，而是这个组件结构上拿不到它。
//
// 金额一律以「元」输入、服务端按字符串解析成分（禁止 parseFloat×100）。
import { useState } from "react";
import type { FormEvent } from "react";
import { KeyRound, RotateCcw, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { confirmDialog, toast } from "@/components/ui/feedback";
import { useAction } from "@/lib/hooks";
import { INPUT_SM } from "@/lib/ui/cls";
import { fenToYuanText, parseYuanToFen } from "@/lib/money";
import { KEEP_SECRET } from "@/lib/payment-config";
import { checkEpayChannelAction, resetPaymentConfigAction, savePaymentConfigAction } from "@/lib/actions/payment";

function HintDetails({ text }: { text: string }) {
  return (
    <details className="mt-1 text-[11px] leading-4 text-neutral-400">
      <summary className="w-fit cursor-pointer list-none underline decoration-dotted underline-offset-2">
        说明
      </summary>
      <p className="mt-1 max-w-prose">{text}</p>
    </details>
  );
}

export type PaymentView = {
  epay: {
    enabled: boolean;
    url: string;
    pid: string;
    alipay: boolean;
    wxpay: boolean;
  };
  sponsor: {
    enabled: boolean;
    tiers: number[];
    minFen: number;
    maxFen: number;
    allowAnonymous: boolean;
    allowGuest: boolean;
    messageMax: number;
  };
  order: { ttlMinutes: number; subjectPrefix: string; ratePerMinute: number };
  /** 密钥是否已配置（**只给布尔，不给值**） */
  keySet: boolean;
};

const num = (s: string, fallback = 0) => {
  const n = Number(s.trim());
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

function Field({
  id,
  label,
  hint,
  children,
}: {
  id?: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-start sm:px-5">
      <div className="min-w-0">
        <label className="text-xs font-medium text-neutral-700" htmlFor={id}>
          {label}
        </label>
        {hint && <HintDetails text={hint} />}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Toggle({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-3 px-4 py-4 sm:px-5">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 shrink-0 rounded-none border border-brand-300 accent-brand-500 outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      />
      <span className="text-xs font-medium text-neutral-700">{label}</span>
    </label>
  );
}

function Group({
  icon: Icon,
  title,
  desc,
  children,
}: {
  icon: typeof KeyRound;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden border border-brand-200 bg-surface">
      <div className="border-b border-brand-100 px-4 py-4 sm:px-5">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center bg-brand-50 text-brand-600">
            <Icon size={18} strokeWidth={1.8} aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
            <p className="mt-1 text-xs leading-5 text-neutral-500">{desc}</p>
          </div>
        </div>
      </div>
      <div className="divide-y divide-brand-100">{children}</div>
    </section>
  );
}

export default function PaymentManager({ view }: { view: PaymentView }) {
  const { run, pending } = useAction();

  const [epayEnabled, setEpayEnabled] = useState(view.epay.enabled);
  const [url, setUrl] = useState(view.epay.url);
  const [pid, setPid] = useState(view.epay.pid);
  const [keySet, setKeySet] = useState(view.keySet);
  const [rotate, setRotate] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [alipay, setAlipay] = useState(view.epay.alipay);
  const [wxpay, setWxpay] = useState(view.epay.wxpay);

  const [sponsorEnabled, setSponsorEnabled] = useState(view.sponsor.enabled);
  const [tiersText, setTiersText] = useState(view.sponsor.tiers.map(fenToYuanText).join(", "));
  const [minText, setMinText] = useState(fenToYuanText(view.sponsor.minFen));
  const [maxText, setMaxText] = useState(fenToYuanText(view.sponsor.maxFen));
  const [allowAnonymous, setAllowAnonymous] = useState(view.sponsor.allowAnonymous);
  const [allowGuest, setAllowGuest] = useState(view.sponsor.allowGuest);
  const [messageMax, setMessageMax] = useState(String(view.sponsor.messageMax));

  const [ttlMinutes, setTtlMinutes] = useState(String(view.order.ttlMinutes));
  const [subjectPrefix, setSubjectPrefix] = useState(view.order.subjectPrefix);
  const [ratePerMinute, setRatePerMinute] = useState(String(view.order.ratePerMinute));

  function buildRaw(): { ok: true; raw: unknown } | { ok: false; error: string } {
    const tierTokens = tiersText
      .split(/[,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    const tiers: number[] = [];
    for (const t of tierTokens) {
      const fen = parseYuanToFen(t);
      if (fen === null) return { ok: false, error: `档位「${t}」不是合法金额（最多两位小数）` };
      tiers.push(fen);
    }
    if (tiers.length === 0) return { ok: false, error: "至少配置一个赞助档位" };

    const minFen = parseYuanToFen(minText);
    const maxFen = parseYuanToFen(maxText);
    if (minFen === null || maxFen === null) return { ok: false, error: "上下限金额不合法" };

    return {
      ok: true,
      raw: {
        epay: {
          enabled: epayEnabled,
          url,
          pid,
          // 未点「更换密钥」时提交哨兵：服务端换回库里那份（客户端根本没有它）
          key: rotate ? keyInput.trim() : KEEP_SECRET,
          alipay,
          wxpay,
        },
        sponsor: {
          enabled: sponsorEnabled,
          tiers,
          minFen,
          maxFen,
          allowAnonymous,
          allowGuest,
          messageMax: num(messageMax),
        },
        order: {
          ttlMinutes: num(ttlMinutes, 30),
          subjectPrefix,
          ratePerMinute: num(ratePerMinute, 10),
        },
      },
    };
  }

  function save(e: FormEvent) {
    e.preventDefault();
    const built = buildRaw();
    if (!built.ok) {
      toast(built.error, "error");
      return;
    }
    const raw = built.raw;
    run(async () => {
      const r = await savePaymentConfigAction(raw);
      if (r.ok) {
        if (rotate) {
          setKeySet(keyInput.trim().length > 0);
          setRotate(false);
          setKeyInput("");
        }
        toast("支付与赞助配置已保存", "success");
      }
      return r;
    });
  }

  async function resetAll() {
    const ok = await confirmDialog({
      title: "恢复支付默认配置？",
      message: "会连同商户密钥一起清空，赞助入口随即不可用。换商户或撤约时用。",
      confirmLabel: "恢复默认",
      danger: true,
    });
    if (!ok) return;
    run(async () => {
      const r = await resetPaymentConfigAction();
      if (r.ok) {
        setKeySet(false);
        setRotate(false);
        setKeyInput("");
      }
      return r;
    });
  }

  function checkChannel() {
    run(async () => {
      const r = await checkEpayChannelAction();
      if (r.ok) toast("网关连通，商户号与密钥有效", "success");
      return r;
    });
  }

  const ready = epayEnabled && !!url.trim() && !!pid.trim() && keySet;

  return (
    <form onSubmit={save} className="space-y-4">
      <div
        className={`border px-4 py-3 text-xs leading-5 ${
          ready
            ? "border-emerald-300 bg-emerald-50 text-emerald-800"
            : "border-amber-300 bg-amber-50 text-amber-800"
        }`}
      >
        <p className="flex items-center gap-1.5 font-medium">
          {ready ? <ShieldCheck size={14} aria-hidden /> : <TriangleAlert size={14} aria-hidden />}
          {ready ? "支付通道已配置齐全，前台赞助入口可用" : "支付通道尚未配置齐全，前台赞助入口不会出现"}
        </p>
        <p className="mt-1">
          密钥只存在服务端：这里显示的是「是否已配置」，不是密钥本身。保存时若未勾选更换密钥，
          提交的是「保持不变」标记，服务端会保留库里那份。全站任何页面、日志与接口响应都不会输出密钥。
        </p>
      </div>

      <Group
        icon={KeyRound}
        title="易支付通道"
        desc="聚合网关：与它签一次约，由它分派到支付宝 / 微信。签名算法 = md5(按参数名升序拼接 + 商户密钥)。"
      >
        <Toggle id="ep-enabled" label="启用支付通道" checked={epayEnabled} onChange={setEpayEnabled} />
        <Field
          id="ep-url"
          label="网关地址"
          hint="不带 /submit.php 等路径，例如 https://pay.example.com"
        >
          <input
            id="ep-url"
            value={url}
            maxLength={300}
            onChange={(e) => setUrl(e.target.value)}
            className={`${INPUT_SM} w-full`}
          />
        </Field>
        <Field id="ep-pid" label="商户 ID">
          <input
            id="ep-pid"
            value={pid}
            maxLength={64}
            onChange={(e) => setPid(e.target.value)}
            className={`${INPUT_SM} w-full`}
          />
        </Field>
        <Field
          label="商户密钥"
          hint="机密字段，只提交给服务端。留空即清空密钥（会立刻让通道失效）。"
        >
          <div className="space-y-2">
            <p className="text-[11px] text-neutral-500">
              当前状态：
              <span className={keySet ? "font-medium text-emerald-700" : "font-medium text-amber-700"}>
                {keySet ? "已配置" : "未配置"}
              </span>
            </p>
            <label className="flex cursor-pointer items-center gap-2 text-[11px] text-neutral-600">
              <input
                type="checkbox"
                checked={rotate}
                onChange={(e) => setRotate(e.target.checked)}
                className="h-4 w-4 shrink-0 rounded-none border border-brand-300 accent-brand-500 outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              />
              更换密钥
            </label>
            {rotate && (
              <>
                <input
                  id="ep-key"
                  type="password"
                  autoComplete="new-password"
                  value={keyInput}
                  maxLength={200}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder={keySet ? "留空保存 = 清空密钥" : "粘贴新密钥"}
                  className={`${INPUT_SM} w-full`}
                />
                {keySet && keyInput.trim().length === 0 && (
                  <p className="text-[11px] text-red-600">保存后密钥将被清空，支付通道随即不可用。</p>
                )}
              </>
            )}
          </div>
        </Field>
        <Toggle id="ep-alipay" label="开放支付宝渠道" checked={alipay} onChange={setAlipay} />
        <Toggle id="ep-wxpay" label="开放微信支付渠道" checked={wxpay} onChange={setWxpay} />
      </Group>

      <Group
        icon={ShieldCheck}
        title="站点赞助"
        desc="文案纪律：只讲「赞助 / 支持」，不出现「VIP / 会员 / 解锁 / 特权」。赞助是支持，不是买权益。"
      >
        <Toggle id="sp-enabled" label="显示赞助入口" checked={sponsorEnabled} onChange={setSponsorEnabled} />
        <Field id="sp-tiers" label="预设档位（元）" hint="用逗号分隔，2–8 个；前台还会另附自定义金额输入。">
          <input
            id="sp-tiers"
            value={tiersText}
            onChange={(e) => setTiersText(e.target.value)}
            className={`${INPUT_SM} w-full tabular-nums`}
          />
        </Field>
        <Field id="sp-min" label="单笔下限（元）">
          <input
            id="sp-min"
            value={minText}
            onChange={(e) => setMinText(e.target.value)}
            className={`${INPUT_SM} w-full tabular-nums`}
          />
        </Field>
        <Field id="sp-max" label="单笔上限（元）">
          <input
            id="sp-max"
            value={maxText}
            onChange={(e) => setMaxText(e.target.value)}
            className={`${INPUT_SM} w-full tabular-nums`}
          />
        </Field>
        <Toggle id="sp-anon" label="允许匿名赞助" checked={allowAnonymous} onChange={setAllowAnonymous} />
        <Toggle id="sp-guest" label="允许未登录赞助" checked={allowGuest} onChange={setAllowGuest} />
        <Field id="sp-msg" label="留言最大字数" hint="0 = 不允许留言。">
          <input
            id="sp-msg"
            type="number"
            inputMode="numeric"
            min={0}
            max={200}
            value={messageMax}
            onChange={(e) => setMessageMax(e.target.value)}
            className={`${INPUT_SM} w-full tabular-nums`}
          />
        </Field>
      </Group>

      <Group icon={ShieldCheck} title="订单参数" desc="订单有效期与创建频率限制，用于防刷单探测。">
        <Field id="od-ttl" label="订单有效期（分钟）" hint="超时视为关闭，前台显示「已超时」。">
          <input
            id="od-ttl"
            type="number"
            inputMode="numeric"
            min={5}
            max={1440}
            value={ttlMinutes}
            onChange={(e) => setTtlMinutes(e.target.value)}
            className={`${INPUT_SM} w-full tabular-nums`}
          />
        </Field>
        <Field id="od-prefix" label="商品名前缀" hint="提交给网关的商品名，便于在商户后台一眼认出本站订单。">
          <input
            id="od-prefix"
            value={subjectPrefix}
            maxLength={40}
            onChange={(e) => setSubjectPrefix(e.target.value)}
            className={`${INPUT_SM} w-full`}
          />
        </Field>
        <Field id="od-rate" label="下单频率上限（次 / 分钟 / IP）">
          <input
            id="od-rate"
            type="number"
            inputMode="numeric"
            min={1}
            max={120}
            value={ratePerMinute}
            onChange={(e) => setRatePerMinute(e.target.value)}
            className={`${INPUT_SM} w-full tabular-nums`}
          />
        </Field>
      </Group>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" disabled={pending} className="min-h-9">
          保存配置
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={checkChannel} className="min-h-9">
          <ShieldCheck size={13} aria-hidden /> 通道连通性自检
        </Button>
        <Button
          type="button"
          variant="danger"
          disabled={pending}
          onClick={resetAll}
          className="min-h-9"
        >
          <RotateCcw size={13} aria-hidden /> 恢复默认
        </Button>
      </div>
    </form>
  );
}
