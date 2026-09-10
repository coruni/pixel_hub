import type { NextConfig } from "next";

// 安全响应头（H1 修复：点击劫持 / MIME 嗅探 / SSL strip / XSS 兜底）。
// 宽松档 CSP：保留 'unsafe-inline' 以兼容 themeInitScript / JSON-LD 内联脚本，
// 不破坏现有页面；frame-ancestors / object-src / base-uri 已挡住主要注入面。
// 后续演进：内联脚本迁移到 nonce 后，将 script-src 收紧为 'self' 'nonce-xxx' 并移除 unsafe-inline。
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "frame-ancestors 'self'",
      "object-src 'none'",
      "base-uri 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  experimental: {
    // 图片直传走 Server Action，需要放宽默认 1MB 限制（multipart 还有额外开销）
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
  // /search 已并入 /browse（同一 FeedBrowser 承载浏览与全文搜索），旧直达链接 301 保留兼容
  async redirects() {
    return [{ source: "/search", destination: "/browse", permanent: true }];
  },
  // 全站安全响应头（H1 修复）。source 覆盖所有路径。
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
