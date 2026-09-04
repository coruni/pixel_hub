// searchParams 解析工具：Next 16 的 searchParams 是 Promise<Record<string, string | string[] | undefined>>，
// 各页面重复手写取值/白名单/兜底逻辑，统一收敛到这里。

export type SP = Record<string, string | string[] | undefined>;

/** 取单值参数（多值/非字符串返回 undefined） */
export function str(sp: SP, key: string): string | undefined {
  const v = sp[key];
  return typeof v === "string" ? v : undefined;
}

/** 取正整数参数（非法/缺失回退 fallback） */
export function intParam(sp: SP, key: string, fallback: number): number {
  const raw = parseInt(str(sp, key) ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** 取白名单枚举参数（不在 allowed 内回退 fallback） */
export function enumParam<T extends readonly string[]>(
  sp: SP,
  key: string,
  allowed: T,
  fallback: T[number]
): T[number] {
  const raw = str(sp, key);
  return (allowed as readonly string[]).includes(raw ?? "") ? (raw as T[number]) : fallback;
}

/** 登录回跳地址：只接受站内路径，拒绝协议相对 URL（//evil.com）与外链 */
export function safeCallbackUrl(sp: SP, fallback = "/"): string {
  const raw = str(sp, "callbackUrl") ?? fallback;
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : fallback;
}
