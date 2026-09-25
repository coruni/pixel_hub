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
# 时区必须与结算归属月一致：periodRange()/monthKey() 都按**本机日历月**算窗口
# （见 settle-allocate.ts 与 format.ts），容器默认 UTC 会让窗口边界整体错 8 小时。
ENV TZ=Asia/Shanghai
RUN npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production
# tzdata 必须显式装：slim 镜像里没有 /usr/share/zoneinfo，缺它时 TZ 只是个无效环境变量。
# 结算归属月、自动结算的「每日尝试时点」全按本机时区判定，装错会让「次月 1 日」在
# UTC 下对应到北京时间当天 08:00，8 月最后一晚的贡献分被算进 9 月。
#
# 字体（fontconfig + 中文字体）只服务于**水印的兜底路径**：水印文字正常由站点字体
# （public/fonts/*.woff2，与前台同源）解析成 SVG 轮廓，与运行环境无关；只有当用户输入的
# 文字里含站点字体覆盖不到的字符（emoji、罕用字…）时，才会退到 librsvg 渲染 SVG <text>、
# 走 fontconfig 找字族。slim 镜像里一个字体都没有，此时 librsvg **不报错、只输出空白**，
# 表现为「开关打开了但图上什么都没有」，日志里看不出异常 —— 所以这套字体仍然要装。
# 判定与降级见 src/lib/media/watermark.ts 的 watermarkAvailable()。
RUN apt-get update \
  && apt-get install -y --no-install-recommends tzdata fontconfig fonts-noto-cjk \
  && fc-cache -f \
  && rm -rf /var/lib/apt/lists/*
ENV TZ=Asia/Shanghai
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
# 自定义服务器（实时 WebSocket 通道）：npm start 跑的是 node server.js，
# 它不经过 Next 编译器，必须原样进镜像；server/ 是配套的纯 JS 实时总线。
COPY --from=build /app/server.js ./server.js
COPY --from=build /app/server ./server
EXPOSE 3000
CMD ["npm", "run", "start"]
