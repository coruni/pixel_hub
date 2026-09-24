"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { Lock, Trash2, Upload } from "lucide-react";
import {
  removeProfileBgAction,
  uploadProfileBgAction,
  type SettingsActionState,
} from "@/lib/actions/settings";
import { publicUrl } from "@/lib/storage/url";
import { Button } from "@/components/ui/Button";

// 个人主页背景：单个上传槽（仅桌面端展示）。
//
// 刻意**不做裁剪**：底图是 cover 铺满，被裁掉的部分恰好落在遮罩留白的中间区，裁剪器只会让用户
// 困惑。改为把前台的遮罩类（.profile-bg-pc）直接套在预览上 —— 所见即所得，两边共用 globals.css
// 里那一份渐变，不在这里复刻。
//
// 遮罩百分比是相对元素自身的，所以小尺寸预览与真实视口的带子比例一致，可以当准样板看。

export default function ProfileBgForm({
  unlocked,
  gateName,
  points,
  nextName,
  toNext,
  pcKey,
  maxMb,
}: {
  /** 是否已达解锁等级（服务端用 profileBgUnlocked 算好；这里只管显示） */
  unlocked: boolean;
  /** 解锁所需等级名；门槛指向不存在的档位时为 null */
  gateName: string | null;
  points: number;
  nextName: string | null;
  toNext: number;
  pcKey: string | null;
  maxMb: number;
}) {
  const [state, formAction, pending] = useActionState<SettingsActionState, FormData>(
    uploadProfileBgAction,
    {},
  );
  const [preview, setPreview] = useState<string | null>(null);
  const [picked, setPicked] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 服务端那份图变了（保存成功 / 移除）→ 丢掉本地预览，否则 object URL 会一直盖着新值。
  // 用**渲染期派生 state**而不是 useEffect：本仓库 react-hooks v7 禁 setState-in-effect，
  // 且这是「props 变化时调整 state」，正是渲染期更新的标准用法（UploadLimitsManager 同款）。
  const [seenKey, setSeenKey] = useState(pcKey);
  if (seenKey !== pcKey) {
    setSeenKey(pcKey);
    setPicked(false);
    setPreview(null);
  }

  if (!unlocked) {
    return (
      <div className="border border-brand-200 bg-brand-50/60 px-4 py-3.5">
        <p className="flex items-center gap-1.5 text-xs font-medium text-neutral-700">
          <Lock size={13} aria-hidden />
          {gateName ? `达到「${gateName}」后开放` : "达到更高等级后开放"}
        </p>
        <p className="mt-1 text-[11px] leading-5 text-neutral-500">
          当前贡献分 {points}
          {nextName ? ` · 还差 ${toNext} 分到「${nextName}」` : " · 已是最高等级"}
        </p>
        <Link
          href="/creators/me"
          className="mt-1.5 inline-block text-[11px] text-brand-700 hover:underline"
        >
          查看我的贡献分
        </Link>
      </div>
    );
  }

  const shown = preview ?? (pcKey ? publicUrl(pcKey) : null);

  return (
    <form action={formAction} className="min-w-0">
      <div className="max-w-[34rem]">
        <div className="aspect-[16/9] w-full overflow-hidden rounded-none border border-brand-200 bg-brand-50">
          <div
            className="profile-bg-pc h-full w-full bg-cover bg-center bg-no-repeat"
            style={shown ? { backgroundImage: `url(${shown})` } : undefined}
          >
            {!shown && (
              <div className="grid h-full place-items-center text-xs text-neutral-400">暂无</div>
            )}
          </div>
        </div>
        <p className="mt-1.5 text-[11px] leading-4 text-neutral-400">
          预览已套用主页上的实际遮罩：左右两侧可见，中间留白。建议横图。仅桌面端展示。
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        name="bg"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            setPicked(true);
            setPreview(URL.createObjectURL(f));
          }
        }}
      />

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-none border border-brand-200 bg-surface px-3.5 py-2 text-sm text-neutral-700 hover:border-brand-500 hover:text-neutral-900"
        >
          <Upload size={14} aria-hidden /> {pcKey ? "更换" : "选择图片"}
        </Button>
        <Button
          type="submit"
          disabled={pending || !picked}
          className="rounded-none border border-brand-600 bg-brand-500 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {pending ? "保存中…" : "保存"}
        </Button>
        {pcKey && (
          <Button
            type="submit"
            formAction={removeProfileBgAction}
            className="inline-flex items-center gap-1.5 rounded-none border border-brand-200 bg-surface px-3.5 py-2 text-sm text-neutral-600 hover:border-red-300 hover:text-red-600"
          >
            <Trash2 size={14} aria-hidden /> 移除
          </Button>
        )}
      </div>
      {state.ok && <p className="mt-1.5 text-xs text-emerald-600">✓ 已更新</p>}
      {state.error && <p className="mt-1.5 text-xs text-red-500">{state.error}</p>}
      <p className="mt-1.5 text-[11px] text-neutral-400">单张最大 {maxMb}MB，不支持 GIF。</p>
    </form>
  );
}
