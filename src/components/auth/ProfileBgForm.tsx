"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useActionState, useRef, useState } from "react";
import { Lock, Trash2, Upload } from "lucide-react";
import {
  removeProfileBgAction,
  updateProfileBgMaskAction,
  updateProfileBgOnResourceAction,
  uploadProfileBgAction,
  type SettingsActionState,
} from "@/lib/actions/settings";
import { publicUrl } from "@/lib/storage/url";
import {
  PROFILE_BG_MASK_DEFAULT,
  PROFILE_BG_MASK_MAX,
  isValidBgMask,
  safeBgMask,
} from "@/lib/upload-config";
import { INPUT } from "@/lib/ui/cls";
import { SquareCheckbox } from "@/components/admin/SquareCheckbox";
import { Button } from "@/components/ui/Button";

// 个人主页背景：单个上传槽 + 遮罩形状（都仅桌面端展示）。
//
// 刻意**不做裁剪**：底图是 cover 铺满，被裁掉的部分恰好落在遮罩留白的中间区，裁剪器只会让用户
// 困惑。改为把前台的遮罩类（.profile-bg-pc）直接套在预览上 —— 所见即所得。
//
// 预览挂的是内联的 --profile-bg-mask，前台两个渲染点也是同一套写法（类读变量、变量内联覆盖），
// 所以预览与真实主页看到的形状必然一致，不需要在这里复刻任何渐变。
//
// 遮罩是**用户自己的**设置（User.profileBgMask），不是站点级配置：每个人背景图不同，
// 该留白多少只有本人知道。留空 = 用内置默认（库里存 null，见 actions/settings.ts）。
//
// 遮罩百分比是相对元素自身的，所以小尺寸预览与真实视口的带子比例一致，可以当准样板看。

