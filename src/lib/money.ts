// 金额换算与展示 —— 纯函数，前后端共用。
//
// 【精度纪律】全链路金额以整数「分」存储与运算。**禁止 `parseFloat(x) * 100`** ——
// `parseFloat("0.29") * 100 === 28.999999999999996`，`Math.round` 能救这一例，
// 但救不了所有例子，而且它把「本该报错的输入」静默变成「一个差不多对的钱」。
// 本文件一律走字符串解析：拆出整数位与两位小数，整数运算完成换算。
//
// 元只在两处出现：用户输入（赞助金额 / 提现金额）与展示（¥ 前缀 + 两位小数）。

/** 元 → 分。合法输入：`"1"` / `"1.5"` / `"0.29"`（≤2 位小数，可带首尾空格）。非法返回 null */
export function parseYuanToFen(input: string | number): number | null {
  const s = String(input ?? "").trim();
  // 允许前导 +，不接受负号（金额为负在这里一定是调用方逻辑错了）
  const m = /^\+?(\d{1,12})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const yuan = Number(m[1] ?? "0");
  const cent = Number((m[2] ?? "").padEnd(2, "0") || "0");
  const fen = yuan * 100 + cent;
  return Number.isSafeInteger(fen) ? fen : null;
}

/** 分 → 元字符串（两位小数，无千分位、无符号）。库里 / 上游回执一律用这个口径 */
export function fenToYuanText(fen: number): string {
  const n = Math.trunc(fen);
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** 分 → 展示金额 `¥12.30`（带千分位）。前台/后台统一用它，避免各处各拼一遍 */
export function formatYuan(fen: number): string {
  return `¥${formatFenWithSeparator(fen)}`;
}

/** 分 → `1,234.56`（不带符号；表格里金额列与 `¥` 分列时用） */
export function formatFenWithSeparator(fen: number): string {
  const text = fenToYuanText(fen);
  const [intPart = "0", decPart = "00"] = text.split(".");
  const sign = intPart.startsWith("-") ? "-" : "";
  const digits = sign ? intPart.slice(1) : intPart;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}.${decPart}`;
}

/** 分 → `12.30 元`（中文文案里用） */
export function yuanText(fen: number): string {
  return `${fenToYuanText(fen)} 元`;
}

/** PIX → `1,234 PIX`（千分位；前台 PIX 一律带符号与千分位） */
export function formatCoin(coin: number, symbol = "PIX"): string {
  const n = Math.trunc(coin);
  const sign = n < 0 ? "-" : "";
  return `${sign}${Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")} ${symbol}`;
}

/**
 * 上游回执金额解析（易支付 `money` 字段是元字符串）。
 * 与用户输入同一套规则：**严格解析，非法即拒绝**（绝不「差不多就行」——
 * 这里差一分钱就是「付款一块钱拿到十块钱的东西」）。
 */
export function parseGatewayMoney(input: string): number | null {
  return parseYuanToFen(input);
}
