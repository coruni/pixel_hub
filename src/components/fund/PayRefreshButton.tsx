"use client";

// 支付结果页的「我已支付，刷新状态」按钮。
// 回调可能丢失（网络抖动、上游重试耗尽），所以必须给用户一个主动兜底的动作 ——
// 它服务端调上游 `act=order` 查单并补记，而不是让用户去联系站长。
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "@/components/ui/feedback";
import { Button } from "@/components/ui/Button";
import { useRouter } from "next/navigation";

export default function PayRefreshButton({ outTradeNo }: { outTradeNo: string }) {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  const refresh = async () => {
    setPending(true);
    try {
      const res = await fetch("/api/pay/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outTradeNo }),
      });
      const data = (await res.json().catch(() => null)) as
        | { paid?: boolean; error?: string; notice?: string }
        | null;
      if (!res.ok) {
        toast(data?.error ?? "查询失败，请稍后再试", "error");
        return;
      }
      if (data?.paid) {
        toast("已确认到账，感谢支持", "success");
        router.refresh();
      } else {
        toast(data?.notice ?? "上游尚未确认这笔支付，请稍后再试", "info");
      }
    } catch {
      toast("网络异常，请稍后再试", "error");
    } finally {
      setPending(false);
    }
  };

  return (
    <Button type="button" onClick={refresh} disabled={pending} variant="ghost">
      <RefreshCw size={13} aria-hidden />
      {pending ? "查询中…" : "我已支付，刷新状态"}
    </Button>
  );
}
