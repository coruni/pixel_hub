"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useActionState, useRef, useState } from "react";
import { Lock, Trash2, Upload } from "lucide-react";
import {
  removeProfileBgAction,
  removeProfileBgMobileAction,
  updateProfileBgGlobalAction,
  updateProfileBgMaskAction,
  updateProfileBgMobileMaskAction,
  updateProfileBgOnResourceAction,
  uploadProfileBgAction,
  uploadProfileBgMobileAction,
  type SettingsActionState,
} from "@/lib/actions/settings";
import { publicUrl } from "@/lib/storage/url";
import {
  PROFILE_BG_MASK_DEFAULT,
  PROFILE_BG_MASK_MAX,
  PROFILE_BG_MOBILE_MASK_DEFAULT,
  isValidBgMask,
  safeBgMask,
  type ProfileBgSlot,
} from "@/lib/upload-config";
import { INPUT } from "@/lib/ui/cls";
import { SquareCheckbox } from "@/components/admin/SquareCheckbox";
import { Button } from "@/components/ui/Button";

// 个人主页背景：**两个槽位** —— 桌面端横图 / 移动端竖图，各一个上传槽 + 一份遮罩形状；
// 两个「展示范围」开关（全局显示 / 资源页对他人可见）与等级门槛则是**两槽共用**的。
//
// 拆两槽的原因：横图在竖屏被 cover 会裁掉左右大半，主体常常直接消失；共用一张必然牺牲其中一端。
// 所以两端各自上传、互不影响，也**不做跨槽回落**（只设了桌面端时移动端就是素底）。
//
// 刻意**不做裁剪**：底图是 cover 铺满，被裁掉的部分恰好落在遮罩留白的中间区，裁剪器只会让用户
// 困惑。改为把前台的遮罩类（.profile-bg-pc / .profile-bg-mobile）直接套在预览上 —— 所见即所得。
//
// 预览挂的是内联的 --profile-bg-mask，前台三个渲染点也是同一套写法（类读变量、变量内联覆盖），
// 所以预览与真实页面看到的形状必然一致，不需要在这里复刻任何渐变。
//
// 遮罩是**用户自己的**设置（User.profileBgMask / profileBgMobileMask），不是站点级配置：
// 每个人背景图不同，该留白多少只有本人知道。留空 = 用**本槽**内置默认（库里存 null）。
//
// 遮罩百分比是相对元素自身的，所以小尺寸预览与真实视口的带子比例一致，可以当准样板看。

/** 槽位 → 该槽的遮罩默认值。与 globals.css 的 .profile-bg-* 及 upload-config.ts 的两个
 *  DEFAULT 常量必须一致，所以这里只做映射、不复制字面量。 */
const SLOT_DEFAULT_MASK: Record<ProfileBgSlot, string> = {
  pc: PROFILE_BG_MASK_DEFAULT,
  mobile: PROFILE_BG_MOBILE_MASK_DEFAULT,
};

/** 槽位 → 前台那道遮罩类的类名（不经过 Tailwind，类名本身写在 globals.css 里） */
const SLOT_MASK_CLASS: Record<ProfileBgSlot, string> = {
  pc: "profile-bg-pc",
  mobile: "profile-bg-mobile",
};

type StateAction = (prev: SettingsActionState, fd: FormData) => Promise<SettingsActionState>;

/**
 * 单个背景槽：上传 + 预览 + 遮罩形状。两槽共用这一个组件，差异只有标题、预览框比例、
 * 建议文案和三个 action —— 复制两份的话，日后调交互必然只改到其中一份。
 *
 * 三个 action 都是**已按槽位绑定**的模块级函数（见 actions/settings.ts）：槽位决定写哪一列，
 * 所以不由 FormData 传入（能被篡改的字段不该参与这个决定）。
 */
