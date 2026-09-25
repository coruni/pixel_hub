"use client";

// 作者维度打赏按钮：**不挂作品**（`TipRecord.resourceId = null`），钱直接给这个人。
//
// 【全站唯一的打赏入口】作品维度的打赏入口已从资源详情页撤掉，打赏只在个人主页头部出现 ——
// 收款方本来就是同一个人，两个入口只会让人犹豫按哪个。`TipButton` 与服务端 action 保留，
// 只是当前没有 UI 入口。
//
// 【为什么不复用 TipButton】它俩只有提交目标不同，面板已在 `TipDialog` 收敛，
// 这里只保留按钮 + 组装提交参数。
import { useState } from "react";
import { Coins } from "lucide-react";
import { ACTION_TEXT } from "@/lib/ui/cls";
import { sendUserTipAction } from "@/lib/actions/tip";
import TipDialog from "./TipDialog";
import type { TipForm } from "@/lib/points-config";

const LABEL = "打赏作者";

export default function TipUserButton({
  userId,
  username,
  className,
  iconOnly,
  ...form
}: TipForm & {
  userId: string;
  username: string;
  /** 覆盖按钮样式（图标态由调用方给完整外观） */
  className?: string;
  /** 只渲染图标按钮；外观完全由 className 给出，无障碍名取「打赏作者」 */
  iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className ?? ACTION_TEXT}
        title={iconOnly ? LABEL : undefined}
        aria-label={iconOnly ? LABEL : undefined}
        onClick={() => setOpen(true)}
      >
        <Coins size={15} aria-hidden /> {!iconOnly && LABEL}
      </button>
      {open && (
        <TipDialog
          onClose={() => setOpen(false)}
          form={form}
          title={`打赏 @${username}`}
          note={
            <>
              站内 {form.symbol} 转账，全数归 @{username}，平台不抽成。它不会产生贡献分，
              也不影响任何榜单 —— 只是替你觉得好的人付一次钱。
            </>
          }
          onSubmit={(i) =>
            sendUserTipAction({
              toUserId: userId,
              coin: i.coin,
              message: i.message,
              token: i.token,
            })
          }
        />
      )}
    </>
  );
}
