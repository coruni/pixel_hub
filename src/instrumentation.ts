// Next.js 服务器启动钩子 —— 全站**唯一**的进程内定时器入口。
//
// 【为什么这里破例用了定时器（本仓既有惯例是「机会式」）】
// `src/app/api/track/route.ts` 与 `src/lib/download-record.ts` 采用「约 1% 的请求顺带清理」
// 来免掉定时任务，但那套只适合**可延后**的清理：数据多留几天没有后果。
// 结算不一样 —— 它有会计时限，而且必须**按月顺序串行补齐**（`carryInOf` 只认上一期，
// 跳月会永久丢结转）。「没人访问就不结算」在这里不是一个可接受的失败模式，
// 所以刻意偏离机会式，改为定时触发。除此之外不要再往这个文件塞别的后台任务。
//
// 【默认惰性】`settlement.autoEnabled` 默认 false。开关没打开时，每一轮只是读一次配置
// 就返回，不产生任何写操作，也不会消耗重试窗口（见 `maybeAutoSettle`）。
//
// 【只跑 Node runtime】Edge runtime 没有长驻进程语义，定时器在那边毫无意义。
import { maybeAutoSettle, summarize } from "@/lib/settle-auto";

/** 轮询间隔：真正的节流由 `settlement.autoRetryHours` 在 settle-auto 里控制 */
const TICK_MS = 15 * 60 * 1000;
/** 启动后首次尝试的延迟：别和冷启动抢资源，但停机补跑要尽快发生 */
const FIRST_DELAY_MS = 20 * 1000;

const globalRef = globalThis as typeof globalThis & { __pixAutoSettleTimer?: true };

export function register(): void {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // 构建期会为预渲染起 worker，那里不该起定时器（会白跑一轮还会打日志）
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  // dev 下 HMR 会重复求值本模块；用 globalThis 保证一个进程只有一个表
  if (globalRef.__pixAutoSettleTimer) return;
  globalRef.__pixAutoSettleTimer = true;

  const tick = () => {
    // 定时器回调绝不能抛：一次未捕获的 rejection 会让进程退出
    void maybeAutoSettle()
      .then((r) => {
        if (!r.ran) return; // 未开启 / 未到点 / 未满重试间隔：不打日志，避免噪声
        console.log(summarize(r));
        if (r.blocked) console.warn("[settle:auto] 本轮已中断，将在下个重试窗口再试");
      })
      .catch((e) => {
        console.error("[settle:auto] 调度异常:", e);
      });
  };

  const first = setTimeout(tick, FIRST_DELAY_MS);
  const timer = setInterval(tick, TICK_MS);
  // CLI 场景（脚本直接 import 组件）没有活着的 HTTP server 兜底，允许被 unref 掉
  first.unref?.();
  timer.unref?.();
}
