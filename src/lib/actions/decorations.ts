"use server";

// 装饰类 Server Action：昵称特效色。
//
// 【为什么不塞进 settings.ts】那个文件已经混了资料、安全、外观、上传多个领域，行数逼近治理目标；
// 装饰是独立职责，单独成文件后规则也集中在一处，不必在几百行里找。
//
// 【两条纪律】
//   ① **门槛在服务端重算**。客户端只是不渲染锁定项，绕过前端也必须选不上来 ——
//      与设置页共用 decorations.ts 的 decorationUnlocked()，口径只有一份。
//   ② **不扣贡献分**。装饰只按等级开放，落库只写用户的选择，绝不写 PointLog / UserPoint。
//      贡献分是荣誉层（只增不减），扣它等于掉级，会连带把已达标的其他装饰一起打回锁定。

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { getIncentive } from "@/lib/incentive";
import { getContributionSummary } from "@/lib/points";
import { decorationUnlocked, nameColorOf } from "@/lib/decorations";
import type { SettingsActionState } from "./settings";

/**
 * 服务端权威判定：等级不够直接拒绝，并把「还差哪一档」写进错误文案。
 * 门槛可能指向一个不存在的档位（管理员裁掉了等级）—— 那时只能说「尚未开放」，不能编一个名字。
 */
async function decorationGate(
  userId: string,
  minLevel: number,
  what: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [incentive, summary] = await Promise.all([getIncentive(), getContributionSummary(userId)]);
  if (decorationUnlocked(summary.level, minLevel, incentive.enabled)) return { ok: true };
  const need = [...incentive.levels].sort((a, b) => a.min - b.min)[minLevel]?.name;
  return { ok: false, error: need ? `${what}需达到「${need}」等级后开放` : `${what}目前未对你开放` };
}

/**
 * 保存昵称特效色。提交空值 = 恢复站点默认色（不需要等级，任何时候都能取消装饰）。
 */
export async function updateNameColorAction(
  _prev: SettingsActionState,
  fd: FormData,
): Promise<SettingsActionState> {
  const user = (await auth())?.user;
  if (!user) return { error: "请先登录" };

  const incentive = await getIncentive();
  if (!incentive.decoration.nicknameEnabled) return { error: "昵称特效色当前未开放" };

  const raw = String(fd.get("nameColor") ?? "").trim();
  if (raw) {
    const color = nameColorOf(raw);
    if (!color) return { error: "未知的配色，请重新选择" };
    const gate = await decorationGate(user.id, color.minLevel, `昵称「${color.name}」色`);
    if (!gate.ok) return { error: gate.error };
  }

  try {
    await prisma.user.update({ where: { id: user.id }, data: { nameColor: raw || null } });
    // 昵称色出现在评论、资源卡、主页、悬浮卡等几乎每一处 → 整站 layout 失效，不做逐路径枚举
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    console.error("[name-color]", e);
    return { error: "保存失败，请重试" };
  }
}