function BgSlotForm({
  slot,
  title,
  hint,
  previewBoxCls,
  advice,
  maskHint,
  imageKey,
  maskValue,
  maxMb,
  uploadAction,
  removeAction,
  maskAction,
}: {
  slot: ProfileBgSlot;
  title: string;
  hint: string;
  /** 预览框的尺寸类（两个槽比例不同：桌面端横、移动端竖） */
  previewBoxCls: string;
  advice: string;
  maskHint: string;
  /** 该槽当前存着的图 key；null = 未设置 */
  imageKey: string | null;
  /** 该槽已保存的遮罩值（**原始值**，未经校验：库里可能躺着旧脏值，要让用户看见并改掉）；null = 未自定义 */
  maskValue: string | null;
  maxMb: number;
  uploadAction: StateAction;
  removeAction: () => Promise<void>;
  maskAction: StateAction;
}) {
  const [state, formAction, pending] = useActionState<SettingsActionState, FormData>(
    uploadAction,
    {},
  );
  // 遮罩自带一个 form：调形状不该逼用户重选图（保存按钮在没选图时是禁用的）。上传那个 form
  // 与它并列而不是嵌套 —— HTML 表单不能嵌套。
  const [mkState, mkAction, mkPending] = useActionState<SettingsActionState, FormData>(
    maskAction,
    {},
  );
  const [preview, setPreview] = useState<string | null>(null);
  const [picked, setPicked] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 服务端那份图变了（保存成功 / 移除）→ 丢掉本地预览，否则 object URL 会一直盖着新值。
  // 用**渲染期派生 state**而不是 useEffect：本仓库 react-hooks v7 禁 setState-in-effect，
  // 且这是「props 变化时调整 state」，正是渲染期更新的标准用法（UploadLimitsManager 同款）。
  const [seenKey, setSeenKey] = useState(imageKey);
  if (seenKey !== imageKey) {
    setSeenKey(imageKey);
    setPicked(false);
    setPreview(null);
  }

  // 遮罩草稿：预填**本槽生效值**（未自定义时就是内置默认），这样用户是在一条能用的渐变上改数字，
  // 而不是从空白开始写 CSS。保存时若与默认值一致，服务端会存回 null（继续跟随默认）。
  const defMask = SLOT_DEFAULT_MASK[slot];
  const [maskDraft, setMaskDraft] = useState(maskValue ?? defMask);
  const [seenMask, setSeenMask] = useState(maskValue);
  if (seenMask !== maskValue) {
    setSeenMask(maskValue);
    setMaskDraft(maskValue ?? defMask);
  }
  const maskUsable = isValidBgMask(maskDraft);
  // 与「服务端已保存的值」比对，用来区分「刚保存成功」和「改了还没存」——
  // 只靠 mkState.ok 会在用户继续打字后仍然挂着「✓ 已更新」，等于骗人。
  const maskDirty = maskDraft.trim() !== (maskValue ?? defMask).trim();

  const shown = preview ?? (imageKey ? publicUrl(imageKey) : null);

  return (
    <section className="mt-4 border-t border-brand-200 pt-3.5 first:mt-0 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-medium text-neutral-800">{title}</h3>
      <p className="mt-0.5 text-[11px] leading-4 text-neutral-400">{hint}</p>

      <form action={formAction} className="mt-2">
        <div className={previewBoxCls}>
          <div
            className={`${SLOT_MASK_CLASS[slot]} h-full w-full overflow-hidden border border-brand-200 bg-brand-50 bg-cover bg-center bg-no-repeat`}
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
          预览已套用你当前的遮罩设置，与主页上看到的形状一致。
        </p>
        <p className="mt-1 text-[11px] leading-4 text-neutral-400">{advice}</p>

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
            <Upload size={14} aria-hidden /> {imageKey ? "更换" : "选择图片"}
          </Button>
          <Button
            type="submit"
            disabled={pending || !picked}
            className="rounded-none border border-brand-600 bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {pending ? "保存中…" : "保存"}
          </Button>
          {imageKey && (
            <Button
              type="submit"
              formAction={removeAction}
              variant="dangerGhost"
              size="md"
            >
              <Trash2 size={14} aria-hidden /> 移除
            </Button>
          )}
        </div>
        {state.ok && <p className="mt-1.5 text-xs text-emerald-600">✓ 已更新</p>}
        {state.error && <p className="mt-1.5 text-xs text-red-500">{state.error}</p>}
        <p className="mt-1.5 text-[11px] text-neutral-400">单张最大 {maxMb}MB，不支持 GIF。</p>
      </form>

      {/* 遮罩形状：**始终可调**，不要求先有图。形状是纯 CSS 渐变、与图无关，逼用户先传图才能试
          形状只会让人以为必须先上传；服务端也不看有没有图（saveProfileBgMask 只校形状）。
          没图时预览是空的（下面给一行说明），但值照样存得下，上传后立刻生效。 */}
      <form action={mkAction} className="mt-3">
        <label htmlFor={`bg-mask-${slot}`} className="block text-xs text-neutral-700">
          遮罩形状
        </label>
        <p className="mt-1 text-[11px] leading-4 text-neutral-400">{maskHint}</p>
        {!imageKey && (
          <p className="mt-1 text-[11px] leading-4 text-neutral-500">
            这一端还没有背景图，预览是空的；形状可以先存下来，上传后立刻套用。
          </p>
        )}
        <textarea
          id={`bg-mask-${slot}`}
          name="bgMask"
          rows={3}
          maxLength={PROFILE_BG_MASK_MAX}
          spellCheck={false}
          value={maskDraft}
          onChange={(e) => setMaskDraft(e.target.value)}
          aria-invalid={!maskUsable}
          aria-describedby={`bg-mask-status-${slot}`}
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
            disabled={maskDraft === defMask}
            onClick={() => setMaskDraft(defMask)}
          >
            填回默认值
          </Button>
        </div>
        <p id={`bg-mask-status-${slot}`} className="mt-1.5 text-[11px] leading-4">
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
              {maskDraft.trim() === defMask ? "当前为默认形状。" : "已保存为自定义形状。"}
            </span>
          )}
        </p>
      </form>
    </section>
  );
}

