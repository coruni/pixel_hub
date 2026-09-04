import Link from "next/link";
import { auth } from "@/lib/auth";
import { NAV_ICON_MAP } from "@/lib/nav-icons";
import { siteName, siteLogo } from "@/lib/site-url";
import { prisma } from "@/lib/db/prisma";
import { publicUrl } from "@/lib/storage";
import { getTheme } from "@/lib/site";
import { getCategories } from "@/lib/queries";
import type { NavItem } from "@/lib/site-config";
import UserMenu from "./UserMenu";
import NavCategoriesMenu from "./NavCategoriesMenu";
import ThemeToggle from "./ThemeToggle";
import MobileNav from "./MobileNav";

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

 {/* 「分类」下拉菜单（后台可配）：按配置类型筛分类 */}
 const cm = theme.navbar.categoriesMenu;
 let catMenu = null;
 let catList: { slug: string; name: string }[] = [];
 if (cm.enabled) {
 // 分类全类型通用
 const list = await getCategories();
 if (list.length > 0) {
 catList = list.map((c) => ({ slug: c.slug, name: c.name }));
 catMenu = <NavCategoriesMenu label={cm.label} items={catList} />;
 }
 }

 // 头像取库内最新值（JWT 里不带，避免换头像后过期）；传给 client 前解析成 URL
 const me = u ? await prisma.user.findUnique({ where: { id: u.id }, select: { avatarKey: true } }) : null;
 const avatarKey = me?.avatarKey ? publicUrl(me.avatarKey) : null;

 return (
 <header className="sticky top-0 z-40 border-b border-brand-200 bg-surface">
 <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6">
 <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight text-neutral-900">
 <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-none border border-brand-600 bg-surface">
 {/* eslint-disable-next-line @next/next/no-img-element -- 站点徽标来自 env/静态 svg，不走 next/image */}
 <img src={siteLogo()} alt={siteName()} className="h-full w-full object-contain" />
 </span>
 <span>{siteName()}</span>
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
 <ThemeToggle />
 {/* 小屏汉堡菜单：导航项 + 分类直达（桌面端隐藏） */}
 <MobileNav items={items.map((it) => ({ id: it.id, label: it.label, href: it.href, newTab: it.newTab, icon: it.icon ?? "" }))} catLabel={cm.label} categories={catList} />
 {u ? (
 <UserMenu
 user={{
 name: u.name ?? null,
 username: u.username ?? "",
 role: u.role ?? "USER",
 trusted: !!u.trusted,
 avatarKey,
 }}
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
 const Icon = item.icon ? NAV_ICON_MAP[item.icon] : null;
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
