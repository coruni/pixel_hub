// 举报治理的共享常量 —— 纯数据模块（无 "use server"），
// 服务端 action（src/lib/actions/report.ts）与客户端举报下拉（ReportButton）共用。
// 注意：不能放进 "use server" 文件 —— 该文件的所有导出都被当作 server action（仅 async 函数），
// 常量跨模块边界会被 Turbopack 代理成非真数组，导致客户端 REASONS.map 报错。

export const REASONS = [
  "侵权/盗版",
  "违规内容",
  "垃圾广告",
  "信息不实",
  "其他",
] as const;

// 同一资源累计 OPEN 举报达到该阈值才自动转 PENDING 复查（6.4 治理）：
// 首条/少数举报只进后台加权置顶，防止单个恶意举报直接隐藏内容，也保证多报可以累积。
export const REPORT_AUTO_HIDE_AT = 3;
