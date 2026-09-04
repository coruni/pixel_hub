import {
  Bell,
  Bookmark,
  Compass,
  ExternalLink,
  Home,
  Info,
  ShieldCheck,
  Tag,
  Upload,
  type LucideIcon,
} from "lucide-react";

/** 导航图标 key → lucide 图标映射（与 site-config 的 NAV_ICONS 白名单一一对应，前台与后台共用） */
export const NAV_ICON_MAP: Record<string, LucideIcon> = {
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
