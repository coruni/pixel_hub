import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/settings", "/notifications", "/upload", "/api/", "/login", "/register"],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
