// 操作日志页与「清空日志」action 共用的动作标签与筛选语义。
// 之所以单开一个模块：action 文件（"use server"）的导出只能是 async 函数，
// 常量与 where 构造放不进去；而清空范围又必须与页面筛选严格一致，否则会出现「看到的和删掉的不一样」。
import type { Prisma } from "@prisma/client";

/** 高权限动作中文标签（覆盖全站 audit 调用过的 action；未列出的回退原值） */
export const LOG_ACTION_LABELS: Record<string, string> = {
  APPROVE: "通过审核",
  REJECT: "打回",
  REMOVE_RESOURCE: "下架内容",
  RESTORE: "恢复上架",
  REPORT_RESOLVE: "处置举报",
  REPORT_DISMISS: "驳回举报",
  TRUST: "设为免审",
  UNTRUST: "取消免审",
  SET_ROLE: "修改角色",
  BAN: "封禁",
  UNBAN: "解封",
  EDIT_CATEGORY: "编辑分类",
  DELETE_CATEGORY: "删除分类",
  EDIT_TAG: "编辑标签",
  DELETE_TAG: "删除标签",
  UPDATE_RESOURCE: "修改内容",
  DELETE_MEDIA: "删除媒体",
  DELETE_MEDIA_BULK: "批量删除媒体",
  SET_ACTIVE_DRIVE: "切换活跃云盘",
  CREATE_CLOUD_DRIVE: "新建云盘",
  EDIT_CLOUD_DRIVE: "编辑云盘",
  DELETE_CLOUD_DRIVE: "删除云盘",
  TEST_CLOUD_DRIVE: "测试云盘连通",
  ADD_HOME: "新建首页板块",
  EDIT_HOME: "编辑首页板块",
  REMOVE_HOME: "删除首页板块",
  REORDER_HOME: "调整首页顺序",
  EDIT_THEME_SIDEBAR: "编辑侧栏",
  ADD_THEME_WIDGET: "新建组件",
  EDIT_THEME_WIDGET: "编辑组件",
  REMOVE_THEME_WIDGET: "删除组件",
  REORDER_THEME_WIDGET: "调整组件顺序",
  EDIT_THEME_NAV: "编辑导航",
  EDIT_THEME_DETAIL_TPL: "编辑详情页模板",
  EDIT_SEO: "编辑 SEO 配置",
  PUSH_INDEXNOW: "推送 IndexNow",
  EDIT_DOC_PAGE: "编辑文档页",
  RESET_DOC_PAGE: "文档页恢复默认",
  EDIT_UPLOAD_LIMITS: "编辑上传限制",
  RESET_UPLOAD_LIMITS: "重置上传限制",
  EDIT_RUNTIME_CONFIG: "编辑运行参数",
  DELETE_COMMENT: "删除评论",
  DELETE_AUDIT_LOG: "清空操作日志",
  // 以下两个动作在当前代码里已找不到生产者（存量数据里存在），标签仅为列表可读性保留
  CREATE_AI_TASK: "新建 AI 任务",
  FAIL_AI_TASK: "AI 任务失败",
};

export const LOG_ACTIONS = Object.keys(LOG_ACTION_LABELS);

/** 删除类动作的聚合筛选值：按动作名前缀匹配，新增删除动作不用再改这里 */
export const DELETE_FILTER = "DELETE_*";

/** 筛选值是否为日志页认得的合法动作（空串=不限） */
export function isKnownLogAction(action: string): boolean {
  return !action || action === DELETE_FILTER || LOG_ACTIONS.includes(action);
}

/** 动作筛选值 → 中文描述（备注与确认框共用） */
export function logActionText(action: string): string {
  if (!action) return "全部动作";
  if (action === DELETE_FILTER) return "删除类操作（全部）";
  return LOG_ACTION_LABELS[action] ?? action;
}

/**
 * 筛选条件 → Prisma where。
 * 页面查询与「清空日志」共用这一份，保证清空范围＝当前列表所见范围。
 */
export function logWhere(action: string, adminId: string): Prisma.AuditLogWhereInput {
  return {
    ...(action === DELETE_FILTER
      ? { action: { startsWith: "DELETE_" } }
      : LOG_ACTIONS.includes(action)
        ? { action }
        : {}),
    ...(adminId ? { adminId } : {}),
  };
}
