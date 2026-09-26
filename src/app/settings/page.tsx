import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowUpRight } from "lucide-react";
import { auth } from "@/lib/auth";
import { fromDbColorMode } from "@/lib/color-mode";
import { prisma } from "@/lib/db/prisma";
import { getProfile } from "@/lib/queries";
import { getUploadLimits } from "@/lib/upload-limits";
import SettingsForm from "@/components/auth/settings-form";
import PrivacyForm from "@/components/auth/privacy-form";
import AvatarForm from "@/components/auth/avatar-form";
import HeroForm from "@/components/auth/HeroForm";
import ProfileBgForm from "@/components/auth/ProfileBgForm";
import BgPresetPicker from "@/components/auth/BgPresetPicker";
import NameColorForm from "@/components/auth/NameColorForm";
import NotificationsForm from "@/components/auth/NotificationsForm";
import PublishForm from "@/components/auth/PublishForm";
import WatermarkForm from "@/components/auth/WatermarkForm";
import ColorModeForm from "@/components/auth/ColorModeForm";
import DraftsPanel from "@/components/auth/DraftsPanel";
import { EmailForm, PasswordForm } from "@/components/auth/security-forms";
import SettingsTabs from "@/components/auth/SettingsTabs";
import { startGitHubBindAction, unbindGitHubAction } from "@/lib/actions/connections";
import { countDrafts } from "@/lib/draft-store";
import { getRuntimeConfig, githubClientId, githubClientSecret } from "@/lib/runtime-config";
import { getIncentive } from "@/lib/incentive";
import { getContributionSummary } from "@/lib/points";
import { profileBgUnlocked } from "@/lib/upload-config";
import { NAME_COLORS, PROFILE_BG_PRESETS, decorationUnlocked } from "@/lib/decorations";
import { Button } from "@/components/ui/Button";

export const metadata: Metadata = { title: "账户设置", robots: { index: false } };

const BIND_MESSAGES: Record<string, string> = {
  ok: "GitHub 账号绑定成功",
  taken: "该 GitHub 账号已绑定其他用户",
  state: "绑定请求已过期，请重试",
  token: "GitHub 授权失败，请重试",
  github: "获取 GitHub 用户信息失败",
  "no-session": "登录状态失效，请重新登录",
  "no-password": "该账号未设置密码，无法解绑最后一个登录方式",
  err: "绑定失败，请稍后再试",
};

const roleLabel: Record<string, string> = {
  ADMIN: "管理员",
  MODERATOR: "版主",
  USER: "普通用户",
};

