"use client";

// 通知设置：邮件提醒按事件类型拆分（评论回复 / 审核结果），均默认开启；
// 结构沿用隐私设置：SquareCheckbox 非受控（name + defaultChecked），随 FormData 提交。
import { useActionState } from "react";
import { updateEmailNotifyAction, type SettingsActionState } from "@/lib/actions/settings";
import { SquareCheckbox } from "@/components/admin/SquareCheckbox";
import { Button } from "@/components/ui/Button";

const ITEMS = [
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

export default function NotificationsForm({
  emailNotifyComment,
  emailNotifyModeration,
}: {
  emailNotifyComment: boolean;
  emailNotifyModeration: boolean;
}) {
  const [state, formAction, pending] = useActionState<SettingsActionState, FormData>(
    updateEmailNotifyAction,
    {},
  );
  const current: Record<string, boolean> = {
    emailNotifyComment,
    emailNotifyModeration,
  };

  return (
    <form action={formAction} className="space-y-4">
      <ul className="space-y-3.5">
        {ITEMS.map((it) => (
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

      {/* <p className="text-xs leading-5 text-neutral-400">
        邮件提醒依赖站点 SMTP 配置；站内通知始终不受这些开关影响。新账号默认全部开启。
      </p> */}

      {state.ok && <p className="text-sm text-emerald-600">✓ 已保存</p>}
      {state.error && <p className="text-sm text-red-500">{state.error}</p>}

      <Button
        type="submit"
        disabled={pending}
        className="rounded-none border border-brand-600 bg-brand-500 px-6 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
      >
        {pending ? "保存中…" : "保存"}
      </Button>
    </form>
  );
}
