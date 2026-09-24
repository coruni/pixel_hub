"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { makeKey, saveFile, delFile } from "@/lib/storage";
import { MIB, WATERMARK_TEXT_MAX, profileBgUnlocked } from "@/lib/upload-config";
import { getUploadLimits } from "@/lib/upload-limits";
import { getIncentive } from "@/lib/incentive";
import { getContributionSummary } from "@/lib/points";
import { compressWith, compressConfigOf, outputExt } from "@/lib/media/compress";
import { notifyAccountSecurity } from "@/lib/notify";

export type SettingsActionState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

const profileSchema = z.object({
  name: z.string().trim().min(0).max(30, "昵称最长 30 字"),
  bio: z.string().trim().max(200, "简介最长 200 字"),
});

export async function updateProfileAction(
  _prev: SettingsActionState,
  fd: FormData,
): Promise<SettingsActionState> {
  const user = (await auth())?.user;
  if (!user) return { error: "请先登录" };

  const parsed = profileSchema.safeParse({
    name: fd.get("name") ?? "",
    bio: fd.get("bio") ?? "",
  });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  const { name, bio } = parsed.data;

  await prisma.user.update({
    where: { id: user.id },
    data: { name: name || null, bio: bio || null },
  });
  revalidatePath(`/u/${user.username}`);
  revalidatePath("/settings");
  return { ok: true };
}

// ---- 主页隐私：收藏/粉丝/关注列表是否对外展示（本人始终可见） ----

export async function updatePrivacyAction(
  _prev: SettingsActionState,
  fd: FormData,
): Promise<SettingsActionState> {
  const user = (await auth())?.user;
  if (!user) return { error: "请先登录" };

  // checkbox 提交语义：勾选 = "on"，未勾选 = 缺失
  const showFavorites = fd.get("showFavorites") === "on";
  const showFollowers = fd.get("showFollowers") === "on";
  const showFollowing = fd.get("showFollowing") === "on";

  await prisma.user.update({
    where: { id: user.id },
    data: { showFavorites, showFollowers, showFollowing },
  });
  revalidatePath(`/u/${user.username}`);
  revalidatePath("/settings");
  return { ok: true };
}

// ---- 图片水印：开关 + 自定义文字（默认关闭） ----
// 水印是「上传时一次性烧进像素」的，改开关只影响之后的上传，存量图片不会重打 ——
// 这点写在设置页提示里，否则用户会以为改了设置旧图也会变。

const watermarkSchema = z.object({
  watermarkImages: z.boolean(),
  watermarkText: z.string().trim().max(WATERMARK_TEXT_MAX, `水印文字最长 ${WATERMARK_TEXT_MAX} 字`),
});

export async function updateWatermarkAction(
  _prev: SettingsActionState,
  fd: FormData,
): Promise<SettingsActionState> {
  const user = (await auth())?.user;
  if (!user) return { error: "请先登录" };

  const parsed = watermarkSchema.safeParse({
    // checkbox 提交语义：勾选 = "on"，未勾选 = 缺失
    watermarkImages: fd.get("watermarkImages") === "on",
    watermarkText: fd.get("watermarkText") ?? "",
  });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };

  await prisma.user.update({
    where: { id: user.id },
    data: {
      watermarkImages: parsed.data.watermarkImages,
      // 空串落 null：水印文字留空 = 用默认「@用户名」，不要在库里存一个空串表示「无文字」
      watermarkText: parsed.data.watermarkText || null,
    },
  });
  revalidatePath("/settings");
  return { ok: true };
}

// ---- 通知开关：邮件（评论回复 / 审核结果）+ 站内（点赞 / 评论 / 关注 / 审核与系统） ----
// 账号安全提醒（SECURITY）刻意不在开关列表里：改密、换邮箱、封禁等必须送达，用户关不掉。

export async function updateEmailNotifyAction(
  _prev: SettingsActionState,
  fd: FormData,
): Promise<SettingsActionState> {
  const user = (await auth())?.user;
  if (!user) return { error: "请先登录" };

  const emailNotifyComment = fd.get("emailNotifyComment") === "on";
  const emailNotifyModeration = fd.get("emailNotifyModeration") === "on";
  const inAppNotifyLike = fd.get("inAppNotifyLike") === "on";
  const inAppNotifyComment = fd.get("inAppNotifyComment") === "on";
  const inAppNotifyFollow = fd.get("inAppNotifyFollow") === "on";
  const inAppNotifySystem = fd.get("inAppNotifySystem") === "on";
  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailNotifyComment,
      emailNotifyModeration,
      inAppNotifyLike,
      inAppNotifyComment,
      inAppNotifyFollow,
      inAppNotifySystem,
    },
  });
  revalidatePath("/settings");
  return { ok: true };
}

