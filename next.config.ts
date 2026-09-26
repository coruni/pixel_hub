import type { NextConfig } from "next";

// 安全响应头（H1 修复：点击劫持 / MIME 嗅探 / SSL strip / XSS 兜底）。
// 宽松档 CSP：保留 'unsafe-inline' 以兼容 themeInitScript / JSON-LD 内联脚本，
// 不破坏现有页面；frame-ancestors / object-src / base-uri 已挡住主要注入面。
// 后续演进：内联脚本迁移到 nonce 后，将 script-src 收紧为 'self' 'nonce-xxx' 并移除 unsafe-inline。
//
// dev 额外放行 'unsafe-eval'：React 开发版（含 Turbopack HMR 调试栈还原）依赖 eval()，
// CSP 不含 unsafe-eval 时 React 会在客户端报错并**跳过水合**，表现为整个站点不可交互（点不动）。
// 生产构建不使用 eval，故仅在非 production 下追加，正式环境策略不变。
const isDev = process.env.NODE_ENV !== "production";

// 跨站加载白名单（音视频挂载 / 嵌入页 / 云盘直传）。
//
// media-src 与 frame-src 必须显式声明，否则回落到 default-src 'self'：
//   - 挂载在线的 mp3/mp4 → "Loading media … violates default-src 'self'"（播不了）
//   - B站 / 网易云 / YouTube 等嵌入页 → "Framing … violates default-src 'self'"（白屏）
// 本站允许作者挂载任意在线音视频与嵌入播放页（见 src/lib/av.ts 的 mount/embed 两形态），
// 因此这两个指令与既有的 img-src 取同一口径：放行任意 https 源，只挡 http 明文与非 https://data: 之类。
//
// blob: 供本地预览：发布向导读取本地文件时长/分辨率（av-probe 的 objectURL 会挂到
// <audio>/<video> 上）、头像与封面的裁剪预览。CSP 的 'self' 不匹配 blob: scheme，必须显式写。
const MEDIA_SRC = ["'self'", "https:", "blob:"];
const FRAME_SRC = ["'self'", "https:"];
const IMG_SRC = ["'self'", "data:", "blob:", "https:"];

// OneDrive 附件/音视频由浏览器直传 Graph（分片 PUT 预授权地址），不经过本站，
// 因此 connect-src 必须放行这些域，否则大文件上传在 fetch 阶段就被 CSP 拦掉。
// 后台「站点配置」里 graphEndpoint 可改（世纪互联等主权云走 sharepoint.cn / chinacloudapi.cn），
// 故按域而非单主机放行；其他自建云端可加 CSP_CONNECT_EXTRA（空格分隔的源）追加。
const CLOUD_UPLOAD_ORIGINS = [
  "https://graph.microsoft.com",
  "https://*.sharepoint.com",
  "https://*.sharepoint.cn",
  "https://*.1drv.com",
  "https://*.livefilestore.com",
  "https://api.onedrive.com",
  "https://*.chinacloudapi.cn",
];

const extraConnect = (process.env.CSP_CONNECT_EXTRA ?? "")
  .trim()
  .split(/\s+/)
  .filter(Boolean);

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
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      `img-src ${IMG_SRC.join(" ")}`,
      `media-src ${MEDIA_SRC.join(" ")}`,
      `frame-src ${FRAME_SRC.join(" ")}`,
      "font-src 'self' data:",
      `connect-src ${["'self'", ...CLOUD_UPLOAD_ORIGINS, ...extraConnect].join(" ")}`,
      "frame-ancestors 'self'",
      "object-src 'none'",
      "base-uri 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // fontkit 是纯 JS 字体解析库（水印取字形轮廓用）：它的 ESM 产物没有 default 导出，
  // 交给打包器按运行时条件挑文件容易踩 interop（Turbopack 实测报 "Export default doesn't exist"），
  // 而且也没必要把整个字体库塞进服务端 bundle。标成外部包 → 运行时按 Node 规则 require，
  // node_modules 随镜像一起交付（见 Dockerfile 的 COPY node_modules）。
  serverExternalPackages: ["fontkit"],
  experimental: {
    // 图片直传走 Server Action，需要放宽默认 1MB 限制（multipart 还有额外开销）
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
  // /search 已并入 /browse（同一 FeedBrowser 承载浏览与全文搜索），旧直达链接 301 保留兼容
  // /sponsor、/sponsors 已并入 /fund 的资金池公示页（「钱去哪了」与「我要给钱」必须同屏），
  // 页脚入口、二维码与历史外链不能失效 —— 用 301 永久跳转到对应锚点。
  async redirects() {
    return [
      { source: "/search", destination: "/browse", permanent: true },
      { source: "/sponsor", destination: "/fund#sponsor", permanent: true },
      { source: "/sponsors", destination: "/fund#thanks", permanent: true },
    ];
  },
  // 全站安全响应头（H1 修复）。source 覆盖所有路径。
  //
  // 静态资源缓存头**必须单独声明**：上面的 `/:path*` 规则会先命中，而它只带安全头、
  // 没有 Cache-Control —— 结果是 `public/uploads` 与 `public/covers` 下的封面/缩略图
  // 全部走 Next 默认的 `public, max-age=0`，每次访问（含返回首页、翻页、滚动重挂）
  // 都要发一次条件请求回源。图片是首页最大的字节来源，这一项直接决定二次访问的体感。
  //
  // 注意 Next 的 headers() 是「多条规则累加」而不是覆盖：同一条路径同时命中
  // 安全头规则与下面的缓存规则时，两者会合并成同一组响应头，不需要在安全头里重复写。
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // 上传产物（封面 original/big/thumb）与内置封面：内容按 key 寻址、key 永不复用，
        // 因此可以 immutable 长缓存 —— 改图必然换 key、换 key 必然是新的 URL。
        // 1 年是惯例上限；max-age 与 s-maxage 同值，CDN 与浏览器一致。
        // 若将来出现「同 key 覆写」（例如原地重压），必须先把这里降回 max-age=0+ETag。
        source: "/uploads/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, s-maxage=31536000, immutable",
          },
        ],
      },
      {
        source: "/covers/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, s-maxage=31536000, immutable",
          },
        ],
      },
      {
        // seed 素材是随仓库发布的演示内容，同样按文件名寻址；但它是「可能被替换」的资产
        // （重新生成 seed 会覆盖同名文件），所以不给 immutable，只给 30 天缓存 + 允许重验证。
        source: "/seed/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=2592000" }],
      },
      {
        // 字体：woff2 文件名带内容特征、且由 globals.css 引用，长缓存安全。
        source: "/fonts/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, s-maxage=31536000, immutable",
          },
        ],
      },
      {
        // Next 自己的构建产物：文件名含内容哈希，官方推荐就是 immutable。
        // public 目录下的静态文件不在此规则内（见上），但 _next/static 需要显式声明，
        // 否则在自定义服务器（server.js）下同样会退化成 max-age=0。
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
