// IndexNow 推送（服务端专用）：把内容变更的 URL 主动告知搜索引擎，缩短收录延迟。
//
// 协议三步：① 生成密钥 → ② 把密钥文件放到站点根 /{key}.txt（内容即密钥本身，由 app/[indexKey]/route.ts 提供）
// → ③ POST 到 api.indexnow.org/indexnow，body 带 host / key / keyLocation / urlList。
// 一次提交覆盖 Bing、Yandex、Naver、Seznam 等共用该协议的引擎；本站对 https://api.indexnow.org 的
// 响应码只做记录与提示，绝不让推送失败影响发布或保存流程。
import { after } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { isValidIndexNowKey } from "@/lib/indexnow-key";
import { getSeoConfig } from "@/lib/seo-config";
import { siteUrl } from "@/lib/site-url";

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
/** 单次请求 URL 上限（协议规定 10000，超出需拆分） */
export const INDEXNOW_MAX_URLS = 10000;
/** 推送超时：失败可感知，但不得拖住发布/保存流程 */
const TIMEOUT_MS = 8000;

export type IndexNowResult = {
  ok: boolean;
  /** 实际提交的 URL 数（已去重、已剔除非同源） */
  submitted: number;
  /** 引擎响应状态码（网络异常时为 undefined） */
  status?: number;
  /** 面向后台的可操作提示 */
  error?: string;
};

/** 密钥文件地址：IndexNow 要求文件位于站点根目录且内容与文件名中的密钥一致 */
export function indexNowKeyFileUrl(key: string): string {
  return `${siteUrl()}/${key.trim()}.txt`;
}

/** 引擎响应码 → 中文提示（见 https://www.indexnow.org/documentation 状态码说明） */
function describeStatus(status: number): string | undefined {
  if (status === 200) return undefined; // 成功
  if (status === 202) return "已接受，密钥待引擎校验（密钥文件未生效时会出现此码）";
  if (status === 400) return "请求格式错误";
  if (status === 403) return "密钥校验失败：请确认站点根目录可访问密钥文件";
  if (status === 422) return "URL 与主机或密钥不匹配，或包含非本站 URL";
  if (status === 429) return "提交过于频繁，请稍后再试";
  return `引擎返回异常状态码 ${status}`;
}

/** 规范化为站点同源的绝对 URL；非同源或非法项返回 null（IndexNow 会拒绝跨主机 URL） */
function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const base = new URL(siteUrl());
    const url = new URL(trimmed, base);
    if (url.protocol !== base.protocol || url.host !== base.host) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * 提交一批 URL。未启用/未配置合法密钥时返回明确原因而不是静默跳过，
 * 便于后台「立即推送」按钮把真实原因展示给管理员。
 */
export async function submitIndexNow(urls: string[]): Promise<IndexNowResult> {
  const seo = await getSeoConfig();
  const key = seo.indexnow.key.trim();
  if (!seo.indexnow.enabled) {
    return { ok: false, submitted: 0, error: "IndexNow 未启用" };
  }
  if (!isValidIndexNowKey(key)) {
    return { ok: false, submitted: 0, error: "密钥无效：需 8~128 位字母、数字或短横线" };
  }

  const urlList = [...new Set(urls.map(normalizeUrl).filter((u): u is string => !!u))].slice(
    0,
    INDEXNOW_MAX_URLS,
  );
  if (urlList.length === 0) return { ok: false, submitted: 0, error: "没有可提交的本站 URL" };

  const host = new URL(siteUrl()).host;
  const keyLocation = indexNowKeyFileUrl(key);
  try {
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host, key, keyLocation, urlList }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const error = describeStatus(res.status);
    return { ok: res.ok, submitted: urlList.length, status: res.status, error };
  } catch (e) {
    console.error("[indexnow] 提交失败", e);
    return { ok: false, submitted: urlList.length, error: "无法连接 IndexNow 接口（网络或超时）" };
  }
}

/**
 * 发布/恢复后异步推送某资源的详情页。
 * 必须在 Server Action / Route Handler 中调用：after() 在响应结束后执行，既不拖慢发布，也不会被提前中断。
 * 内部自行容错，调用点无需 try/catch。
 */
export function queueIndexNowForResource(resourceId: string): void {
  after(async () => {
    try {
      const seo = await getSeoConfig();
      if (!seo.indexnow.enabled || !isValidIndexNowKey(seo.indexnow.key)) return;
      const row = await prisma.resource.findUnique({
        where: { id: resourceId },
        select: { slug: true, status: true },
      });
      // 推送时已不是已发布态（例如刚被下架）就不必告知引擎
      if (!row || row.status !== "PUBLISHED") return;
      const r = await submitIndexNow([`/resources/${row.slug}`]);
      if (!r.ok) console.error("[indexnow] 资源推送未成功", resourceId, r.error ?? r.status);
    } catch (e) {
      console.error("[indexnow] 资源推送异常", resourceId, e);
    }
  });
}
