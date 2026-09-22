"use client";

// 作品维度打赏按钮：钱记在这件作品名下（`TipRecord.resourceId = 作品 id`）。
// 面板本身在 `TipDialog` —— 与「直接打赏作者」共用同一套 UI 与校验，只换 `onSubmit`。
//
// 【为什么不新起一行】打赏与点赞/收藏/关注是同一层的「读完顺手做的事」，
// 所以它沿用 `ACTION_TEXT` 的「图标 + 文字」形态，留在 ActionBar 那一行里（计划 §8）。
// 面板做成自包含的浮层：ActionBar 是 `justify-end` 的单行容器，任何内联展开都会把整行推歪。
import { useState } from "react";
import { Coins } from "lucide-react";
import { ACTION_TEXT } from "@/lib/ui/cls";
import { sendTipAction } from "@/lib/actions/tip";
import TipDialog from "./TipDialog";
import type { TipForm } from "@/lib/points-config";

export default function TipButton({
  resourceId,
  ...form
}: TipForm & { resourceId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={ACTION_TEXT} onClick={() => setOpen(true)}>
        <Coins size={15} aria-hidden /> 打赏
      </button>
      {open && (
        <TipDialog
          onClose={() => setOpen(false)}
          form={form}
          title="打赏作品"
          note={
            <>
              站内 {form.symbol} 转账，全数归作者，平台不抽成。它不会产生贡献分，
              也不影响任何榜单 —— 只是替你觉得好的东西付一次钱。
            </>
          }
          onSubmit={(i) =>
            sendTipAction({
              resourceId,
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
