// 站点内容页（社区规则 / 用户协议 / 隐私协议）——后台可编辑。
// 存储沿用 SiteSetting，value 直接存 Markdown 文本（key: doc:<page>）；未落库或为空 = 使用内置默认。
// 前台用全站 Markdown 管线（rte/Markdown + .md-body）渲染，管理员可完全自定义结构与篇幅。
import { cache } from "react";
import { prisma } from "@/lib/db/prisma";

export const DOC_KEYS = ["rules", "terms", "privacy"] as const;
export type DocKey = (typeof DOC_KEYS)[number];

export function isDocKey(v: unknown): v is DocKey {
  return typeof v === "string" && (DOC_KEYS as readonly string[]).includes(v);
}

export const DOC_PAGES: Record<
  DocKey,
  { key: `doc:${DocKey}`; title: string; subtitle: string; label: string }
> = {
  rules: {
    key: "doc:rules",
    label: "社区规则",
    title: "社区规则",
    subtitle: "注册即视为同意以下规则 · 修订不另行通知",
  },
  terms: {
    key: "doc:terms",
    label: "用户协议",
    title: "用户协议",
    subtitle: "注册并使用本站即表示您已阅读并同意本协议",
  },
  privacy: {
    key: "doc:privacy",
    label: "隐私协议",
    title: "隐私协议",
    subtitle: "使用本站即表示您已阅读并同意本隐私政策",
  },
};

export const DEFAULT_RULES_MD = `## 内容红线（违者下架，情节严重封禁）

- 禁止上传或外链盗版、破解、脱壳类游戏资源；本站只接受免费、自制或获得授权分享的内容
- 禁止侵犯他人著作权：转载图片必须注明来源并附授权说明，AI 生成内容必须勾选 AI 标注
- 禁止违法、色情、暴力、政治敏感内容及任何形式的恶意软件、钓鱼链接
- 禁止在标题、描述、标签中堆砌无关关键词刷曝光

## 投稿与审核

- 投稿默认进入审核队列，通过后公开展示；被标记为「可信创作者」的账号可直发
- 直发内容接受事后抽查，被举报后可能转入重新审核
- 审核未通过会以通知告知原因，可修改后重新投稿
- 外链资源请确保网盘/直链可用；链接失效会降低内容曝光

## 资源使用与下载

- 下载内容仅供个人学习与交流，商用请先获得原作者授权
- 禁止将站内资源二次打包分发或用于牟利
- 文章正文中的插图由创作者在编辑器内上传，与封面分开管理
- 外链资源的安全性请自行鉴别，点击前请确认来源可信

## 社区互动

- 友善发言，禁止人身攻击、地域歧视与引战
- 禁止刷评论、刷点赞、批量注册小号等行为
- 举报是对内容红线最直接的补充：每篇内容与评论均可举报，治理动作全量留痕

## 账号

- 一个邮箱一个账号；封禁后邮箱与用户名不可复用
- 请保管好账号密码；管理员不会以任何形式索要密码

## 免责声明

- 站内内容由用户上传，平台仅提供分享渠道，对内容的真实性、完整性与可用性不作担保
- 如内容侵犯您的合法权益，请通过「设置 → 联系管理员」提交权属证明，核实后将于 24 小时内下架
- 因使用站内或外链资源产生的纠纷与损失，由使用者自行承担
`;

