import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth";
import { getPointBalance } from "@/lib/points";
import { levelOf } from "@/lib/points-config";
import { getIncentive } from "@/lib/incentive";
import { profileBgUnlocked, safeBgMask } from "@/lib/upload-config";
import { publicUrl } from "@/lib/storage/url";
import GlobalProfileBg from "./GlobalProfileBg";

// 主页背景「全局显示」的服务端取数层（客户端渲染见 GlobalProfileBg.tsx）。
//
// 单独拆一层的原因：客户端组件不能连数据库，而根 layout 是 Server Component，
// 正好在这里把「有没有资格铺 + 铺什么图」算清楚，只把结果（url / mask）递下去。
//
// 【短路顺序：先开关、再点数】绝大多数用户没开全局，连 getPointBalance 都不会发生。
export default async function GlobalProfileBgLoader() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true, profileBgPcKey: true, profileBgGlobal: true, profileBgMask: true },
  });
  if (!me?.profileBgGlobal || !me.profileBgPcKey) return null;

  // 等级必须**现算**：门槛与档位后台可改，用户也可能掉档。判定复用 profileBgUnlocked()，
  // 与个人主页 / 资源详情页 / 设置页同一个函数，口径只有一份。
  const incentive = await getIncentive();
  const unlocked = profileBgUnlocked(
    levelOf(await getPointBalance(userId), incentive.levels),
    incentive.profile.bgMinLevel,
    incentive.enabled,
  );
  if (!unlocked) return null;

  return (
    <GlobalProfileBg
      url={publicUrl(me.profileBgPcKey)}
      mask={safeBgMask(me.profileBgMask)}
      myUsername={me.username}
    />
  );
}
