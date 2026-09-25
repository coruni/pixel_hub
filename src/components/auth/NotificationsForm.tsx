"use client";

// 通知设置：站内（点赞/评论/关注/审核与系统）与邮件（评论回复/审核结果）分开控制，均默认开启。
// 结构沿用隐私设置：SquareCheckbox 非受控（name + defaultChecked），随 FormData 提交。
// 账号安全提醒（改密、换邮箱、封禁解封、角色变更）不在此列：这类通知必须送达，用户关不掉。
import { useActionState } from "react";
import { updateEmailNotifyAction, type SettingsActionState } from "@/lib/actions/settings";
import { SquareCheckbox } from "@/components/admin/SquareCheckbox";
import { Button } from "@/components/ui/Button";

const IN_APP_ITEMS = [
  {
    name: "inAppNotifyComment",
    label: "评论与回复",
    hint: "有人评论你的内容，或回复你的评论时，在站内通知你（附评论摘要）。",
  },
  {
    name: "inAppNotifyLike",
    label: "点赞",
    hint: "有人赞了你的内容；同一批未读的多个赞会合并成「XX 等 N 人赞了你」。",
  },
  {
    name: "inAppNotifyFollow",
    label: "关注",
    hint: "有新用户关注你。",
  },
  {
    name: "inAppNotifySystem",
    label: "审核与系统",
    hint: "投稿审核结果、举报处理回执与系统公告。",
  },
] as const;

const EMAIL_ITEMS = [
  {
    name: "emailNotifyComment",
    label: "评论与回复",
    hint: "有人评论你的内容或回复你的评论时，通过邮件提醒你。",
  },
  {
    name: "emailNotifyModeration",
    label: "审核结果",
    hint: "投稿通过、驳回或下架等审核结果通过邮件告知你。",
  },
] as const;

const groupTitle = "text-xs font-semibold tracking-wide text-neutral-500";

export default function NotificationsForm({
  emailNotifyComment,
  emailNotifyModeration,
  inAppNotifyLike,
  inAppNotifyComment,
  inAppNotifyFollow,
  inAppNotifySystem,
}: {
  emailNotifyComment: boolean;
  emailNotifyModeration: boolean;
  inAppNotifyLike: boolean;
  inAppNotifyComment: boolean;
  inAppNotifyFollow: boolean;
  inAppNotifySystem: boolean;
}) {
  const [state, formAction, pending] = useActionState<SettingsActionState, FormData>(
    updateEmailNotifyAction,
    {},
  );
  const current: Record<string, boolean> = {
    emailNotifyComment,
    emailNotifyModeration,
    inAppNotifyLike,
    inAppNotifyComment,
    inAppNotifyFollow,
    inAppNotifySystem,
  };

  const renderItems = (items: readonly { name: string; label: string; hint: string }[]) => (
    <ul className="space-y-3.5">
      {items.map((it) => (
        <li key={it.name} className="flex items-start gap-3">
          <SquareCheckbox
            name={it.name}
            defaultChecked={current[it.name]}
            ariaLabel={it.label}
            className="mt-0.5"
          />
          <div className="min-w-0">
            <p className="text-sm text-neutral-800">{it.label}</p>
            <p className="mt-0.5 text-xs leading-5 text-neutral-400">{it.hint}</p>
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <form action={formAction} className="space-y-6">
      <div className="space-y-3">
        <p className={groupTitle}>站内通知</p>
        {renderItems(IN_APP_ITEMS)}
      </div>

      <div className="space-y-3 border-t border-brand-100 pt-5">
        <p className={groupTitle}>邮件提醒</p>
        <p className="text-xs leading-5 text-neutral-400">
          邮件依赖站点的 SMTP 配置；未配置时仅站内通知生效。
        </p>
        {renderItems(EMAIL_ITEMS)}
      </div>

      <p className="border-t border-brand-100 pt-4 text-xs leading-5 text-neutral-400">
        账号安全提醒（修改密码、换绑邮箱、封禁与权限变更）始终发送，无法关闭。
      </p>

      {state.ok && <p className="text-sm text-emerald-600">✓ 已保存</p>}
      {state.error && <p className="text-sm text-red-500">{state.error}</p>}

      <Button
        type="submit"
        disabled={pending}
        variant="primary" size="md"
      >
        {pending ? "保存中…" : "保存"}
      </Button>
    </form>
  );
}