// ---- 头像上传：方形居中裁切 256px webp，走统一存储层（上限跟随后台 /admin/uploads 头像档） ----

function sniffImage(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return true;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  const s = (str: string, off: number) =>
    buf.subarray(off, off + str.length).toString("latin1") === str;
  if (s("RIFF", 0) && s("WEBP", 8)) return true;
  if (s("GIF8", 0)) return true;
  return false;
}

export async function uploadAvatarAction(
  _prev: SettingsActionState,
  fd: FormData,
): Promise<SettingsActionState> {
  const user = (await auth())?.user;
  if (!user) return { error: "请先登录" };

  const L = await getUploadLimits();
  const avatarMaxBytes = L.avatarMaxMb * MIB;

  const file = fd.get("avatar");
  if (!(file instanceof File) || file.size === 0) return { error: "请选择图片文件" };
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.byteLength > avatarMaxBytes) return { error: `头像不能超过 ${L.avatarMaxMb}MB` };
  if (!sniffImage(buf)) return { error: "不支持的图片格式（仅 png/jpg/webp/gif）" };

  const isGif = buf.length >= 6 && buf.subarray(0, 6).toString("latin1").startsWith("GIF8");
  const canGif = user.trusted || user.role === "ADMIN" || user.role === "MODERATOR";
  if (isGif && !canGif) return { error: "GIF 头像仅对受信用户开放" };

  try {
    const key = makeKey("avatars", isGif ? ".gif" : `.${outputExt(L.imageFormat)}`);
    // GIF：保留动图原样落盘（不过 sharp，避免动图被压成静帧）；其余：方形居中裁切 256px 后按配置压缩
    const out = isGif
      ? buf
      : await compressWith(
          sharp(buf, { failOn: "none" })
            .rotate()
            .resize(256, 256, { fit: "cover", position: "attention" }),
          compressConfigOf(L),
        ).toBuffer();
    const url = await saveFile(key, out);

    // 换头像后清理旧文件（本站存储的 key；chevereto 远端 URL 也尽力删）
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { avatarKey: true },
    });
    const old = row?.avatarKey;
    await prisma.user.update({ where: { id: user.id }, data: { avatarKey: url } });
    if (old && old !== url) await delFile(old).catch(() => {});

    revalidatePath(`/u/${user.username}`);
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    console.error("[avatar]", e);
    return { error: "头像处理失败，请重试或更换图片" };
  }
}

// 表单 formAction 调用，签名必须收 FormData
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function removeAvatarAction(_fd?: FormData): Promise<void> {
  const user = (await auth())?.user;
  if (!user) return;
  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { avatarKey: true } });
  if (row?.avatarKey) {
    await prisma.user.update({ where: { id: user.id }, data: { avatarKey: null } });
    await delFile(row.avatarKey).catch(() => {});
  }
  revalidatePath(`/u/${user.username}`);
  revalidatePath("/settings");
}

// ---- 主页 hero 横幅：客户端裁剪为 1600×500，服务端只过 sniff + 按后台配置重压 + 落库 ----

export async function uploadHeroAction(
  _prev: SettingsActionState,
  fd: FormData,
): Promise<SettingsActionState> {
  const user = (await auth())?.user;
  if (!user) return { error: "请先登录" };

  const L = await getUploadLimits();
  // 横幅独立档位（后台「上传限制 · 主页横幅单张」）。原先借用 avatarMaxMb × 4 放大，
  // 两处配置会漂移（改头像上限会连带改横幅上限），现已拆成独立字段。
  const maxBytes = L.heroImageMaxMb * MIB;
  const file = fd.get("hero");
  if (!(file instanceof File) || file.size === 0) return { error: "请选择图片文件" };
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.byteLength > maxBytes) return { error: `横幅图不能超过 ${L.heroImageMaxMb}MB` };
  if (!sniffImage(buf)) return { error: "不支持的图片格式（仅 png/jpg/webp/gif）" };

  const isGif = buf.length >= 6 && buf.subarray(0, 6).toString("latin1").startsWith("GIF8");
  if (isGif) return { error: "横幅图不支持 GIF，请使用静态图" };

  try {
    const out = await compressWith(
      sharp(buf, { failOn: "none" })
        .rotate()
        .resize(1600, 500, { fit: "cover", position: "attention" }),
      compressConfigOf(L),
    ).toBuffer();
    const key = makeKey("heroes", `.${outputExt(L.imageFormat)}`);
    const url = await saveFile(key, out);

    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { heroImageKey: true },
    });
    const old = row?.heroImageKey;
    await prisma.user.update({ where: { id: user.id }, data: { heroImageKey: url } });
    if (old && old !== url) await delFile(old).catch(() => {});

    revalidatePath(`/u/${user.username}`);
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    console.error("[hero]", e);
    return { error: "横幅图处理失败，请重试或更换图片" };
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function removeHeroAction(_fd?: FormData): Promise<void> {
  const user = (await auth())?.user;
  if (!user) return;
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { heroImageKey: true },
  });
  if (row?.heroImageKey) {
    await prisma.user.update({ where: { id: user.id }, data: { heroImageKey: null } });
    await delFile(row.heroImageKey).catch(() => {});
  }
  revalidatePath(`/u/${user.username}`);
  revalidatePath("/settings");
}

