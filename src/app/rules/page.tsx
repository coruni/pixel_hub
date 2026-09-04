import type { Metadata } from "next";
import Link from "next/link";
import { ScrollText } from "lucide-react";

export const metadata: Metadata = { title: "社区规则" };

const SECTIONS: { title: string; items: string[] }[] = [
  {
    title: "内容红线（违者下架，情节严重封禁）",
    items: [
      "禁止上传或外链盗版、破解、脱壳类游戏资源；本站只接受免费、自制或获得授权分享的内容",
      "禁止侵犯他人著作权：转载图片必须注明来源并附授权说明，AI 生成内容必须勾选 AI 标注",
      "禁止违法、色情、暴力、政治敏感内容及任何形式的恶意软件、钓鱼链接",
      "禁止在标题、描述、标签中堆砌无关关键词刷曝光",
    ],
  },
  {
    title: "投稿与审核",
    items: [
      "投稿默认进入审核队列，通过后公开展示；被标记为「可信创作者」的账号可直发",
      "直发内容接受事后抽查，被举报后可能转入重新审核",
      "审核未通过会以通知告知原因，可修改后重新投稿",
      "外链资源请确保网盘/直链可用；链接失效会降低内容曝光",
    ],
  },
  {
    title: "社区互动",
    items: [
      "友善发言，禁止人身攻击、地域歧视与引战",
      "禁止刷评论、刷点赞、批量注册小号等行为",
      "举报是对内容红线最直接的补充：每篇内容与评论均可举报，治理动作全量留痕",
    ],
  },
  {
    title: "账号",
    items: [
      "一个邮箱一个账号；封禁后邮箱与用户名不可复用",
      "请保管好账号密码；管理员不会以任何形式索要密码",
    ],
  },
];

export default function RulesPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-none border border-brand-300 bg-surface">
          <ScrollText size={20} className="text-brand-500" aria-hidden />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">社区规则</h1>
          <p className="text-xs text-neutral-400">注册即视为同意以下规则 · 修订不另行通知</p>
        </div>
      </div>

      <div className="mt-8 space-y-8">
        {SECTIONS.map((s) => (
          <section key={s.title}>
            <h2 className="border-l-2 border-brand-500 pl-3 text-base font-semibold text-neutral-900">
              {s.title}
            </h2>
            <ul className="mt-3 grid gap-2">
              {s.items.map((it) => (
                <li key={it} className="flex gap-2 text-sm leading-6 text-neutral-700">
                  <span className="mt-2 h-1 w-1 shrink-0 bg-brand-400" aria-hidden />
                  {it}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="mt-10 border-t border-brand-200 pt-6 text-sm text-neutral-500">
        发现违规内容请使用内容页的「举报」入口。规则执行有疑问可在{" "}
        <Link href="/settings" className="text-neutral-900 underline">
          设置
        </Link>{" "}
        中联系管理员。
      </p>
    </div>
  );
}
