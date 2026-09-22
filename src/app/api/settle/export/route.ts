import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { periodPayouts } from "@/lib/settle";
import { isPeriodKey } from "@/lib/settle-allocate";
import { fenToYuanText } from "@/lib/money";
import { permilleText } from "@/lib/points-config";

// 结算明细导出（CSV）。
//
// 【为什么只导出已确认的期】草稿随时可能被重算 —— 导出一份「暂时是这样」的分配表，
// 拿它去跟创作者对账，比不导出更糟。锁定过的快照才是可对外引用的数字。
//
// 【权限】仅管理员。路由而非 server action：这是文件下载（Content-Disposition），
// 不是会被序列化回页面的返回值。
export const dynamic = "force-dynamic";

/** CSV 单元格转义：含分隔符/引号/换行时加引号；防公式注入（以 = + - @ 开头会被 Excel 求值） */
function cell(v: string | number): string {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

function line(cells: (string | number)[]): string {
  return cells.map(cell).join(",");
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return new Response("forbidden", { status: 403 });
  }

  const periodKey = (req.nextUrl.searchParams.get("period") ?? "").trim();
  if (!isPeriodKey(periodKey)) {
    return new Response("bad period", { status: 400 });
  }

  const period = await prisma.incentivePeriod.findUnique({ where: { periodKey } });
  if (!period) return new Response("period not found", { status: 404 });
  if (period.status === "DRAFT") {
    return new Response("draft period cannot be exported", { status: 400 });
  }

  const payouts = await periodPayouts(period.id);

  const rows: string[] = [
    line(["归属期", period.periodKey]),
    line(["状态", period.status === "PAID" ? "已发放" : "已确认"]),
    line(["本期收入(元)", fenToYuanText(period.revenueFen)]),
    line(["分成比例", permilleText(period.ratePermille)]),
    line(["上期结转(元)", fenToYuanText(period.carryInFen)]),
    line(["本期货池(元)", fenToYuanText(period.poolFen)]),
    line(["已发放(元)", fenToYuanText(period.paidFen)]),
    line(["结转下期(元)", fenToYuanText(period.carryOutFen)]),
    line(["参与总分", period.totalScore]),
    line(["参与人数", payouts.length]),
    line(["确认时间", period.confirmedAt ? period.confirmedAt.toISOString() : ""]),
    "",
    line(["名次", "创作者", "用户名", "贡献分", "金额(元)", "折合代币", "是否封顶"]),
    ...payouts.map((p) =>
      line([
        p.rank,
        p.name ?? p.username,
        p.username,
        p.score,
        fenToYuanText(p.amountFen),
        p.coin,
        p.capped ? "是" : "否",
      ]),
    ),
  ];

  // BOM：Excel 打开 UTF-8 CSV 不乱码的唯一可靠办法
  const body = `\ufeff${rows.join("\r\n")}\r\n`;
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="settlement-${periodKey}.csv"`,
      "cache-control": "no-store",
    },
  });
}
