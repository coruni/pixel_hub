"use client";

// PV/IP 采集探针：挂在 root layout，pathname 变化（含客户端导航）时发 beacon
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export default function PageTracker() {
 const pathname = usePathname();
 const last = useRef<string | null>(null);

 useEffect(() => {
 // 后台/认证页不计入站点 PV
 if (!pathname || last.current === pathname || pathname.startsWith("/admin")) return;
 last.current = pathname;
 try {
 navigator.sendBeacon("/api/track", JSON.stringify({ path: pathname }));
 } catch {
 // 忽略：无 beacon 支持或已被浏览器节流
 }
 }, [pathname]);

 return null;
}
