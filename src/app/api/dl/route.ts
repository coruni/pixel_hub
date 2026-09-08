import { NextRequest } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { getRuntimeConfig } from "@/lib/runtime-config";

// 下载网关：所有「本站托管的附件」（local /uploads、S3 外链、OneDrive /od 引用）统一经此处，
// 由服务端在响应里设置 Content-Disposition: attachment; filename*=UTF-8''<原名>，
// 使浏览器以「原始文件名」保存，而不是存储 key（UUID）。解决「下载时文件名不是原名」的问题。
//
// 安全：只允许本站公开目录（/uploads、/seed）、/od 网关、以及 env 中登记的 S3 / chevereto 基址；
// 其余目标一律 403，杜绝把本代理当 SSRF / 开放重定向跳板。OneDrive 走 302 到 Graph 预鉴权链接
// （Graph 自身保留原名），其余目标由本站流式转发并强制中文/UTF-8 文件名。

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPLOADS_ROOT = path.join(process.cwd(), "public", "uploads");
const SEED_ROOT = path.join(process.cwd(), "public", "seed");

// Graph / OneDrive 下载主机（其预鉴权下载 URL 已自带原始文件名，302 即可）
const GRAPH_HOSTS = [
  "graph.microsoft.com",
  "sharepoint.com",
  "windows.net",
  "blob.core.windows.net",
];

// 外链白名单基址：后台「站点配置」的 S3 / chevereto 基址（旧 env 回退），运行时动态读取
async function externalHosts(): Promise<{ s3: string[]; chevereto: string | null }> {
  const c = await getRuntimeConfig();
  const out = { s3: [] as string[], chevereto: null as string | null };
  const s3Base = c.s3PublicBase || process.env.S3_PUBLIC_BASE || c.s3Endpoint || process.env.S3_ENDPOINT;
  if (s3Base) {
    try {
      out.s3.push(new URL(s3Base).host);
    } catch {
      /* 忽略非法配置 */
    }
  }
  const chevBase = c.cheveretoBase || process.env.CHEVERETO_BASE;
  if (chevBase) {
    try {
      out.chevereto = new URL(chevBase).host;
    } catch {
      out.chevereto = null;
    }
  }
  return out;
}

/** 受控拼接本地路径：越界（路径穿越）返回 null */
function safeLocal(rest: string, root: string): string | null {
  const abs = path.resolve(root, rest);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

/** 构造 Content-Disposition：ascii 兜底 + RFC5987 UTF-8 原名（优先） */
function cdHeader(name: string, fallback: string): string {
  const raw = (name || "").trim() || fallback;
  // 去掉引号/斜杠/换行，再去掉非打印 ASCII，得到可安全放进引号的值
  let ascii = raw.replace(/["\r\n\\/]/g, "").replace(/[^\x20-\x7e]/g, "").trim();
  if (!ascii) ascii = fallback.replace(/[\\/]/g, "_");
  const enc = encodeURIComponent(raw).replace(/\(/g, "%28").replace(/\)/g, "%29");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${enc}`;
}

const MIME: Record<string, string> = {
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
  tar: "application/x-tar",
  gz: "application/gzip",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  mp4: "video/mp4",
  mp3: "audio/mpeg",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

function mimeOf(p: string): string {
  const ext = p.toLowerCase().split(".").pop() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

export async function GET(req: NextRequest) {
  const u = req.nextUrl.searchParams.get("u");
  const name = req.nextUrl.searchParams.get("n") ?? "";
  if (!u) return new Response("missing u", { status: 400 });

  const origin = req.nextUrl.origin;
  type Target =
    | { kind: "local"; abs: string; rel: string }
    | { kind: "redirect"; url: string }
    | { kind: "external"; url: string };
  let target: Target | null = null;

  try {
    const parsed = new URL(u, origin);
    const sameOrigin = parsed.host === new URL(origin).host;
    if (sameOrigin) {
      const p = parsed.pathname;
      const m = /^\/uploads\/(.+)$/.exec(p);
      if (m) {
        const abs = safeLocal(m[1], UPLOADS_ROOT);
        if (abs) target = { kind: "local", abs, rel: m[1] };
      } else {
        const s = /^\/seed\/(.+)$/.exec(p);
        if (s) {
          const abs = safeLocal(s[1], SEED_ROOT);
          if (abs) target = { kind: "local", abs, rel: s[1] };
        } else if (/^\/od(\/|$)/.test(p)) {
          target = { kind: "redirect", url: p };
        }
      }
    } else {
      const host = parsed.host.toLowerCase();
      const hosts = await externalHosts();
      if (GRAPH_HOSTS.some((h) => host === h || host.endsWith("." + h))) {
        target = { kind: "redirect", url: parsed.toString() };
      } else if (hosts.s3.includes(host) || hosts.chevereto === host) {
        target = { kind: "external", url: parsed.toString() };
      }
    }
  } catch {
    target = null;
  }

  if (!target) return new Response("forbidden", { status: 403 });

  // OneDrive：直接 302 到 Graph 预鉴权下载链接（Graph 自带原始文件名）
  if (target.kind === "redirect") {
    return new Response(null, {
      status: 302,
      headers: { Location: target.url, "Cache-Control": "private, no-store" },
    });
  }

  try {
    if (target.kind === "local") {
      let s: Awaited<ReturnType<typeof stat>>;
      try {
        s = await stat(target.abs);
      } catch {
        return new Response("not found", { status: 404 });
      }
      if (!s.isFile()) return new Response("not found", { status: 404 });
      const node = createReadStream(target.abs);
      const web = Readable.toWeb(node) as unknown as ReadableStream;
      const fallback = target.rel.split("/").pop() ?? "file";
      return new Response(web, {
        headers: {
          "Content-Disposition": cdHeader(name, fallback),
          "Content-Type": mimeOf(target.rel),
          "Content-Length": String(s.size),
          "Cache-Control": "private, max-age=300",
        },
      });
    }
    // 外链（S3 / chevereto）：流式转发并强制原始文件名（不落本地、不缓冲整文件）
    const upstream = await fetch(target.url, { redirect: "follow" });
    if (!upstream.ok || !upstream.body) return new Response("upstream error", { status: 502 });
    const fallback = decodeURIComponent(new URL(target.url).pathname.split("/").pop() ?? "file");
    return new Response(upstream.body, {
      headers: {
        "Content-Disposition": cdHeader(name, fallback),
        "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
        ...(upstream.headers.get("content-length")
          ? { "Content-Length": upstream.headers.get("content-length") as string }
          : {}),
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e) {
    console.error("[dl]", e);
    return new Response("download failed", { status: 500 });
  }
}
