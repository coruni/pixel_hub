import type { NextConfig } from "next";

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
};

export default nextConfig;