// ---- 个人主页背景：铺满视口的**最底层**底图（不覆盖 hero，仅桌面端渲染）----
//
// 三处与头像/横幅不同，都是刻意的：
//   ① **不做裁剪**。底图是 cover 铺满，被裁掉的恰好是遮罩留白的中间区，裁剪器只会让用户困惑；
//      改成把遮罩直接套在设置页预览上，所见即所得（遮罩类见 globals.css 的 .profile-bg-pc）。
//   ② **不放大小图**。cover 在 CSS 层完成，服务端只按后台格式重压，避免无谓的重采样损失。
//   ③ **门槛在服务端重算**。客户端只是不渲染入口，绕过前端也必须传不上来 —— 与前台渲染
//      共用 profileBgUnlocked()，口径只有一份。

/** 服务端权威判定：等级不够直接拒绝，并把「还差哪一档」写进错误文案 */
async function profileBgGate(userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const [incentive, summary] = await Promise.all([getIncentive(), getContributionSummary(userId)]);
  if (profileBgUnlocked(summary.level, incentive.profile.bgMinLevel, incentive.enabled)) {
    return { ok: true };
  }
  // 门槛可能指向一个不存在的档位（管理员裁掉了等级）—— 那时只能说「尚未开放」，不能编一个名字
  const need = [...incentive.levels].sort((a, b) => a.min - b.min)[incentive.profile.bgMinLevel]?.name;
  return {
    ok: false,
    error: need ? `主页背景需达到「${need}」等级后开放` : "主页背景目前未对你开放",
  };
}

export async function uploadProfileBgAction(
  _prev: SettingsActionState,
  fd: FormData,
): Promise<SettingsActionState> {
  const user = (await auth())?.user;
  if (!user) return { error: "请先登录" };

  const gate = await profileBgGate(user.id);
  if (!gate.ok) return { error: gate.error };

  const L = await getUploadLimits();
  const maxBytes = L.profileBgMaxMb * MIB;

  const file = fd.get("bg");
  if (!(file instanceof File) || file.size === 0) return { error: "请选择图片文件" };
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.byteLength > maxBytes) return { error: `主页背景不能超过 ${L.profileBgMaxMb}MB` };
  if (!sniffImage(buf)) return { error: "不支持的图片格式（仅 png/jpg/webp/gif）" };

  const isGif = buf.length >= 6 && buf.subarray(0, 6).toString("latin1").startsWith("GIF8");
  if (isGif) return { error: "主页背景不支持 GIF，请使用静态图" };

  try {
    const out = await compressWith(
      sharp(buf, { failOn: "none" }).rotate(),
      compressConfigOf(L),
    ).toBuffer();
    const key = makeKey("backgrounds", `.${outputExt(L.imageFormat)}`);
    const url = await saveFile(key, out);

    // 换图后清理旧文件（本地 key 或 chevereto 远端 URL 都尽力删）
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { profileBgPcKey: true },
    });
    const old = row?.profileBgPcKey;
    await prisma.user.update({
      where: { id: user.id },
      data: { profileBgPcKey: url },
    });
    if (old && old !== url) await delFile(old).catch(() => {});

    revalidatePath(`/u/${user.username}`);
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    console.error("[profile-bg]", e);
    return { error: "背景图处理失败，请重试或更换图片" };
  }
}

