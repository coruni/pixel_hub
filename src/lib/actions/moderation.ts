"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { queueIndexNowForResource } from "@/lib/indexnow";
import { notifyByEmail } from "@/lib/mail-notify";
import { adminOnly, audit, staff } from "@/lib/actions/_guards";
import { createNotification, notifyAccountSecurity } from "@/lib/notify";
import { awardPoints } from "@/lib/points";
import type { Prisma } from "@prisma/client";

async function notifyMod(userId: string, actorId: string, resourceId: string, message: string) {
  if (!userId || userId === actorId) return;
  await createNotification({ userId, actorId, type: "MODERATION", resourceId, message });

  // 审核结果邮件提醒：after() 在响应后继续执行（不丢任务，也不拖慢 action）
  after(async () => {
    const resource = await prisma.resource
      .findUnique({ where: { id: resourceId }, select: { slug: true, title: true } })
      .catch(() => null);
    if (!resource) return;
    await notifyByEmail(
      userId,
      "你的投稿有审核结果",
      `《${resource.title}》：${message}`,
      `/resources/${resource.slug}`,
      "moderation",
    );
  });
}

/**
 * 账号安全 / 权限变动提醒：站内 SECURITY + 邮件，两者都不受用户开关与限额影响
 * （通知本身的构造见 lib/notify.ts 的 notifyAccountSecurity）。
 */

/** 「审核与系统」类站内提醒（无需邮件）：如给举报人的处理回执 */
async function notifyFeedback(
  userId: string,
  message: string,
  resourceId?: string | null,
): Promise<void> {
  await createNotification({ userId, type: "MODERATION", resourceId: resourceId ?? null, message });
}

