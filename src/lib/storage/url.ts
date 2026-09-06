// 纯函数 URL 解析（无 node 依赖，client 组件可安全 import）。
// local: /uploads/<key>（local 驱动根目录是 public/uploads）；seed 静态素材: /<key>；
// s3: 用 S3_PUBLIC_BASE（或 endpoint/bucket）拼接；已是 URL 原样返回。
// 幂等：库中可能存相对 key（avatars/…）、旧格式（/avatars/…）或完整站内 URL（/uploads/avatars/…），
// 统一归一到 /uploads/<key>。
export function isUrl(key: string): boolean {
  return /^https?:\/\//i.test(key);
}

export function publicUrl(key: string): string {
  // 浏览器本地预览（blob:）与 data URI 原样返回
  if (isUrl(key) || /^(blob:|data:)/i.test(key)) return key;
  // /od 云附件引用已可直接访问（经 /od/[driveId]/[…key] 网关 307 到 MS 预鉴权下载 URL）——
  // 幂等返回，须在 s3 拼接分支之前，避免被篡成 ${S3_BASE}/od/… 或 /uploads/od/…
  if (/^\/?od\//i.test(key)) return "/" + key.replace(/\\/g, "/").replace(/^\/+/, "");
  if (process.env.STORAGE_DRIVER === "s3") {
    const base = (
      process.env.S3_PUBLIC_BASE ?? `${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET ?? ""}`
    ).replace(/\/$/, "");
    return `${base}/${key}`;
  }
  const k = key.replace(/\\/g, "/").replace(/^\/+/, "");
  // seed 素材直接放 public/seed 下，不经上传层
  if (k.startsWith("seed/")) return "/" + k;
  // 已是完整站内 URL（saveFile 现返回 /uploads/<key>）——幂等返回
  if (k.startsWith("uploads/")) return "/" + k;
  // local（client 端 env 缺省也走这里：传进来的应是 server 已解析的 URL 或本地 key）
  return "/uploads/" + k;
}
