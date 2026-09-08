"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { makeKey, saveFile, delFile } from "@/lib/storage";
import { MIB } from "@/lib/upload-config";
import { getUploadLimits } from "@/lib/upload-limits";

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
    const key = makeKey("avatars", isGif ? ".gif" : ".webp");
    // GIF：保留动图原样落盘（不过 sharp，避免动图被压成静帧）；其余：方形居中裁切 256px webp
    const out = isGif
      ? buf
      : await sharp(buf, { failOn: "none" })
          .rotate()
          .resize(256, 256, { fit: "cover", position: "attention" })
          .webp({ quality: 85 })
          .toBuffer();
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
  if (!rateLimit(`pwchange:${user.id}`, 5, 10 * 60_000))
    return { error: "操作过于频繁，请稍后再试" };
  const passwordHash = await bcrypt.hash(parsed.data.next, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });
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
  revalidatePath("/settings");
  return { ok: true };
}