// ---------- 审核队列 ----------
export async function approveResourceAction(
  resourceId: string,
): Promise<{ ok: boolean; error?: string }> {
  const admin = await staff();
  if (!admin) return { ok: false, error: "无权限" };
  const r = await prisma.resource.findUnique({
    where: { id: resourceId },
    select: { id: true, authorId: true },
  });
  if (!r) return { ok: false, error: "资源不存在" };

  await prisma.resource.update({
    where: { id: resourceId },
    data: { status: "PUBLISHED", publishedAt: new Date(), rejectReason: null },
  });
  await audit(admin.id, "APPROVE", "RESOURCE", resourceId);
  await notifyMod(r.authorId, admin.id, resourceId, "你的内容已通过审核并上架 🎉");
  // 投稿奖励（贡献分）：refId=资源 id，同一作品只奖励一次 —— 下架后再上架不重复得分。
  // actorId 记审核人：PUBLISH 是作者的产出奖励，不属于「自产自销」拦截范围。
  after(() =>
    awardPoints({
      userId: r.authorId,
      actorId: admin.id,
      reason: "PUBLISH",
      refId: resourceId,
    }),
  );
  queueIndexNowForResource(resourceId); // 上架即告知搜索引擎（未启用 IndexNow 时内部直接跳过）
  revalidatePath("/admin");
  revalidatePath("/admin/queue");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function rejectResourceAction(
  resourceId: string,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const admin = await staff();
  if (!admin) return { ok: false, error: "无权限" };
  const clean = reason.trim().slice(0, 300);
  if (!clean) return { ok: false, error: "请填写打回原因" };
  const r = await prisma.resource.findUnique({
    where: { id: resourceId },
    select: { id: true, authorId: true },
  });
  if (!r) return { ok: false, error: "资源不存在" };

  await prisma.resource.update({
    where: { id: resourceId },
    data: { status: "REJECTED", rejectReason: clean },
  });
  await audit(admin.id, "REJECT", "RESOURCE", resourceId, clean);
  await notifyMod(r.authorId, admin.id, resourceId, `内容被打回：${clean}`);
  revalidatePath("/admin");
  revalidatePath("/admin/queue");
  return { ok: true };
}

// ---------- 审核队列：就地修正可见性标注 ----------
//
// 审核时最常见的两种「标注错」：该打 NSFW 没打、外链/成人向内容没要求登录。此前只能跳去
// /admin/content/{id}/edit 那个整页表单 —— 标题、正文、媒体、标签全得原样带一遍，为了改一个布尔
// 不值当，而漏改的代价是把该遮的内容直接放上站。
//
// 只开这三个布尔，**不开**文本 / 媒体 / 类型 / 分类：改那些要跑整条改稿校验（meta 形状、标签同步、
// 媒体认领），在审核路径上重演一遍就是让两套写库逻辑分叉。它们仍走编辑页。
//
// 权限用 staff（版主 + 管理员）而不是 adminOnly：通过 / 打回本来就归版主，判定标注与之同级；
// 置顶 / 精华那种会改变全站排序的站点级干预才是 adminOnly。
const FLAG_KEYS = ["nsfw", "loginRequired", "allowComments"] as const;

/** 仅供审计日志的人话名（不是 UI 文案的事实来源 —— 那边是 wizard-shared 的 PUBLISH_OPTIONS） */
const FLAG_LABEL: Record<(typeof FLAG_KEYS)[number], string> = {
  nsfw: "NSFW",
  loginRequired: "下载需登录",
  allowComments: "允许评论",
};

export async function setResourceFlags(
  resourceId: string,
  flags: Record<(typeof FLAG_KEYS)[number], boolean>,
): Promise<{ ok: boolean; error?: string }> {
  const admin = await staff();
  if (!admin) return { ok: false, error: "无权限" };

  // 逐字段显式取值而不是 spread 入参：入参是不可信输入，多带一个键就会被一并写进库
  const data = {
    nsfw: flags.nsfw === true,
    loginRequired: flags.loginRequired === true,
    allowComments: flags.allowComments === true,
  };

  const before = await prisma.resource.findUnique({
    where: { id: resourceId },
    select: { title: true, nsfw: true, loginRequired: true, allowComments: true },
  });
  if (!before) return { ok: false, error: "资源不存在" };

  // 三个键是一次性提交的，但只把真正变了的写进审计 —— 否则日志会被「点了一次没改动」的操作淹没
  const changed = FLAG_KEYS.filter((k) => before[k] !== data[k]);
  if (changed.length === 0) return { ok: true };

  await prisma.resource.update({ where: { id: resourceId }, data });
  await audit(
    admin.id,
    "EDIT_RESOURCE_FLAGS",
    "RESOURCE",
    resourceId,
    `${before.title}：${changed
      .map((k) => `${FLAG_LABEL[k]} ${before[k] ? "开" : "关"} → ${data[k] ? "开" : "关"}`)
      .join("；")}`,
  );

  revalidatePath("/admin/queue");
  revalidatePath("/admin/content");
  // NSFW / 登录可见会改变前台的可见性与列表构成，与下架 / 恢复同一口径
  revalidatePath("/", "layout");
  return { ok: true };
}

// ---------- 内容库：下架 / 恢复 ----------
export async function setResourceRemoved(
  resourceId: string,
): Promise<{ ok: boolean; error?: string }> {
  const admin = await staff();
  if (!admin) return { ok: false, error: "无权限" };
  const r = await prisma.resource.updateMany({
    where: { id: resourceId },
    data: { status: "REMOVED" },
  });
  if (r.count === 0) return { ok: false, error: "资源不存在" };
  const res = await prisma.resource.findUnique({
    where: { id: resourceId },
    select: { title: true, authorId: true },
  });
  await audit(admin.id, "REMOVE_RESOURCE", "RESOURCE", resourceId, res?.title);
  if (res)
    await notifyMod(res.authorId, admin.id, resourceId, "你的内容已被下架，如有疑问请联系管理员");
  revalidatePath("/admin");
  revalidatePath("/admin/content");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function restoreResource(
  resourceId: string,
): Promise<{ ok: boolean; error?: string }> {
  const admin = await staff();
  if (!admin) return { ok: false, error: "无权限" };
  const r = await prisma.resource.updateMany({
    where: { id: resourceId },
    data: { status: "PUBLISHED", publishedAt: new Date(), rejectReason: null },
  });
  if (r.count === 0) return { ok: false, error: "资源不存在" };
  const res = await prisma.resource.findUnique({
    where: { id: resourceId },
    select: { title: true, authorId: true },
  });
  await audit(admin.id, "RESTORE", "RESOURCE", resourceId);
  // 恢复上架必须告知作者：否则他会以为内容还处在下架状态，重复投稿或来问
  if (res) await notifyMod(res.authorId, admin.id, resourceId, "你的内容已恢复上架 🎉");
  queueIndexNowForResource(resourceId); // 恢复上架同样需要重新告知搜索引擎
  revalidatePath("/admin");
  revalidatePath("/admin/content");
  revalidatePath("/", "layout");
  return { ok: true };
}

// ---------- 内容库：置顶 / 精华（仅 ADMIN）----------
//
// 两个标记都是运营动作，但语义不同：
//   - 置顶（pinnedAt）：参与资源流排序，是 getFeed 的**第一排序键**（pinnedAt DESC NULLS LAST），
//     越晚置顶越靠前 —— 想排定序就按想要的顺序倒着点；
//   - 精华（featuredAt）：只做展示（卡片 / 详情页角标）+ 首页精选位联动的依据，不影响排序。
// 都用时间戳而不是布尔：null 即未标记，同时白拿「什么时候标的」，排序与展示都要用。
//
// 权限用 adminOnly 而不是 staff：置顶会**直接改变全站排序**，属于站点级干预；
// 版主能改内容状态就够，排序干预留给管理员（与产品口径「仅管理员可设」一致）。

/** 置顶 / 取消置顶 */
export async function setResourcePinned(
  resourceId: string,
  pinned: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  const r = await prisma.resource.updateMany({
    where: { id: resourceId },
    data: { pinnedAt: pinned ? new Date() : null },
  });
  if (r.count === 0) return { ok: false, error: "资源不存在" };
  const res = await prisma.resource.findUnique({
    where: { id: resourceId },
    select: { title: true },
  });
  await audit(
    admin.id,
    pinned ? "PIN_RESOURCE" : "UNPIN_RESOURCE",
    "RESOURCE",
    resourceId,
    res?.title,
  );
  revalidatePath("/admin/content");
  // 排序变了 → 所有列表页都可能受影响，走 layout 级失效（与下架/恢复同一口径）
  revalidatePath("/", "layout");
  return { ok: true };
}

/** 精华 / 取消精华（首次设为精华时给作者记一笔 FEATURED 积分） */
export async function setResourceFeatured(
  resourceId: string,
  featured: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };

  const row = await prisma.resource.findUnique({
    where: { id: resourceId },
    select: { title: true, authorId: true },
  });
  if (!row) return { ok: false, error: "资源不存在" };

  await prisma.resource.update({
    where: { id: resourceId },
    data: { featuredAt: featured ? new Date() : null },
  });
  await audit(
    admin.id,
    featured ? "FEATURE_RESOURCE" : "UNFEATURE_RESOURCE",
    "RESOURCE",
    resourceId,
    row.title,
  );

  // 「被精选」积分只在**首次**设为精华时发一次：幂等键是 awardPoints 内部
  // (userId, reason, refId) 上的唯一索引，取消再设、并发重复点都会被它挡掉（P2002 静默），
  // 所以这里不用自己查历史流水。分值为 0 或配置里关了总开关时，它自己会返回 false。
  // 管理员给自己的资源点精华会被 NO_SELF_BENEFIT 拦下（防自刷），这也是既有口径。
  if (featured) {
    await awardPoints({
      userId: row.authorId,
      actorId: admin.id,
      reason: "FEATURED",
      refId: resourceId,
    });
  }

  revalidatePath("/admin/content");
  revalidatePath("/", "layout");
  return { ok: true };
}

// ---------- 举报 ----------
// 按「同一目标」批量关闭全部 OPEN 举报，并联动资源状态：
//   RESOURCE + dismiss  → 若正因举报暂挂 PENDING 则复核通过恢复上架
//   RESOURCE + confirm  → 确认违规：下架（REMOVED）
//   COMMENT / USER      → 仅关闭举报（内容侧治理暂不做自动动作）
export async function handleReportBatchAction(input: {
  type: "RESOURCE" | "COMMENT" | "USER";
  resourceId?: string | null;
  commentId?: string | null;
  userId?: string | null;
  decision: "dismiss" | "confirm";
}): Promise<{ ok: boolean; error?: string }> {
  const admin = await staff();
  if (!admin) return { ok: false, error: "无权限" };

  // 目标 id 必须与 type 匹配且非空，否则 where 落到「该列为 null 的全部举报」误关别类举报
  const targetId = input.resourceId ?? input.commentId ?? input.userId ?? "";
  if (!targetId || targetId === "?") return { ok: false, error: "缺少举报目标" };

  const where: Prisma.ReportWhereInput = {
    type: input.type,
    status: "OPEN",
    ...(input.type === "RESOURCE"
      ? { targetResourceId: targetId }
      : input.type === "COMMENT"
        ? { targetCommentId: targetId }
        : { targetUserId: targetId }),
  };
  // 举报人必须在关闭之前取：关闭后这批记录就不再是 OPEN，查不到回执对象了
  const reportRows = await prisma.report.findMany({ where, select: { reporterId: true } });

  const closed = await prisma.report.updateMany({
    where,
    data: {
      status: input.decision === "confirm" ? "RESOLVED" : "DISMISSED",
      handledBy: admin.id,
      handledAt: new Date(),
    },
  });
  if (closed.count === 0) return { ok: false, error: "没有待处理举报" };
  await audit(
    admin.id,
    input.decision === "confirm" ? "REPORT_RESOLVE" : "REPORT_DISMISS",
    input.type,
    targetId,
  );

  // 处理回执：举报最怕石沉大海，无论成立与否都给举报人一个结论（操作者自己举报自己不算）
  const reporterIds = [
    ...new Set(
      reportRows.map((r) => r.reporterId).filter((x): x is string => !!x && x !== admin.id),
    ),
  ];
  const verdict =
    input.decision === "confirm" ? "经核查确认违规，已处理" : "经核查未发现违规，本次不予处理";
  await Promise.all(
    reporterIds.map((uid) =>
      notifyFeedback(uid, `你举报的内容${verdict}。感谢你帮助维护社区秩序。`),
    ),
  );

  if (input.type === "RESOURCE" && input.resourceId) {
    const res = await prisma.resource.findUnique({
      where: { id: input.resourceId },
      select: { id: true, slug: true, title: true, authorId: true, status: true },
    });
    // 已下架内容不重复动作，只关闭举报
    if (res && res.status !== "REMOVED") {
      if (input.decision === "confirm") {
        // 下架 + 通知同事务：状态与提醒不会出现一边成功一边失败
        await prisma.$transaction(async (tx) => {
          await tx.resource.update({ where: { id: res.id }, data: { status: "REMOVED" } });
          await createNotification(
            {
              userId: res.authorId,
              actorId: admin.id,
              type: "MODERATION",
              resourceId: res.id,
              message: `你的内容「${res.title}」因举报被确认违规，已下架。如有疑问请联系管理员`,
            },
            tx,
          );
        });
        await audit(admin.id, "REMOVE_RESOURCE", "RESOURCE", res.id, res.title);
        await notifyByEmail(
          res.authorId,
          "你的内容因举报被下架",
          `《${res.title}》：经核查确认违规，已下架。如有疑问请联系管理员`,
          `/resources/${res.slug}`,
          "moderation",
        ).catch(() => undefined);
        revalidatePath(`/resources/${res.slug}`);
      } else if (res.status === "PENDING") {
        await prisma.$transaction(async (tx) => {
          await tx.resource.update({
            where: { id: res.id },
            data: { status: "PUBLISHED", publishedAt: new Date(), rejectReason: null },
          });
          await createNotification(
            {
              userId: res.authorId,
              actorId: admin.id,
              type: "MODERATION",
              resourceId: res.id,
              message: `你的内容「${res.title}」经核查无违规，已恢复上架`,
            },
            tx,
          );
        });
        await audit(admin.id, "RESTORE", "RESOURCE", res.id);
        queueIndexNowForResource(res.id); // 举报复核通过恢复上架，同样推送一次
        revalidatePath(`/resources/${res.slug}`);
      }
    }
  }

  revalidatePath("/admin");
  revalidatePath("/admin/reports");
  revalidatePath("/admin/queue");
  revalidatePath("/", "layout");
  return { ok: true };
}

// ---------- 用户管理（仅 ADMIN） ----------

const ROLE_LABEL: Record<"USER" | "MODERATOR" | "ADMIN", string> = {
  USER: "普通用户",
  MODERATOR: "版主",
  ADMIN: "管理员",
};

export async function setUserTrusted(
  userId: string,
  trusted: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  // updateMany + count 预检：目标不存在时不抛 P2025 500，给友好错误
  const r = await prisma.user.updateMany({ where: { id: userId }, data: { trusted } });
  if (r.count === 0) return { ok: false, error: "用户不存在" };
  await audit(admin.id, trusted ? "TRUST" : "UNTRUST", "USER", userId);
  // 免审是直接影响投稿体验的权限，必须让本人知情（否则投稿「没进队列」会被当成 bug）
  await notifyAccountSecurity(
    userId,
    trusted ? "你已获得免审资格" : "你的免审资格已被取消",
    trusted
      ? "管理员已为你开通免审资格：之后发布的投稿会直接上架，不再经过审核队列。请继续遵守社区规范。"
      : "管理员已取消你的免审资格：之后发布的投稿会先进入审核队列，通过后才会公开。",
  );
  revalidatePath("/admin/users");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setUserRole(
  userId: string,
  role: "USER" | "MODERATOR" | "ADMIN",
): Promise<{ ok: boolean; error?: string }> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  if (userId === admin.id && role !== "ADMIN") return { ok: false, error: "不能修改自己的角色" };
  const r = await prisma.user.updateMany({ where: { id: userId }, data: { role } });
  if (r.count === 0) return { ok: false, error: "用户不存在" };
  await audit(admin.id, "SET_ROLE", "USER", userId, role);
  const label = ROLE_LABEL[role];
  // 提权/降权是最高危的账号变动：站内 + 邮件双通道告知本人
  await notifyAccountSecurity(
    userId,
    "你的账号权限有变更",
    `管理员已将你的账号角色变更为「${label}」。如非本人预期，请立即联系站点管理员。`,
  );
  revalidatePath("/admin/users");
  return { ok: true };
}

export async function setUserBanned(
  userId: string,
  banned: boolean,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  if (userId === admin.id) return { ok: false, error: "不能封禁自己" };
  const r = await prisma.user.updateMany({
    where: { id: userId },
    data: banned
      ? { bannedAt: new Date(), bannedReason: reason?.slice(0, 200) || null, trusted: false }
      : { bannedAt: null, bannedReason: null },
  });
  if (r.count === 0) return { ok: false, error: "用户不存在" };
  await audit(
    admin.id,
    banned ? "BAN" : "UNBAN",
    "USER",
    userId,
    banned ? reason || undefined : undefined,
  );
  // 封禁原因此前只落库、用户看不到：被封的人只会一脸茫然地反复尝试登录
  const why = banned ? (reason?.slice(0, 200) ?? "").trim() : "";
  await notifyAccountSecurity(
    userId,
    banned ? "你的账号已被封禁" : "你的账号封禁已解除",
    banned
      ? `你的账号已被管理员封禁${why ? `。原因：${why}` : ""}。如有疑问请联系站点管理员。`
      : "管理员已解除对你账号的封禁，现在可以正常登录与使用站内功能了。",
  );
  revalidatePath("/admin/users");
  return { ok: true };
}
