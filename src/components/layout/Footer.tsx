import Link from "next/link";

// 全站页脚（Server Component）：单行简洁样式。文档链接 + 站名 + 自定义文案（后台 SEO 配置，
// 留空不显示）+ 备案号/联系邮箱（后台配置，未设置自动隐藏）。
const FOOTER_LINKS = [
  { href: "/rules", label: "社区规则" },
  { href: "/terms", label: "用户协议" },
  { href: "/privacy", label: "隐私协议" },
];

export default function Footer({
  name,
  footerText,
  icp,
  contactEmail,
}: {
  name: string;
  footerText: string;
  icp: string;
  contactEmail: string;
}) {
  return (
    <footer className="mt-10 border-t border-brand-200 py-8 text-center text-xs text-neutral-400">
      <p>
        {FOOTER_LINKS.map((l, i) => (
          <span key={l.href}>
            {i > 0 && <span className="mx-2">·</span>}
            <Link href={l.href} className="transition hover:text-neutral-900">
              {l.label}
            </Link>
          </span>
        ))}
        <span className="mx-2">·</span>
        {name}
        {footerText ? ` · ${footerText}` : ""}
      </p>
      {(icp || contactEmail) && (
        <p className="mt-2">
          {contactEmail && (
            <>
              © {new Date().getFullYear()} {name} ·{" "}
              <a href={`mailto:${contactEmail}`} className="transition hover:text-neutral-900">
                联系我们
              </a>
            </>
          )}
          {contactEmail && icp && <span className="mx-2">·</span>}
          {icp && (
            <a
              href="https://beian.miit.gov.cn/"
              target="_blank"
              rel="noopener noreferrer"
              className="transition hover:text-neutral-900"
            >
              {icp}
            </a>
          )}
        </p>
      )}
    </footer>
  );
}
