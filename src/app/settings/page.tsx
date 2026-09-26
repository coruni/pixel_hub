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

  // 7 个 panel：资料 / 通知 / 发布 / 安全 / 第三方 / 外观 / 账号（头像独立在 tab 外常驻）
  const tabs = [
    {
      key: "profile",
      label: "资料",
      panel: (
        <>
          <section className={sectionCls}>
            <h2 className={sectionTitle}>主页横幅</h2>
            <p className={sectionHint}>展示在公开主页头部，未设置则按原版头部显示</p>
            <HeroForm
              heroImageKey={profile?.heroImageKey ?? null}
              heroMaxMb={limits.heroImageMaxMb}
            />
          </section>

          <section className={sectionCls}>
            <h2 className={sectionTitle}>主页背景</h2>
            <p className={sectionHint}>铺满整个屏幕的最底层底图，不会盖住主页横幅。仅桌面端展示</p>
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
          </section>

          <section className={sectionCls}>
            <h2 className={sectionTitle}>个人资料</h2>
            <p className={sectionHint}>昵称与简介会展示在你的公开主页</p>
            <SettingsForm name={profile?.name ?? null} bio={profile?.bio ?? null} />
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
      key: "notifications",
      label: "通知",
      panel: (
        <section className={sectionCls}>
          <h2 className={sectionTitle}>通知设置</h2>
          <p className={sectionHint}>选择要接收的动态与提醒方式（审核结果、评论回复、点赞关注等）</p>
          <NotificationsForm
            emailNotifyComment={profile?.emailNotifyComment ?? true}
            emailNotifyModeration={profile?.emailNotifyModeration ?? true}
            inAppNotifyLike={profile?.inAppNotifyLike ?? true}
            inAppNotifyComment={profile?.inAppNotifyComment ?? true}
            inAppNotifyFollow={profile?.inAppNotifyFollow ?? true}
            inAppNotifySystem={profile?.inAppNotifySystem ?? true}
          />
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
            <p className={sectionHint}>控制发布内容时草稿的留存方式</p>
            <PublishForm autoSaveDraft={prefs?.autoSaveDraft ?? true} draftCount={draftCount} />
          </section>

          <section className={sectionCls}>
            <h2 className={sectionTitle}>图片水印</h2>
            <p className={sectionHint}>给上传的图片押上署名，防止被搬运时丢掉出处</p>
            <WatermarkForm
              enabled={prefs?.watermarkImages ?? false}
              text={prefs?.watermarkText ?? null}
              position={prefs?.watermarkPosition ?? "BOTTOM_RIGHT"}
              username={me.username}
            />
          </section>

          {/* 草稿箱：与开关同屏，省掉独立页面与菜单里的第二个入口 */}
          <section id="drafts" className={sectionCls}>
            <h2 className={sectionTitle}>草稿箱</h2>
            <DraftsPanel userId={me.id} />
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
          <p className={sectionHint}>通过外部服务登录或绑定到本站账号</p>
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
          <p className={sectionHint}>只读展示，无法直接修改；如需变更请联系管理员</p>
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
          className={`mb-4 rounded-none border px-3 py-2 text-xs ${
            bind === "ok"
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
        <p className={sectionHint}>展示在个人主页、评论区与作者信息</p>
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