import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { ensureIncentive, getIncentive } from "@/lib/incentive";
import IncentiveManager from "@/components/admin/IncentiveManager";
import AdjustPanel from "@/components/admin/AdjustPanel";

export const metadata: Metadata = { title: "创作者激励" };

export default async function AdminIncentivePage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/admin");

  // 首次进入自动落库默认配置，保证页面上看到的就是库里那份
  await ensureIncentive();
  const config = await getIncentive();

  // 冻结名单在页面上展示成「用户名」而不是裸 id —— 名单是给人看的，cuid 没法核对
  const frozenIds = config.risk.frozenUserIds;
  const frozenUsers = frozenIds.length
    ? await prisma.user.findMany({
        where: { id: { in: frozenIds } },
        select: { id: true, username: true, name: true },
      })
    : [];
  const byId = new Map(frozenUsers.map((u) => [u.id, u]));
  const frozenNames = frozenIds.map((id) => {
    const u = byId.get(id);
    return { id, label: u ? (u.name ?? u.username) : `${id.slice(0, 8)}…（已不存在）` };
  });

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-medium text-neutral-900">创作者激励</h2>
        <p className="mt-0.5 text-xs text-neutral-500">
          贡献分值与结算权重、等级门槛、下载防刷、PIX 与提现门槛、分成比例与资金安全水位、榜单与公示。
          全部阈值都在这里配置，代码里不写死任何业务数值。仅管理员可见。
        </p>
      </div>
      <IncentiveManager config={config} frozenNames={frozenNames} />
      <AdjustPanel symbol={config.coin.symbol} />
    </div>
  );
}