export const DEFAULT_TERMS_MD = `## 协议的接受

- 注册、登录或以任何方式使用本站，即表示您已阅读、理解并同意本协议的全部内容
- 若您不同意本协议任何条款，请立即停止注册或使用本站

## 账号规范

- 您需提供真实有效的邮箱用于注册，并对账号下的全部行为负责
- 请妥善保管账号密码；因保管不善造成的损失由您自行承担
- 禁止出借、出租、转让账号；违规账号将被限制功能或封禁

## 内容与授权

- 您在本站发布的内容（图片、文章、游戏资源、评论等），其版权归您或原权利人所有
- 为完成展示、分发与缓存等基本功能，您授予本站对所发布内容在全球范围内的非独家、免费的使用权
- 您应确保所发布内容拥有合法权利；因侵权内容引发的纠纷与责任由您自行承担
- 本站有权依社区规则对违规内容进行下架、隐藏等处理

## 行为规范

- 不得利用本站从事任何违反法律法规的活动
- 不得以技术手段干扰、破坏本站正常运行或恶意爬取数据
- 不得批量注册账号或以自动化方式滥用站内功能

## 服务的变更与终止

- 本站有权基于运营需要调整、暂停或终止部分或全部服务，并尽可能提前公告
- 您可随时停止使用本站并可自行注销账号；协议终止后，本站仍可依法律要求保留必要数据

## 免责与责任限制

- 本站内容（含外链资源）仅供学习交流，对内容的准确性、完整性、可用性不作担保
- 对于因不可抗力、网络故障、第三方服务中断导致的服务异常，本站不承担责任
- 在法律允许的最大范围内，本站对间接损失、利润损失不承担责任

## 协议的修订

- 本站有权不时修订本协议，修订后的协议在本页面公布后生效
- 继续使用本站即视为接受修订后的协议
`;

export const DEFAULT_PRIVACY_MD = `## 我们收集的信息

- **账号信息**：注册时提供的邮箱、用户名、密码（仅以不可逆的哈希形式存储）
- **您发布的内容**：上传的图片、文章、游戏资源、评论及附件
- **访问统计**：页面访问次数与匿名化的访问来源统计，用于改进站点体验
- **头像与资料**：您主动设置的头像与个人简介

## 信息的使用

- 提供核心服务：资源展示、检索、评论、通知与账号管理
- 处理审核与举报：对违规内容与行为进行治理
- 站点统计：汇总分析访问趋势，不用于识别具体个人身份

## 信息的存储与共享

- 您上传的图片与附件会存储于站点配置的存储服务（本地磁盘、对象存储或第三方图床）
- 除以下情形外，我们不会向第三方出售或主动共享您的个人信息：
  - 获得您的明确同意
  - 为完成上传/存储等必要功能而调用第三方存储服务
  - 依据法律法规或有权机关的要求

## Cookie 与本地存储

- 本站使用 Cookie 维持登录状态，使用 localStorage 记录主题偏好
- 这些数据不用于跨站跟踪

## 您的权利

- 您可以在「设置」中随时查看、更正个人资料或更换头像
- 您可以删除自己发布的内容；账号注销后，相关数据将依法律要求处理
- 如需导出或彻底删除个人数据，请通过「设置 → 联系管理员」提出

## 信息安全

- 密码以不可逆哈希存储，任何人都无法查看原文
- 管理操作全量留痕，接受审计

## 政策的修订

- 本政策可能不时修订，修订后的版本在本页面公布后生效
- 重大变更会以站内公告等适当方式提示

## 联系我们

- 如对本政策有任何疑问，请通过「设置 → 联系管理员」与我们联系
`;

const DEFAULTS: Record<DocKey, string> = {
  rules: DEFAULT_RULES_MD,
  terms: DEFAULT_TERMS_MD,
  privacy: DEFAULT_PRIVACY_MD,
};

/** 前台读取：自定义内容为空时回退内置默认 */
export const getDocMarkdown = cache(async (page: DocKey): Promise<string> => {
  const row = await prisma.siteSetting.findUnique({ where: { key: DOC_PAGES[page].key } });
  const md = row?.value?.trim() ?? "";
  return md || DEFAULTS[page];
});

/** 后台读取：原始自定义值（区分「未自定义」与「已自定义」）+ 修改时间 */
export async function getDocWithMeta(page: DocKey): Promise<{
  initial: string;
  isCustom: boolean;
  updatedAt: Date | null;
}> {
  const row = await prisma.siteSetting.findUnique({
    where: { key: DOC_PAGES[page].key },
    select: { value: true, updatedAt: true },
  });
  const custom = row?.value?.trim() ?? "";
  return {
    initial: custom || DEFAULTS[page],
    isCustom: custom.length > 0,
    updatedAt: row?.updatedAt ?? null,
  };
}
