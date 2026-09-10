import { notFound } from "next/navigation";
import { isValidIndexNowKey } from "@/lib/indexnow-key";
import { getSeoConfig } from "@/lib/seo-config";

// IndexNow 密钥文件：把后台配置的密钥以 /{key}.txt 形式暴露在站点根目录，
// 供 Bing / Yandex 等引擎抓取校验（文件名与文件内容必须逐字一致）。
// 根级单段动态路由只命中「未被其他静态路由占用的一段路径」，非密钥文件一律 404（渲染全站 404 页）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY_FILE_RE = /^([A-Za-z0-9-]{8,128})\.txt$/;

export async function GET(_req: Request, { params }: { params: Promise<{ indexKey: string }> }) {
  const { indexKey } = await params;
  const matched = KEY_FILE_RE.exec(indexKey ?? "");
  if (!matched) notFound();

  const key = (await getSeoConfig()).indexnow.key.trim();
  // 只返回当前生效的密钥：换密钥后旧文件立即失效，避免历史密钥继续通过引擎校验
  if (!isValidIndexNowKey(key) || matched[1] !== key) notFound();

  return new Response(key, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
