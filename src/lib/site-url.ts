// 站点公开地址（SEO/OG/sitemap/robots 用）：SITE_URL 优先，回退 AUTH_URL（NextAuth 同源部署时二者一致），
// 本地开发缺省。纯函数，client 组件亦可安全 import。
export function siteUrl(): string {
  return (process.env.SITE_URL ?? process.env.AUTH_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
}

// 站点 logo（导航徽标）：未配置时回退站点图标 src/app/icon.svg（与 favicon 同源，换一处即两处生效）
export function siteLogo(): string {
  return "/icon.svg";
}
