This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to load the bundled Fusion Pixel webfont (see `src/app/globals.css` for the fallback chain).

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## 部署（自托管）

本项目以 **Docker 自托管**方式部署，不使用 Vercel 等 serverless 平台（构建与运行方式见 `Dockerfile`）：

```bash
docker build --build-arg DATABASE_URL="postgresql://..." -t pixel_hub .
docker run -p 3000:3000 --env-file .env pixel_hub
```

自托管的两个注意点：

1. `public/uploads/`（本地存储驱动落盘处）**必须挂成卷**，否则容器重建即丢失所有上传文件。
   也可以改用 S3 / Chevereto 驱动把文件放到站外，见后台「站点配置 → 存储」。
2. 反向代理要按大文件上传放宽限制：`client_max_body_size`（配合后台的附件体积上限）
   与 `proxy_read_timeout`（GB 级上传是长连接，容易被代理先掐断）。
