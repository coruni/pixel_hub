// 站点公开地址（SEO/OG/sitemap/robots 用）：SITE_URL 优先，回退 AUTH_URL（NextAuth 同源部署时二者一致），
// 本地开发缺省。纯函数，client 组件亦可安全 import。
export function siteUrl(): string {
  return (process.env.SITE_URL ?? process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

// 站点名称（导航 logo / <title> / OG siteName / 页脚）。NEXT_PUBLIC_ 前缀使 client 组件同名可用。
export function siteName(): string {
  return process.env.NEXT_PUBLIC_SITE_NAME?.trim() || "资源社区";
}

// 站点 logo（导航徽标）：未配置时回退站点图标 src/app/icon.svg（与 favicon 同源，换一处即两处生效）
export function siteLogo(): string {
  return process.env.NEXT_PUBLIC_SITE_LOGO?.trim() || "/icon.svg";
}

