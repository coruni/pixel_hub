import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // 图片直传走 Server Action，需要放宽默认 1MB 限制（multipart 还有额外开销）
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