export default function ProfileBgForm({
  unlocked,
  gateName,
  points,
  nextName,
  toNext,
  pcKey,
  mobileKey,
  onResource,
  global: globalDisplay,
  maxMb,
  bgMask,
  bgMobileMask,
}: {
  /** 是否已达解锁等级（服务端用 profileBgUnlocked 算好；这里只管显示） */
  unlocked: boolean;
  /** 解锁所需等级名；门槛指向不存在的档位时为 null */
  gateName: string | null;
  points: number;
  nextName: string | null;
  toNext: number;
  /** 桌面端槽（横图，sm 及以上显示）的存储 key；null = 未设置 */
  pcKey: string | null;
  /** 移动端槽（竖图，小于 sm 显示）的存储 key；null = 未设置 */
  mobileKey: string | null;
  /** 是否允许**其他访客**在本人发布的资源详情页看到这两张背景（默认允许；本人自己始终可见） */
  onResource: boolean;
  /** 全局显示：铺到除后台外的所有页面（默认关） */
  global: boolean;
  maxMb: number;
  /** 桌面端已保存的遮罩值（**原始值**，未经校验：库里可能躺着旧脏值）；null = 未自定义 */
  bgMask: string | null;
  /** 移动端已保存的遮罩值（同口径）；null = 未自定义 */
  bgMobileMask: string | null;
}) {
  // 两个开关注自各一个 form（勾选即提交，ref + requestSubmit）：改开关不该逼用户重选图，
  // 而上传那个「保存」在没选图时是禁用的。HTML 表单不能嵌套 → 它们挂在各槽 form 之外。
  const [plState, plAction, plPending] = useActionState<SettingsActionState, FormData>(
    updateProfileBgOnResourceAction,
    {},
  );
  const plFormRef = useRef<HTMLFormElement>(null);
  const [glState, glAction, glPending] = useActionState<SettingsActionState, FormData>(
    updateProfileBgGlobalAction,
    {},
  );
  const glFormRef = useRef<HTMLFormElement>(null);

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

  return (
    <>
      <BgSlotForm
        slot="pc"
        title="桌面端"
        hint="宽屏（≥ 640px）显示，铺在页面左右两侧的留白里"
        previewBoxCls="aspect-[16/9] w-full max-w-[34rem]"
        advice="建议 16:10 横图（≥ 1920×1200，长边 2560 更清晰），主体放左右两侧。"
        maskHint="控制背景「哪几块看得见」。默认是左右两条带、中间留白给正文；
          中间那段必须保持完全透明（rgba(0, 0, 0, 0)），否则会透到正文卡片底下。
          百分比相对元素宽度，所以窄窗口下带子会按比例变窄。"
        imageKey={pcKey}
        maskValue={bgMask}
        maxMb={maxMb}
        uploadAction={uploadProfileBgAction}
        removeAction={removeProfileBgAction}
        maskAction={updateProfileBgMaskAction}
      />

      <BgSlotForm
        slot="mobile"
        title="移动端"
        hint="窄屏（< 640px）显示，铺在页面顶部与底部的留白里"
        previewBoxCls="aspect-[9/16] w-[11rem] max-w-full"
        advice="建议 9:16 竖图（≥ 1080×1920），全图均匀可见，主体放中间即可。"
        maskHint="控制背景的可见度。默认整张均匀半透明（0.5），不分区域；
          调大更明显、调小更含蓄。注意整张都是非全透明时，卡片之间的空隙里也会看到这层背景。"
        imageKey={mobileKey}
        maskValue={bgMobileMask}
        maxMb={maxMb}
        uploadAction={uploadProfileBgMobileAction}
        removeAction={removeProfileBgMobileAction}
        maskAction={updateProfileBgMobileMaskAction}
      />

      {/* 展示范围：两个开关各自一个 form（勾选即提交）。**两槽共用**，不按槽位再拆一遍 ——
          语义是「这两张背景作为一个整体对外可见 / 不可见」，拆开只会让人以为能只藏其中一张。
          - 全局显示：铺到除后台外的所有页面（含其他访客可见）。
          - 资源页可见：只控制「**其他访客**在你发布的资源详情页能不能看到」，你自己始终可见。 */}
      <form
        ref={glFormRef}
        action={glAction}
        className="mt-4 border-t border-brand-200 pt-3.5"
      >
        <label className="flex items-start gap-3">
          <SquareCheckbox
            name="global"
            defaultChecked={globalDisplay}
            disabled={glPending}
            onChange={() => glFormRef.current?.requestSubmit()}
            ariaLabel="在所有页面都展示这两张背景"
            className="mt-0.5"
          />
          <span className="min-w-0">
            <span className="block text-sm text-neutral-800">全局显示</span>
            <span className="mt-0.5 block text-[11px] leading-4 text-neutral-400">
              开启后这两张背景会铺在除后台外的所有页面（桌面端用横图、移动端用竖图）；
              关闭时只在个人主页和资源详情页展示
            </span>
          </span>
        </label>
        {glPending && <p className="mt-1.5 text-xs text-neutral-400">保存中…</p>}
        {!glPending && glState.ok && <p className="mt-1.5 text-xs text-emerald-600">✓ 已更新</p>}
        {!glPending && glState.error && (
          <p className="mt-1.5 text-xs text-red-500">{glState.error}</p>
        )}
      </form>

      <form ref={plFormRef} action={plAction} className="mt-4 border-t border-brand-200 pt-3.5">
        <label className="flex items-start gap-3">
          <SquareCheckbox
            name="onResource"
            defaultChecked={onResource}
            disabled={plPending}
            onChange={() => plFormRef.current?.requestSubmit()}
            ariaLabel="允许他人在你的资源详情页看到这两张背景"
            className="mt-0.5"
          />
          <span className="min-w-0">
            <span className="block text-sm text-neutral-800">资源页对他人可见</span>
            <span className="mt-0.5 block text-[11px] leading-4 text-neutral-400">
              未勾选时其他访客看不到，但你自己仍然看得到
            </span>
          </span>
        </label>
        {plPending && <p className="mt-1.5 text-xs text-neutral-400">保存中…</p>}
        {!plPending && plState.ok && <p className="mt-1.5 text-xs text-emerald-600">✓ 已更新</p>}
        {!plPending && plState.error && (
          <p className="mt-1.5 text-xs text-red-500">{plState.error}</p>
        )}
      </form>
    </>
  );
}