export async function removeProfileBgAction(): Promise<void> {
  const user = (await auth())?.user;
  if (!user) return;

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { profileBgPcKey: true },
  });
  const old = row?.profileBgPcKey;
  if (!old) return;

  await prisma.user.update({
    where: { id: user.id },
    data: { profileBgPcKey: null },
  });
  await delFile(old).catch(() => {});
  revalidatePath(`/u/${user.username}`);
  revalidatePath("/settings");
}

// ---- 资源详情页是否展示同款背景 ----
//
// **独立于上传动作**：改开关不该强迫用户重新选一遍图，所以它自带一个不含 file 的表单
// （HTML 表单不能嵌套，它挂在上传 form 之外）。只写这一个布尔，绝不触碰 profileBgPcKey
// —— 关掉开关不会把图删掉，重新打开就还在。
export async function updateProfileBgOnResourceAction(
  _prev: SettingsActionState,
  fd: FormData,
): Promise<SettingsActionState> {
  const user = (await auth())?.user;
  if (!user) return { error: "请先登录" };

  const onResource = String(fd.get("onResource") ?? "") === "on";
  try {
    await prisma.user.update({
      where: { id: user.id },
      data: { profileBgOnResource: onResource },
    });
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    console.error("[profile-bg-placement]", e);
    return { error: "保存失败，请重试" };
  }
}

// ---- 账号安全：改密码 / 换邮箱 ----

const passwordSchema = z
  .object({
    current: z.string().min(1, "请输入当前密码"),
    next: z.string().min(8, "新密码至少 8 位").max(72, "密码过长"),
    confirm: z.string().min(1, "请再次输入新密码"),
  })
  .refine((d) => d.next === d.confirm, { path: ["confirm"], message: "两次输入的新密码不一致" });

export async function changePasswordAction(
  _prev: SettingsActionState,
  fd: FormData,
): Promise<SettingsActionState> {
  const user = (await auth())?.user;
  if (!user) return { error: "请先登录" };

  const parsed = passwordSchema.safeParse({
    current: String(fd.get("current") ?? ""),
    next: String(fd.get("next") ?? ""),
    confirm: String(fd.get("confirm") ?? ""),
  });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  });
  if (row?.passwordHash) {
    const ok = await bcrypt.compare(parsed.data.current, row.passwordHash);
    if (!ok) return { fieldErrors: { current: ["当前密码不正确"] } };
  }
  // OAuth 账号（未设密码）跳过当前密码校验即可设首个密码，因此加限流防会话被盗后恶意改密
  if (!(await rateLimit(`pwchange:${user.id}`, 5, 10 * 60_000)))
    return { error: "操作过于频繁，请稍后再试" };
  const passwordHash = await bcrypt.hash(parsed.data.next, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });
  // 改密是「账号被盗」最典型的第一步：站内 + 邮件双通道提醒，用户关不掉
  await notifyAccountSecurity(
    user.id,
    "你的登录密码已被修改",
    "你的账号登录密码刚刚被修改。如果这不是你本人的操作，请立即联系站点管理员。",
  );
  return { ok: true };
}

const emailSchema = z.object({
  email: z.string().trim().toLowerCase().email("邮箱格式不正确"),
  password: z.string().min(1, "请输入当前密码"),
});

export async function changeEmailAction(
  _prev: SettingsActionState,
  fd: FormData,
): Promise<SettingsActionState> {
  const user = (await auth())?.user;
  if (!user) return { error: "请先登录" };

  const parsed = emailSchema.safeParse({
    email: String(fd.get("email") ?? ""),
    password: String(fd.get("password") ?? ""),
  });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { email: true, passwordHash: true },
  });
  if (!row) return { error: "账号不存在" };
  if (parsed.data.email === row.email) return { fieldErrors: { email: ["新邮箱与当前邮箱相同"] } };

  if (row.passwordHash) {
    const ok = await bcrypt.compare(parsed.data.password, row.passwordHash);
    if (!ok) return { fieldErrors: { password: ["密码不正确"] } };
  }

  const taken = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (taken) return { fieldErrors: { email: ["该邮箱已被其他账号使用"] } };

  await prisma.user.update({ where: { id: user.id }, data: { email: parsed.data.email } });
  // 安全提醒发往「旧邮箱」：新邮箱已经生效，旧邮箱是本人还能看到的最后通道
  await notifyAccountSecurity(
    user.id,
    "你的登录邮箱已被修改",
    `你的账号登录邮箱已从 ${row.email} 变更为 ${parsed.data.email}。如果这不是你本人的操作，请立即联系站点管理员。`,
    row.email,
  );
  revalidatePath("/settings");
  return { ok: true };
}