const sectionCls = "rounded-none border border-brand-200 bg-surface p-6";
const sectionTitle = "text-sm font-semibold text-neutral-800";
const sectionHint = "mb-4 mt-1 text-xs text-neutral-400";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ bind?: string; tab?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/settings");

  const [bind, tabRaw, limits, runtimeCfg] = await Promise.all([
    searchParams.then((s) => s.bind),
    searchParams.then((s) => s.tab),
    getUploadLimits(),
    getRuntimeConfig(),
  ]);
  const bindMsg = bind ? (BIND_MESSAGES[bind] ?? null) : null;

  const me = session.user;
  const profile = await getProfile(me.username, me.id);
  const [githubAccount, prefs, draftCount, summary, incentive] = await Promise.all([
    prisma.account.findFirst({
      where: { userId: me.id, provider: "github" },
      select: { providerAccountId: true },
    }),
    prisma.user.findUnique({
      where: { id: me.id },
      select: {
        autoSaveDraft: true,
        watermarkImages: true,
        watermarkText: true,
        watermarkPosition: true,
        colorMode: true,
        profileBgPcKey: true,
        profileBgOnResource: true,
        profileBgPreset: true,
        nameColor: true,
      },
    }),
    countDrafts(me.id),
    getContributionSummary(me.id),
    getIncentive(),
  ]);

  // 主页背景解锁判定：与前台渲染共用 profileBgUnlocked()，门槛值来自激励配置的 profile.bgMinLevel。
  // 门槛可能指向一个被裁掉的档位 —— 那时只显示「达到更高等级」，不去编一个等级名。
  const bgGateLevels = [...incentive.levels].sort((a, b) => a.min - b.min);
  const bgUnlocked = profileBgUnlocked(summary.level, incentive.profile.bgMinLevel, incentive.enabled);

  // 装饰解锁：门槛写在 decorations.ts 每一项旁边，判定与前台渲染共用 decorationUnlocked()。
  // 这里把「等级名」一并算好传给客户端 —— 客户端不碰 levels 配置，只负责显示。
  const levelNameAt = (lv: number) => bgGateLevels[lv]?.name ?? null;
  const nameColorOptions = NAME_COLORS.map((c) => ({
    key: c.key,
    name: c.name,
    className: c.className,
    swatchClass: c.swatchClass,
    unlocked: decorationUnlocked(summary.level, c.minLevel, incentive.enabled),
    needName: levelNameAt(c.minLevel),
  }));
  const bgPresetOptions = PROFILE_BG_PRESETS.map((p) => ({
    id: p.id,
    name: p.name,
    url: p.url,
    unlocked: decorationUnlocked(summary.level, p.minLevel, incentive.enabled),
    needName: levelNameAt(p.minLevel),
  }));
  const githubEnabled = Boolean(githubClientId(runtimeCfg) && githubClientSecret(runtimeCfg));
  const joined = profile
    ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(
      profile.createdAt,
    )
    : null;

  const info: { k: string; v: string }[] = [
    { k: "用户名", v: `@${me.username}` },
    { k: "邮箱", v: me.email ?? "未绑定" },
    { k: "角色", v: roleLabel[me.role] ?? me.role },
    ...(joined ? [{ k: "加入时间", v: joined }] : []),
  ];

  // 8 个 panel：资料 / 装饰 / 通知 / 发布 / 安全 / 第三方 / 外观 / 账号（头像独立在 tab 外常驻）
  const tabs = [
    {
      key: "profile",
      label: "资料",
      panel: (
        <>
          <section className={sectionCls}>
            <h2 className={sectionTitle}>个人资料</h2>
            <div className="mt-4">
              <SettingsForm name={profile?.name ?? null} bio={profile?.bio ?? null} />
            </div>
          </section>

          {profile && (
            <section className={sectionCls}>
              <h2 className={sectionTitle}>隐私设置</h2>
              <p className={sectionHint}>
                控制个人主页上收藏、粉丝、关注列表的可见范围（你自己始终可见全部）
              </p>
              <PrivacyForm
                showFavorites={profile.showFavorites}
                showFollowers={profile.showFollowers}
                showFollowing={profile.showFollowing}
              />
            </section>
          )}
        </>
      ),
    },
    {
      key: "decoration",
      label: "装饰",
      panel: (
        <>
          <section className={sectionCls}>
            <h2 className={sectionTitle}>主页横幅</h2>
            <p className={sectionHint}>主页横幅不建议和主页背景一起使用</p>
            <HeroForm
              heroImageKey={profile?.heroImageKey ?? null}
              heroMaxMb={limits.heroImageMaxMb}
            />
          </section>

          <section className={sectionCls}>
            <h2 className={sectionTitle}>主页背景</h2>
            <p className={sectionHint}>铺满整个屏幕的最底层底图，不会盖住主页横幅。仅桌面端展示</p>

            {incentive.decoration.bgPresetEnabled && (
              <div className="mb-5 border-b border-brand-200 pb-5">
                <h3 className="text-xs font-medium text-neutral-700">官方背景库</h3>
                <div className="mt-2">
                  <BgPresetPicker
                    options={bgPresetOptions}
                    current={prefs?.profileBgPreset ?? null}
                    hasUploaded={Boolean(prefs?.profileBgPcKey)}
                  />
                </div>
              </div>
            )}

            <h3 className="text-xs font-medium text-neutral-700">自定义上传</h3>
            <div className="mt-2">
              <ProfileBgForm
                unlocked={bgUnlocked}
                gateName={bgGateLevels[incentive.profile.bgMinLevel]?.name ?? null}
                points={summary.points}
                nextName={summary.next?.name ?? null}
                toNext={summary.toNext}
                pcKey={prefs?.profileBgPcKey ?? null}
                onResource={prefs?.profileBgOnResource ?? true}
                maxMb={limits.profileBgMaxMb}
              />
            </div>
          </section>

          {incentive.decoration.nicknameEnabled && (
            <section className={sectionCls}>
              <h2 className={sectionTitle}>昵称特效色</h2>
              <p className={sectionHint}>
                昵称在评论、资源卡、个人主页等处显示的颜色。按贡献分等级逐款开放，不消耗贡献分
              </p>
              <NameColorForm
                options={nameColorOptions}
                current={prefs?.nameColor ?? null}
                sample={profile?.name ?? me.username}
                points={summary.points}
              />
            </section>
          )}
        </>
      ),
    },
    {
      key: "notifications",
      label: "通知",
      panel: (
        <section className={sectionCls}>
          <h2 className={sectionTitle}>通知设置</h2>
          <div className="mt-4">
            <NotificationsForm
              emailNotifyComment={profile?.emailNotifyComment ?? true}
              emailNotifyModeration={profile?.emailNotifyModeration ?? true}
              inAppNotifyLike={profile?.inAppNotifyLike ?? true}
              inAppNotifyComment={profile?.inAppNotifyComment ?? true}
              inAppNotifyFollow={profile?.inAppNotifyFollow ?? true}
              inAppNotifySystem={profile?.inAppNotifySystem ?? true}
            />
          </div>
        </section>
      ),
    },
    {
      key: "publish",
      label: "发布",
      panel: (
        <>
          <section className={sectionCls}>
            <h2 className={sectionTitle}>发布偏好</h2>
            <div className="mt-4">
              <PublishForm autoSaveDraft={prefs?.autoSaveDraft ?? true} draftCount={draftCount} />
            </div>
          </section>

          <section className={sectionCls}>
            <h2 className={sectionTitle}>图片水印</h2>
            <div className="mt-4">
              <WatermarkForm
                enabled={prefs?.watermarkImages ?? false}
                text={prefs?.watermarkText ?? null}
                position={prefs?.watermarkPosition ?? "BOTTOM_RIGHT"}
                username={me.username}
              />
            </div>
          </section>

          {/* 草稿箱：与开关同屏，省掉独立页面与菜单里的第二个入口 */}
          <section id="drafts" className={sectionCls}>
            <h2 className={sectionTitle}>草稿箱</h2>
            <div className="mt-4">
              <DraftsPanel userId={me.id} />
            </div>
          </section>
        </>
      ),
    },
    {
      key: "security",
      label: "安全",
      panel: (
        <>
          <section className={sectionCls}>
            <h2 className={sectionTitle}>修改密码</h2>
            <p className={sectionHint}>修改后其他设备需用新密码重新登录</p>
            <PasswordForm />
          </section>

          <section className={sectionCls}>
            <h2 className={sectionTitle}>登录邮箱</h2>
            <p className={sectionHint}>修改需验证当前密码</p>
            <EmailForm currentEmail={me.email ?? null} />
          </section>
        </>
      ),
    },
    {
      key: "third",
      label: "第三方",
      panel: (
        <section className={sectionCls}>
          <h2 className={sectionTitle}>第三方账号</h2>
          <div className="mt-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-neutral-800">GitHub</p>
              <p className="mt-0.5 text-xs text-neutral-400">
                {githubAccount
                  ? "已绑定，可直接使用 GitHub 登录本账号"
                  : githubEnabled
                    ? "未绑定"
                    : "站点未开启 GitHub 登录"}
              </p>
            </div>
            {githubEnabled &&
              (githubAccount ? (
                <form action={unbindGitHubAction}>
                  <Button
                    type="submit"
                    className="rounded-none border border-red-200 px-3 py-1.5 text-xs text-red-500 hover:border-red-400 hover:bg-red-50"
                  >
                    解绑
                  </Button>
                </form>
              ) : (
                <form action={startGitHubBindAction}>
                  <Button
                    type="submit"
                    className="rounded-none border border-brand-200 px-3 py-1.5 text-xs text-neutral-600 hover:border-brand-500 hover:text-neutral-900"
                  >
                    绑定 GitHub
                  </Button>
                </form>
              ))}
          </div>
        </section>
      ),
    },
    {
      key: "appearance",
      label: "外观",
      panel: (
        <section className={sectionCls}>
          <h2 className={sectionTitle}>配色模式</h2>
          <p className={sectionHint}>
            选择站点的明暗配色；换设备登录同样生效。未登录的访客一律跟随浏览器的配色设置
          </p>
          <ColorModeForm mode={fromDbColorMode(prefs?.colorMode)} />
        </section>
      ),
    },
    {
      key: "account",
      label: "账号",
      panel: (
        <section className={sectionCls}>
          <h2 className={sectionTitle}>账号信息</h2>
          <dl className="mt-4 space-y-2.5">
            {info.map((row) => (
              <div key={row.k} className="flex items-baseline justify-between gap-4 text-sm">
                <dt className="shrink-0 text-xs text-neutral-400">{row.k}</dt>
                <dd className="min-w-0 truncate text-neutral-800">{row.v}</dd>
              </div>
            ))}
          </dl>
        </section>
      ),
    },
  ];

  const allowedKeys = tabs.map((t) => t.key);
  const initialTab = allowedKeys.includes(tabRaw ?? "") ? (tabRaw as string) : "profile";

  return (
    <div className="mx-auto max-w-xl px-4 py-10 sm:px-6">
      {bindMsg && (
        <p
          className={`mb-4 rounded-none border px-3 py-2 text-xs ${bind === "ok"
              ? "border-brand-600 bg-brand-50 text-neutral-800"
              : "border-red-300 bg-red-50 text-red-600"
            }`}
        >
          {bindMsg}
        </p>
      )}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">账户设置</h1>
          <p className="mt-1 text-sm text-neutral-500">@{me.username}</p>
        </div>
        <Link
          href={`/u/${me.username}`}
          className="inline-flex items-center gap-1 rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs text-neutral-600 hover:border-brand-500 hover:text-neutral-900"
        >
          查看公开主页 <ArrowUpRight size={12} aria-hidden />
        </Link>
      </div>

      {/* 头像：独立在 tab 之外常驻，tab 只切换资料/通知/安全等板块 */}
      <section className={`${sectionCls} mt-6`}>
        <h2 className={sectionTitle}>头像</h2>
        <AvatarForm
          name={profile?.name ?? null}
          username={me.username}
          avatarKey={profile?.avatarKey ?? null}
          trusted={!!me.trusted}
          avatarMaxMb={limits.avatarMaxMb}
        />
      </section>

      <SettingsTabs tabs={tabs} initial={initialTab} />
    </div>
  );
}