"use client";

import { useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";

/** action 通用返回形状（各 server action 的最小公约数） */
export type ActionResult = { ok: boolean; error?: string };

/**
 * 后台/表单通用 action 执行器：useTransition 包裹，失败 alert、成功默认 router.refresh()。
 * 各组件原先各自复制 useOps/run/act 三件套，统一收敛到这里。
 */
export function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = useCallback(
    (fn: () => Promise<ActionResult>, opts?: { refresh?: boolean }) =>
      start(async () => {
        const r = await fn();
        if (!r.ok) window.alert(r.error ?? "操作失败");
        else if (opts?.refresh !== false) router.refresh();
      }),
    [router, start]
  );
  return { run, pending };
}
