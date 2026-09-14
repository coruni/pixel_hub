# pixel_hub —— Next.js App Router + Prisma
#
# 构建：docker build --build-arg DATABASE_URL="postgresql://..." -t pixel_hub .
# 运行：docker run -p 3000:3000 --env-file .env pixel_hub
#
# 两个必须注意的点：
# 1. next build 会预渲染 /sitemap.xml 等查库路由，构建阶段必须能连上数据库，
#    否则会在预渲染阶段失败（那是网络/凭据问题，不是本文件的行为）。
# 2. 执行脚本一律用 `npm run`，绝不能写成 `npx run` —— npx 会把 run 当作包名
#    去 registry 下载（run@2.1.4 没有 bin 字段），报
#    "could not determine executable to run"，与项目代码无关。

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 构建期也需要 DATABASE_URL（预渲染查库）；仅存在于构建阶段，不会进入最终镜像
ARG DATABASE_URL
ENV DATABASE_URL=$DATABASE_URL
RUN npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
EXPOSE 3000
CMD ["npm", "run", "start"]
