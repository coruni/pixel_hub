import Link from "next/link";
import {
 Bell,
 Bookmark,
 Compass,
 ExternalLink,
 Gamepad2,
 Home,
 Info,
 ShieldCheck,
 Tag,
 Upload,
 type LucideIcon,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { getTheme } from "@/lib/site";
import { getCategories } from "@/lib/queries";
import type { NavItem } from "@/lib/site-config";
import UserMenu from "./UserMenu";
import NavCategoriesMenu from "./NavCategoriesMenu";

// 导航图标白名单（与 site-config 的 NAV_ICONS 对应）
const ICONS: Record<string, LucideIcon> = {
 home: Home,
 compass: Compass,
 upload: Upload,
 bell: Bell,
 shield: ShieldCheck,
 tag: Tag,
 bookmark: Bookmark,
 external: ExternalLink,
 info: Info,
};

const navBtn = "inline-flex items-center gap-1.5 transition hover:text-neutral-900";
const iconSize = 15;

export default async function Navbar() {
 const session = await auth();
 const u = session?.user;
 const isStaff = u?.role === "ADMIN" || u?.role === "MODERATOR";
 const theme = await getTheme();

 const items = theme.navbar.items.filter((it) => {
 if (!it.enabled) return false;
 switch (it.showTo) {
 case "guest":
 return !u;
 case "user":
 return !!u;
 case "staff":
 return isStaff;
 default:
 return true;
 }
 });

 // 「分类」下拉菜单（后台可配）：按配置类型筛分类
 const cm = theme.navbar.categoriesMenu;
 let catMenu = null;
 if (cm.enabled) {
 // 分类全类型通用
 const list = await getCategories();
 if (list.length > 0) {
 catMenu = <NavCategoriesMenu label={cm.label} items={list.map((c) => ({ slug: c.slug, name: c.name }))} />;
 }
 }

 return (
 <header className="sticky top-0 z-40 border-b border-brand-200 bg-surface">
 <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6">
 <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight text-neutral-900">
 <span className="grid h-8 w-8 place-items-center rounded-none border border-brand-600 bg-brand-500 text-white">
 <Gamepad2 size={18} />
 </span>
 <span>资源社区</span>
 </Link>

 {(items.length > 0 || catMenu) && (
 <nav className="hidden items-center gap-5 text-sm text-neutral-600 sm:flex">
 {items.map((it) => (
 <NavLink key={it.id} item={it} />
 ))}
 {catMenu}
 </nav>
 )}

 <div className="ml-auto flex items-center gap-3">
 {u ? (
 <UserMenu
 user={{ name: u.name ?? null, username: u.username ?? "", role: u.role ?? "USER", trusted: !!u.trusted }}
 />
 ) : (
 <>
 <Link href="/login" className="text-sm text-neutral-600 hover:text-neutral-900">登录</Link>
 <Link
 href="/register"
 className="rounded-none border border-brand-600 bg-brand-500 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-brand-600"
 >
 注册
 </Link>
 </>
 )}
 </div>
 </div>
 </header>
 );
}

function NavLink({ item }: { item: NavItem }) {
 const Icon = item.icon ? ICONS[item.icon] : null;
 return (
 <Link
 href={item.href}
 target={item.newTab ? "_blank" : undefined}
 rel={item.newTab ? "noopener noreferrer" : undefined}
 className={navBtn}
 >
 {Icon && <Icon size={iconSize} />}
 {item.label}
 </Link>
 );
}
