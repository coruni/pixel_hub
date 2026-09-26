import Link from "next/link";
import { auth } from "@/lib/auth";
import { NAV_ICON_MAP } from "@/lib/nav-icons";
import { siteLogo } from "@/lib/site-url";
import { getSeoConfig, resolveSiteName } from "@/lib/seo-config";
import { prisma } from "@/lib/db/prisma";
import { publicUrl } from "@/lib/storage";
import { getTheme } from "@/lib/site";
import { getCategories } from "@/lib/queries";
import { getIncentive } from "@/lib/incentive";
import { getUnreadNotificationCount } from "@/lib/notify";
import type { NavItem } from "@/lib/site-config";
import { NAV_CONTROL_H } from "@/lib/ui/cls";
import UserMenu from "./UserMenu";
import NavCategoriesMenu from "./NavCategoriesMenu";
import MobileNav from "./MobileNav";
import SearchBox from "./SearchBox";

const navBtn = "inline-flex items-center gap-1.5 transition hover:text-neutral-900";
const iconSize = 15;

export default async function Navbar() {
  const [session, seo] = await Promise.all([auth(), getSeoConfig()]);
  const name = resolveSiteName(seo);
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

  {
    /* 「分类」下拉菜单（后台可配）：按配置类型筛分类 */
  }
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

  // 头像与昵称色都取库内最新值（JWT 里不带，避免改完设置后导航栏仍显示旧值）；
  // 头像传给 client 前解析成 URL。未读数与它并行取：导航栏每个页面都要渲染，
  // 多一次 count 换掉角标「必须刷新才更新」。
  const [me, unread] = u
    ? await Promise.all([
        prisma.user.findUnique({
          where: { id: u.id },
          select: { avatarKey: true, nameColor: true },
        }),
        getUnreadNotificationCount(u.id),
      ])
    : [null, 0];
  const avatarKey = me?.avatarKey ? publicUrl(me.avatarKey) : null;

  // 「我的代币」入口只在激励体系开启时出现 —— 关掉激励后留一个只有 0 余额的死链更糟。
  // 昵称特效色开关与它同源，一次取出。getIncentive 是 cache() 过的，页面里别处读过就不会再查库。
  // 访客不读（保持原样）：不给未登录页面平白多一次查询。
  const incentive = u ? await getIncentive() : null;
  const showCoins = incentive?.enabled ?? false;
  const nicknameEnabled = incentive?.decoration.nicknameEnabled ?? true;

  return (
    <header className="sticky top-0 z-40 border-b border-brand-200 bg-surface">
      {/* 窄屏收缩策略：logo 可截断不折行、右侧控件不压扁、间距压缩，320px 仍单行 */}
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:gap-6 sm:px-6">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-2 text-base font-semibold tracking-tight text-neutral-900 max-[359px]:text-sm sm:text-lg"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-none border border-brand-600 bg-surface">
            {/* eslint-disable-next-line @next/next/no-img-element -- 站点徽标来自后台配置/静态 svg，不走 next/image */}
            <img src={seo.siteLogo || siteLogo()} alt={name} className="h-full w-full object-contain" />
          </span>
          <span className="truncate">{name}</span>
        </Link>

        {(items.length > 0 || catMenu) && (
          <nav className="hidden items-center gap-5 text-sm text-neutral-600 sm:flex">
            {items.map((it) => (
              <NavLink key={it.id} item={it} />
            ))}
            {catMenu}
          </nav>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          {/* 站内搜索（全文检索）：≥sm 行内显示；窄屏在汉堡抽屉顶部提供 */}
          <SearchBox className="hidden w-40 sm:block lg:w-52" placeholder="搜索资源…" />
          {/* 明暗切换已移入「账户设置 → 外观」：配色是低频偏好，且要跟账号走（游客跟随浏览器） */}
          {/* 小屏汉堡菜单：导航项 + 分类直达（桌面端隐藏） */}
          <MobileNav
            items={items.map((it) => ({
              id: it.id,
              label: it.label,
              href: it.href,
              newTab: it.newTab,
              icon: it.icon ?? "",
            }))}
            catLabel={cm.label}
            categories={catList}
          />
          {u ? (
            <UserMenu
              unread={unread}
              showCoins={showCoins}
              nicknameEnabled={nicknameEnabled}
              user={{
                name: u.name ?? null,
                username: u.username ?? "",
                role: u.role ?? "USER",
                trusted: !!u.trusted,
                avatarKey,
                nameColor: me?.nameColor ?? null,
              }}
            />
          ) : (
            <>
              <Link
                href="/login"
                className={`${NAV_CONTROL_H} inline-flex items-center whitespace-nowrap text-sm text-neutral-600 hover:text-neutral-900`}
              >
                登录
              </Link>
              <Link
                href="/register"
                className={`${NAV_CONTROL_H} inline-flex items-center whitespace-nowrap rounded-none border border-brand-600 bg-brand-500 px-3 text-sm font-medium text-white transition hover:bg-brand-600 sm:px-4`}
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
