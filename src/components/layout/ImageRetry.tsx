"use client";

/**
 * 图片加载失败自动重试（全站兜底，挂在 root layout，不渲染任何 DOM）。
 *
 * **为什么需要它**：线上会出现「首屏图片全裂、手动刷新一次才出来」。
 * 抓到的失败是 `net::ERR_CONNECTION_RESET` —— 不是 404、不是路径写错，而是 TCP 连接
 * 被对端掐断（典型来源：前置代理把请求发到了源站已经关闭的 keep-alive 连接上，
 * 见 server.js 里对 keepAliveTimeout 的说明）。这种情况**浏览器不会自动重发**，
 * 用户看到的就是裂图 + 必须刷新。这里在 document 的捕获阶段接住资源加载失败，
 * 对 `<img>` 做有限次重发，把「手动刷新」变成「自动重试」。
 *
 * 只做两件很克制的事，失败计数记在 `data-img-retry` 上（最多 2 次，之后不再干预 ——
 * 真 404 就让占位图/alt 生效，避免把死链打成重试风暴）：
 *   ① 接住 `error`（捕获阶段）：**站内相对地址**重发时带一次性 query —— 既绕过可能
 *      已缓存的失败响应（next.config.ts 给 /uploads 挂了 1 年 immutable），
 *      也保证换一条新连接；外链/带签名的绝对地址只原样重发，不动它的 query。
 *   ② 挂载时补扫一次：连接被 reset 几乎立刻返回，首屏图片的失败往往发生在 hydration
 *      之前（监听器还没挂上），只靠事件会漏掉整批 —— 那正是「首屏全裂」的形态。
 *
 * 只覆盖 `<img>`。CSS `background-image`（主页背景、hero）拿不到 error 事件，
 * 需要单独兜的话得另外想办法 —— 这里不假装覆盖了。
 */

import { useEffect } from "react";

/** 重发前的短暂延迟：连接被 reset 往往是一次性的，隔一拍重发基本必中 */
const RETRY_DELAY_MS = 300;
/** 最多重试次数（dataset 里记录了已重试次数） */
const MAX_RETRY = 2;

/**
 * 计算重试用的地址。只给**站内相对地址**（以单个 `/` 开头）加缓冲突破参数：
 * 绝对地址可能是带签名的外链（云盘预授权、第三方图床），动 query 有可能把签名弄废。
 * 用 URL API 而不是拼字符串：第二次重试时会把上一次的 `imgretry` 覆盖掉，不会越叠越长。
 */
function retrySrc(src: string, attempt: number): string {
  if (!src.startsWith("/") || src.startsWith("//")) return src;
  const url = new URL(src, window.location.origin);
  url.searchParams.set("imgretry", String(attempt));
  return url.pathname + url.search + url.hash;
}

export default function ImageRetry() {
  useEffect(() => {
    /**
     * 重发一张已失败的 `<img>`。次数记在 dataset 上，跨监听器与补扫共用同一份计数。
     * 返回是否真的安排了重发。
     */
    function retry(el: HTMLImageElement): boolean {
      const src = el.currentSrc || el.src;
      // blob:/data: 是本地预览，重试没有意义
      if (!src || src.startsWith("data:") || src.startsWith("blob:")) return false;
      const done = Number(el.dataset.imgRetry ?? "0");
      if (!Number.isFinite(done) || done >= MAX_RETRY) return false;
      el.dataset.imgRetry = String(done + 1);
      const next = retrySrc(src, done + 1);
      window.setTimeout(() => {
        // 元素可能已经卸载（翻页/切 tab），此时赋值是无害的空操作
        el.src = next;
      }, RETRY_DELAY_MS);
      return true;
    }

    function onError(e: Event) {
      // 资源错误事件不冒泡，但会在捕获阶段经过 window —— 所以这里能收到全站的 <img>
      const el = e.target;
      if (el instanceof HTMLImageElement) retry(el);
    }

    /**
     * 挂载时补扫一遍：连接被 reset 几乎是立刻返回的，首屏图片的失败很可能发生在
     * hydration 之前（那时监听器还没挂上）—— 只靠事件会漏掉这一批，
     * 而「首屏全裂」正是报障的原始形态。`complete && naturalWidth === 0` 就是「已失败」
     * 的判据（尚未开始加载的 lazy 图不是 complete，不会误伤）。
     */
    for (const el of document.querySelectorAll("img")) {
      if (el.complete && el.naturalWidth === 0) retry(el);
    }

    window.addEventListener("error", onError, true);
    return () => window.removeEventListener("error", onError, true);
  }, []);

  return null;
}
