"use client";

// 作者维度打赏按钮：**不挂作品**（`TipRecord.resourceId = null`），钱直接给这个人。
//
// 【为什么和作品打赏并存】作品打赏回答的是「这件东西值多少」，作者打赏回答的是「这个人值多少」——
// 站上有大量没有下载物的内容（外链游戏、嵌入视频、纯欣赏的图），读者想谢的是作者，
// 硬塞一件作品当载体反而别扭。两者收款方相同，所以按钮文案必须能区分：
// 作品那条叫「打赏」，作者这条叫「打赏作者」。
//
// 【为什么不复用 TipButton】它俩只有提交目标不同，面板已在 `TipDialog` 收敛，
// 这里只保留按钮 + 组装提交参数。
import { useState } from "react";
import { Coins } from "lucide-react";
import { ACTION_TEXT } from "@/lib/ui/cls";
import { sendUserTipAction } from "@/lib/actions/tip";
import TipDialog from "./TipDialog";
import type { TipForm } from "@/lib/points-config";

export default function TipUserButton({
  userId,
  username,
  className,
  ...form
}: TipForm & {
  userId: string;
  username: string;
  /** 覆盖按钮样式（个人主页头部用描边按钮，详情页作者行用 `ACTION_TEXT`） */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className ?? ACTION_TEXT}
        onClick={() => setOpen(true)}
      >
        <Coins size={15} aria-hidden /> 打赏作者
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
