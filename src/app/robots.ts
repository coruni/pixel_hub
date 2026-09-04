import type { MetadataRoute } from "next";
import { PROTECTED_PREFIXES } from "@/lib/auth.config";
import { siteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // 登录态页面与后台不收录；PROTECTED_PREFIXES 与 proxy 门控共用一份清单
      disallow: [
        ...PROTECTED_PREFIXES,
        "/api/",
        "/login",
        "/register",
        "/forgot-password",
        "/reset-password",
      ],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
