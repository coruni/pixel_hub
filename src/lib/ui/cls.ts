// 共享 class 常量：全站反复出现的输入框 / 导航控件 / 播放器控件样式收敛于此
// （rounded-none 直角设计语言）。
//
// 【按钮不在这里】按钮样式统一走 <Button> / <ButtonLink> 的 variant × size，
// 字典见 `src/lib/ui/button-variants.ts`。原来的 BTN_PRIMARY_SM / BTN_GHOST_SM /
// BTN_DANGER_SM / BTN_FILTER 已并入该字典，不要再在本文件新增按钮类常量——
// 否则同一套品牌实底又会被抄成两份，改一次颜色要改两处。

/** 表单输入框（全宽） */
export const INPUT =
  "w-full rounded-none border border-brand-200 bg-surface px-3 py-2 text-sm outline-none transition focus:border-brand-500";
/** 表单输入框（紧凑，后台行内编辑用） */
export const INPUT_SM =
  "rounded-none border border-brand-200 bg-surface px-2.5 py-1.5 text-sm outline-none transition focus:border-brand-500";
/** 表单 label（编辑器内强调样式） */
export const LABEL_STRONG = "mb-1 block text-xs font-medium text-neutral-500";
/** 下拉选择框（紧凑，后台筛选/合并等） */
export const SELECT_SM =
  "rounded-none border border-brand-200 bg-surface px-2 py-1.5 text-sm outline-none transition focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-400";

/** 后台列表页筛选输入框/下拉（与既有列表页统一：px-3 py-1.5 text-xs + 焦点环） */
export const INPUT_FILTER =
  "rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs outline-none transition focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-400";

/**
 * 顶部导航行内控件的统一高度：搜索框输入、主题切换、汉堡按钮、头像菜单、注册。
 * 这些控件在 64px 高的导航条里并排，各自 py-* 算出来的高度并不相等（32/34/38/40），
 * 统一改成显式高度后基线才对齐——新增导航控件请一并取这个常量。
 */
export const NAV_CONTROL_H = "h-9";
/** 顶部导航方形图标控件（需与 NAV_CONTROL_H 同高，宽度取 9 保持正方形） */
export const NAV_ICON_BTN = `grid ${NAV_CONTROL_H} w-9 place-items-center`;

/**
 * 详情页操作条的动作项（点赞/收藏/举报/编辑）。
 * 去边框、去底色，只留「图标 + 文字」；整条压成一行，靠颜色 + 文案（「点赞」↔「已赞」）表达状态，
 * 保底高度 32px（py-1.5 + text-sm）满足 WCAG 2.5.8 的 24px 触控下限。
 * 图标一律 `aria-hidden` —— 无障碍名称只由文字承担，图标不参与命名。
 *
 * 按钮请用 `<Button variant="action">`（同一份字符串），本常量只留给非按钮元素，
 * 例如详情页未登录态的 `<Link>`（那里语义是链接，不该渲染成 <button>）。
 */
export const ACTION_TEXT =
  "inline-flex items-center gap-1.5 rounded-none py-1.5 text-sm text-neutral-500 transition hover:text-neutral-900 focus-visible:underline disabled:opacity-60";

/**
 * 详情页自建音视频播放器的控件样式（av-controls.tsx 与宿主 av-player.tsx 共用：
 * 下载入口由宿主渲染、放进播放器控件位，必须与其余控件像素级一致）。
 * 盒模型与色调分开：色调按「压在黑色画面上」/「落在暖白卡片里」两套，激活态整串替换避免同属性互相覆盖。
 */
export const AV_CTRL_BTN =
  "grid h-9 w-9 shrink-0 place-items-center rounded-none transition focus-visible:ring-2 focus-visible:ring-brand-400";
export const AV_CTRL_ON_DARK = "text-white/90 hover:bg-white/15 hover:text-white";
export const AV_CTRL_ON_DARK_ACTIVE = "bg-white/20 text-white";
export const AV_CTRL_ON_SURFACE = "text-neutral-600 hover:bg-brand-50 hover:text-brand-700";
export const AV_CTRL_ON_SURFACE_ACTIVE = "bg-brand-100 text-brand-700";
