// 站内通知的唯一写入入口：站内开关过滤、重复去重、点赞聚合统一收在这里，
// 各 action 只负责描述「通知谁 / 谁触发 / 说什么」。
//
// 注意：本文件不加 "use server" —— 它只作为模块被 action 内部调用（同 _guards.ts），
// 导出纯函数不暴露成 server action 端点。
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { notifyByEmail, notifySecurityEmail } from "@/lib/mail-notify";

export type NotifyType = "LIKE" | "COMMENT" | "FOLLOW" | "MODERATION" | "SECURITY" | "SYSTEM";

type PrefRow = {
  inAppNotifyLike: boolean;
  inAppNotifyComment: boolean;
  inAppNotifyFollow: boolean;
  inAppNotifySystem: boolean;
};

// SECURITY 刻意不在此表内：账号安全提醒强制送达，用户关不掉（见 inAppEnabled）
const PREF_OF: Record<Exclude<NotifyType, "SECURITY">, keyof PrefRow> = {
  LIKE: "inAppNotifyLike",
  COMMENT: "inAppNotifyComment",
  FOLLOW: "inAppNotifyFollow",
  MODERATION: "inAppNotifySystem",
  SYSTEM: "inAppNotifySystem",
};

/** 点赞聚合窗口：同一资源、同一批未读里的多个赞并成一条 */
const COALESCE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type NotifyInput = {
  userId: string;
  actorId?: string | null;
  type: NotifyType;
  resourceId?: string | null;
  commentId?: string | null;
  message?: string | null;
  /**
   * 去重/聚合开关：
   *   同一 (actor, type, resource) 已有未读通知 → 不再叠加（取消赞/取关后再操作不重复轰炸）
   *   LIKE 且同资源已有未读通知 → 合并进该条并递增 count（「X 等 N 人赞了你」）
   */
  coalesce?: boolean;
};

/**
 * 写一条站内通知。失败只记日志、不抛出 —— 通知是副通道，不能拖垮主流程
 * （点赞/评论/审核等动作的成败由它们自己的事务决定）。
 *
 * @param tx 需要与业务写入原子时传入事务客户端（如「下架 + 通知」同事务）
 */
export async function createNotification(
  input: NotifyInput,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const { userId, actorId, type } = input;
  if (!userId) return;
  // 自己触发的动作不提醒自己（管理员操作自己的内容同理）
  if (actorId && actorId === userId) return;

  const db = tx ?? prisma;
  const resourceId = input.resourceId ?? null;
  const commentId = input.commentId ?? null;

  try {
    // 站内开关检查：SECURITY 强制送达，其余按类型查用户开关（放在 tx 内，随事务一起生效）
    if (type !== "SECURITY") {
      const row = await db.user.findUnique({
        where: { id: userId },
        select: {
          inAppNotifyLike: true,
          inAppNotifyComment: true,
          inAppNotifyFollow: true,
          inAppNotifySystem: true,
        },
      });
      if (!row || row[PREF_OF[type]] === false) return;
    }

    if (input.coalesce) {
      const dup = await db.notification.findFirst({
        where: { userId, actorId: actorId ?? null, type, resourceId, readAt: null },
        select: { id: true },
      });
      if (dup) return; // 同一人的重复动作：保留既有那条，不叠加不刷屏

      if (type === "LIKE" && resourceId) {
        const merged = await db.notification.findFirst({
          where: {
            userId,
            type: "LIKE",
            resourceId,
            readAt: null,
            createdAt: { gte: new Date(Date.now() - COALESCE_WINDOW_MS) },
          },
          orderBy: { createdAt: "desc" },
          select: { id: true, count: true },
        });
        if (merged) {
          await db.notification.update({
            where: { id: merged.id },
            data: {
              actorId: actorId ?? null,
              count: merged.count + 1,
              createdAt: new Date(), // 重新置顶，最近点赞者作为展示头像/名字
            },
          });
          return;
        }
      }
    }

    await db.notification.create({
      data: {
        userId,
        actorId: actorId ?? null,
        type,
        resourceId,
        commentId,
        message: input.message ?? null,
      },
    });
  } catch (e) {
    console.error("[notify]", type, userId, e);
  }
}

/** 治理侧提醒：给每位在职 ADMIN / MODERATOR 各发一条（举报、待审投稿等） */
export async function notifyStaff(input: Omit<NotifyInput, "userId">): Promise<void> {
  try {
    const staff = await prisma.user.findMany({
      where: { role: { in: ["ADMIN", "MODERATOR"] }, bannedAt: null },
      select: { id: true },
    });
    // 封禁用户不参与治理队列；actor 与收件人相同时 createNotification 内部会跳过
    await Promise.all(staff.map((s) => createNotification({ ...input, userId: s.id })));
  } catch (e) {
    console.error("[notifyStaff]", e);
  }
}

/** 顶部导航未读角标数据源 */
export async function getUnreadNotificationCount(userId: string): Promise<number> {
  try {
    return await prisma.notification.count({ where: { userId, readAt: null } });
  } catch {
    return 0;
  }
}

/**
 * 账号安全提醒：站内 SECURITY + 邮件双通道，两者都绕过用户开关。
 * 改密、换邮箱、封禁解封、角色变更这类事件用户必须知情——否则账号被动手脚时无人察觉。
 *
 * @param mailTo 指定收件地址。换邮箱场景必须传「旧邮箱」：新邮箱一生效，
 *               旧邮箱就是唯一还能触达本人的通道。
 */
export async function notifyAccountSecurity(
  userId: string,
  subject: string,
  detail: string,
  mailTo?: string,
): Promise<void> {
  await createNotification({ userId, type: "SECURITY", message: detail });
  try {
    if (mailTo) {
      await notifySecurityEmail(mailTo, subject, detail);
      return;
    }
    await notifyByEmail(userId, subject, detail, "/settings", "security");
  } catch (e) {
    console.error("[notify-security]", subject, e);
  }
}
