"use client";

// 审核队列里的「可见性标注」就地修正面板。
//
// 为什么单开一块：审核员在队列里翻内容时最常要动的是「这条该不该打 NSFW / 该不该要求登录」，
// 判定动作（通过 / 打回）就在旁边，改标注却要跳去 /admin/content/{id}/edit 那个整页表单，
// 标题正文媒体标签全得原样走一遍。这里只暴露三个布尔，选项文案与发布向导共用 PUBLISH_OPTIONS
// （唯一事实来源，避免两边说明分叉），写入仍由服务端 setResourceFlags 做权限与字段白名单校验。
//
// 草稿**不做 props 回同步**：队列条目里隔壁就有「通过 / 下架」按钮，它们成功后都会 router.refresh()，
// 若在这里跟着同步 props，用户勾了还没保存就被别人一次刷新冲掉了。只在保存成功后刷新，
// 那次刷新时草稿本就等于服务端值，不会有分叉。
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { SquareCheckbox } from "@/components/admin/SquareCheckbox";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/feedback";
import { PUBLISH_OPTIONS, type PublishOptionName } from "@/components/upload/wizard-shared";
import { setResourceFlags } from "@/lib/actions/moderation";

export default function ResourceFlagsForm({
  resourceId,
  values,
}: {
  resourceId: string;
  values: Record<PublishOptionName, boolean>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState(values);
  const [failed, setFailed] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // 三个开关是一次性整组提交的，「脏」即任意一个与服务端不同
  const dirty = PUBLISH_OPTIONS.some((o) => draft[o.name] !== values[o.name]);

  function save() {
    setFailed(null);
    setSaved(false);
    start(async () => {
      const r = await setResourceFlags(resourceId, draft);
      if (!r.ok) {
        const msg = r.error ?? "保存失败，请重试";
        setFailed(msg);
        toast(msg, "error");
        return;
      }
      setSaved(true);
      router.refresh(); // 顶部徽章是服务端渲染的，必须让它跟着变
    });
  }

  return (
    <div className="mt-3 border-t border-neutral-100 pt-3">
      <p className="text-xs text-neutral-500">
        可见性与互动
        <span className="ml-2 text-[11px] text-neutral-400">就地修正标注，不必跳去整页编辑</span>
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {PUBLISH_OPTIONS.map((o) => (
          <label
            key={o.name}
            className="flex items-start gap-2 rounded-none border border-brand-200 px-3 py-2"
          >
            <SquareCheckbox
              checked={draft[o.name]}
              onChange={(next) => setDraft((d) => ({ ...d, [o.name]: next }))}
              ariaLabel={o.label}
              disabled={pending}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="block text-xs text-neutral-800">{o.label}</span>
              <span className="mt-0.5 block text-[11px] leading-4 text-neutral-400">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="primary"
          disabled={pending || !dirty}
          onClick={save}
        >
          {pending ? "保存中…" : "保存修改"}
        </Button>
        {failed ? (
          <span className="text-[11px] text-red-500">{failed}</span>
        ) : dirty ? (
          <span className="text-[11px] text-neutral-400">有未保存的修改</span>
        ) : saved ? (
          <span className="text-[11px] text-emerald-600">✓ 已保存</span>
        ) : null}
      </div>
    </div>
  );
}
