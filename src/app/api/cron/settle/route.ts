// 结算补跑端点 —— 供宿主 cron / 计划任务显式调用，用于补齐进程内定时器覆盖不到的场景：
//   · 停机数周后一次性追平历史缺口
//   · 偿付闸门通过后手工催一次，不用等 `autoRetryHours`
//   · 与 `settlement.autoEnabled` 开关无关地**手动跑一次**（开关只管自动定时器）
//
// 【鉴权】必须配 `CRON_SECRET`，用 `Authorization: Bearer <secret>`（或 `?token=`）。
// 没配就整体 503 —— 宁可不工作，也不能有一个裸奔的「发钱」端点。
//
// 【先预演再动真格】带 `dryRun=1`（或 body `{ "dryRun": true }`）时只算不写，
// 返回「将会确认哪几期、各入账多少 PIX」。开启自动结算前建议先跑一次预演。
//
// 【为什么不做成 GET】写完就能被预览/爬虫/浏览器预取而触发；只收 POST。
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runAutoSettle, summarize } from "@/lib/settle-auto";
import { isPeriodKey } from "@/lib/settle-allocate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 常量时间比较；长度不同直接否（长度本身不是秘密） */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function providedSecret(req: Request): string {
  const header = req.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(header.trim())?.[1];
  if (bearer) return bearer.trim();
  return new URL(req.url).searchParams.get("token")?.trim() ?? "";
}

export async function POST(req: Request): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET ?? "";
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "未配置 CRON_SECRET，补跑端点已禁用" },
      { status: 503 },
    );
  }
  if (!secretMatches(providedSecret(req), expected)) {
    return NextResponse.json({ ok: false, error: "鉴权失败" }, { status: 401 });
  }

  const url = new URL(req.url);
  const body = (await req.json().catch(() => ({}))) as {
    from?: unknown;
    to?: unknown;
    dryRun?: unknown;
  };
  const from = typeof body.from === "string" ? body.from : undefined;
  const to = typeof body.to === "string" ? body.to : undefined;
  // 预演：只算不写。用 query 或 body 任一声明都行 —— 手工 curl 时 query 更省事。
  const dryRun = body.dryRun === true || url.searchParams.get("dryRun") === "1";
  if (from && !isPeriodKey(from)) {
    return NextResponse.json({ ok: false, error: "from 应为 YYYY-MM" }, { status: 400 });
  }
  if (to && !isPeriodKey(to)) {
    return NextResponse.json({ ok: false, error: "to 应为 YYYY-MM" }, { status: 400 });
  }
  if (from && to && from > to) {
    return NextResponse.json({ ok: false, error: "from 不能晚于 to" }, { status: 400 });
  }

  try {
    const result = await runAutoSettle({ force: true, fromKey: from, toKey: to, dryRun });
    console.log(summarize(result));
    return NextResponse.json({ ok: true, summary: summarize(result), ...result });
  } catch (e) {
    // 细节只进服务端日志；响应体不暴露 SQL/连接串等内部信息
    console.error("[settle:auto] 补跑端点异常:", e);
    return NextResponse.json({ ok: false, error: "补跑执行失败，详见服务端日志" }, { status: 500 });
  }
}
