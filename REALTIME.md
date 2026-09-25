# Pixel Hub WebSocket 实时通道

## 已接入

- **站内通知**：新通知、标记已读、删除、清空会推送到当前用户的私有连接；导航未读角标实时校正，通知页实时刷新。
- **资源详情页评论**：新评论通过 WebSocket 触发客户端立即拉取增量；删除/评论树结构变化触发全量刷新；保留低频轮询作为丢包与代理不支持 WebSocket 时的兜底。
- **在线状态**：连接建立/最后一个连接断开广播上下线；评论头像、资源作者、个人主页、创作者排行与侧栏作者头像接收实时在线状态。`/api/presence` 心跳仍保留，为 SSR 首屏和无 WebSocket 环境提供时间戳兜底。

## 运行方式

实时通道需要通过自定义 Node 服务器启动：

```bash
npm run dev       # node server.js，开发模式，WebSocket + Next HMR
npm run start     # node server.js --prod，生产模式
```

如果直接使用 `npm run dev:next` 或 `npm run start:next`，站点仍可运行，但会自动降级为原有 HTTP 轮询；这两个脚本仅用于排查 Next 本身问题。

生产部署仍使用 `npm run start`，Dockerfile 已把 `server.js` 与 `server/` 一起复制进运行镜像。反向代理必须允许 `Upgrade` / `Connection: upgrade` 转发 `/api/ws`。

## 设计约束

WebSocket 只传递事件信号，不直接推送评论正文或通知内容：评论与未读数继续由已有 HTTP 接口提供唯一事实来源。这样既避免重复鉴权/序列化逻辑，也能在实时通道断开时安全降级。