export default function ProfileBgForm({
  unlocked,
  gateName,
  points,
  nextName,
  toNext,
  pcKey,
  onResource,
  maxMb,
  bgMask,
}: {
  /** 是否已达解锁等级（服务端用 profileBgUnlocked 算好；这里只管显示） */
  unlocked: boolean;
  /** 解锁所需等级名；门槛指向不存在的档位时为 null */
  gateName: string | null;
  points: number;
  nextName: string | null;
  toNext: number;
  pcKey: string | null;
  /** 是否把这张背景一并铺到本人发布的资源详情页（默认铺） */
  onResource: boolean;
  maxMb: number;
  /** 该用户已保存的遮罩值（**原始值**，未经校验：库里可能躺着旧脏值，要让用户看见并改掉）；null = 未自定义 */
  bgMask: string | null;
}) {
  const [state, formAction, pending] = useActionState<SettingsActionState, FormData>(
    uploadProfileBgAction,
    {},
  );
  // 展示范围开关自带一个 form：改开关不该逼用户重选图，而上传那个「保存」在没选图时是禁用的。
  // HTML 表单不能嵌套 → 它挂在上传 form 之外，勾选即提交（ref + requestSubmit）。
  const [plState, plAction, plPending] = useActionState<SettingsActionState, FormData>(
    updateProfileBgOnResourceAction,
    {},
  );
  const plFormRef = useRef<HTMLFormElement>(null);
  // 遮罩同样自带一个 form：调形状不该逼用户重选图（保存按钮在没选图时是禁用的）。
  const [mkState, mkAction, mkPending] = useActionState<SettingsActionState, FormData>(
    updateProfileBgMaskAction,
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

  // 遮罩草稿：预填**生效值**（未自定义时就是内置默认），这样用户是在一条能用的渐变上改数字，
  // 而不是从空白开始写 CSS。保存时若与默认值一致，服务端会存回 null（继续跟随默认）。
  const [maskDraft, setMaskDraft] = useState(bgMask ?? PROFILE_BG_MASK_DEFAULT);
  const [seenMask, setSeenMask] = useState(bgMask);
  if (seenMask !== bgMask) {
    setSeenMask(bgMask);
    setMaskDraft(bgMask ?? PROFILE_BG_MASK_DEFAULT);
  }
  const maskUsable = isValidBgMask(maskDraft);
  // 与「服务端已保存的值」比对，用来区分「刚保存成功」和「改了还没存」——
  // 只靠 mkState.ok 会在用户继续打字后仍然挂着「✓ 已更新」，等于骗人。
  const maskDirty = maskDraft.trim() !== (bgMask ?? PROFILE_BG_MASK_DEFAULT).trim();

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
    <>
      <form action={formAction} className="min-w-0">
        <div className="max-w-[34rem]">
          <div className="aspect-[16/9] w-full overflow-hidden rounded-none border border-brand-200 bg-brand-50">
            <div
              className="profile-bg-pc h-full w-full bg-cover bg-center bg-no-repeat"
              style={
                {
                  backgroundImage: shown ? `url(${shown})` : undefined,
                  "--profile-bg-mask": safeBgMask(maskDraft),
                } as CSSProperties
              }
            >
              {!shown && (
                <div className="grid h-full place-items-center text-xs text-neutral-400">暂无</div>
              )}
            </div>
          </div>
          <p className="mt-1.5 text-[11px] leading-4 text-neutral-400">
            预览已套用你当前的遮罩设置，与主页上看到的形状一致。仅桌面端展示。
          </p>
          <p className="mt-1 text-[11px] leading-4 text-neutral-400">
            建议 16:10 横图（≥ 1920×1200，长边 2560 更清晰），主体放左右两侧。
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
            className="inline-flex items-center gap-1.5 rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-sm text-neutral-700 hover:border-brand-500 hover:text-neutral-900"
          >
            <Upload size={14} aria-hidden /> {pcKey ? "更换" : "选择图片"}
          </Button>
          <Button
            type="submit"
            disabled={pending || !picked}
            className="rounded-none border border-brand-600 bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {pending ? "保存中…" : "保存"}
          </Button>
          {pcKey && (
            <Button
              type="submit"
              formAction={removeProfileBgAction}
              variant="dangerGhost" size="md"
            >
              <Trash2 size={14} aria-hidden /> 移除
            </Button>
          )}
        </div>
        {state.ok && <p className="mt-1.5 text-xs text-emerald-600">✓ 已更新</p>}
        {state.error && <p className="mt-1.5 text-xs text-red-500">{state.error}</p>}
        <p className="mt-1.5 text-[11px] text-neutral-400">单张最大 {maxMb}MB，不支持 GIF。</p>
      </form>

      {/* 展示范围：只在你本人发布的资源详情页生效，个人主页始终展示。 */}
      <form ref={plFormRef} action={plAction} className="mt-4 border-t border-brand-200 pt-3.5">
        <label className="flex items-start gap-3">
          <SquareCheckbox
            name="onResource"
            defaultChecked={onResource}
            disabled={plPending}
            onChange={() => plFormRef.current?.requestSubmit()}
            ariaLabel="在资源详情页也展示这张背景"
            className="mt-0.5"
          />
          <span className="min-w-0">
            <span className="block text-sm text-neutral-800">在资源详情页也展示</span>
          </span>
        </label>
        {plPending && <p className="mt-1.5 text-xs text-neutral-400">保存中…</p>}
        {!plPending && plState.ok && <p className="mt-1.5 text-xs text-emerald-600">✓ 已更新</p>}
        {!plPending && plState.error && (
          <p className="mt-1.5 text-xs text-red-500">{plState.error}</p>
        )}
      </form>

      {/* 遮罩形状：只在已经有背景图时出现 —— 没图时调形状看不到任何变化，只会让人困惑。 */}
      {pcKey && (
        <form action={mkAction} className="mt-4 border-t border-brand-200 pt-3.5">
          <label htmlFor="bg-mask" className="block text-sm text-neutral-800">
            遮罩形状
          </label>
          <p className="mt-1 text-[11px] leading-4 text-neutral-400">
            控制背景「哪几块看得见」。默认是左右两条带、中间留白给正文；
            中间那段必须保持完全透明（rgba(0, 0, 0, 0)），否则会透到正文卡片底下。
            百分比相对屏幕宽度，所以窄窗口下带子会按比例变窄。
          </p>
          <textarea
            id="bg-mask"
            name="bgMask"
            rows={3}
            maxLength={PROFILE_BG_MASK_MAX}
            spellCheck={false}
            value={maskDraft}
            onChange={(e) => setMaskDraft(e.target.value)}
            aria-invalid={!maskUsable}
            aria-describedby="bg-mask-status"
            className={`${INPUT} mt-2 text-[11px] leading-5`}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" size="md" disabled={mkPending || !maskUsable}>
              {mkPending ? "保存中…" : "保存遮罩"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="md"
              disabled={maskDraft === PROFILE_BG_MASK_DEFAULT}
              onClick={() => setMaskDraft(PROFILE_BG_MASK_DEFAULT)}
            >
              填回默认值
            </Button>
          </div>
          <p id="bg-mask-status" className="mt-1.5 text-[11px] leading-4">
            {!maskUsable ? (
              <span className="text-amber-700">
                值不可用，保存会被拒绝：需要一条以 linear-gradient( / radial-gradient( /
                conic-gradient( 开头、以 ) 结尾的值。
              </span>
            ) : mkState.error ? (
              <span className="text-red-500">{mkState.error}</span>
            ) : mkState.ok && !maskDirty ? (
              <span className="text-emerald-600">✓ 已更新</span>
            ) : maskDirty ? (
              <span className="text-neutral-400">有未保存的修改。</span>
            ) : (
              <span className="text-neutral-400">
                {maskDraft.trim() === PROFILE_BG_MASK_DEFAULT
                  ? "当前为默认形状。"
                  : "已保存为自定义形状。"}
              </span>
            )}
          </p>
        </form>
      )}
    </>
  );
}
