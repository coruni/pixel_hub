// 方块头像：有 avatarKey 用图（方角 + 1px brand 描边），否则首字母方块占位。全站统一。
// avatarKey 可以是本站存储 key 或完整 URL；仅依赖纯函数 url 模块，client 组件可安全使用。
import { publicUrl } from "@/lib/storage/url";

const SIZES = {
 xs: "h-7 w-7 text-[11px]",
 sm: "h-8 w-8 text-xs",
 md: "h-10 w-10 text-sm",
 lg: "h-20 w-20 text-2xl",
} as const;

export default function Avatar({
 name,
 username,
 avatarKey,
 size = "sm",
}: {
 name?: string | null;
 username: string;
 avatarKey?: string | null;
 size?: keyof typeof SIZES;
}) {
 const label = (name ?? username).slice(0, 1).toUpperCase();
 if (avatarKey) {
  return (
  // eslint-disable-next-line @next/next/no-img-element
  <img
   src={publicUrl(avatarKey)}
   alt={name ?? username}
   className={`shrink-0 rounded-none border border-brand-600 object-cover ${SIZES[size]}`}
  />
  );
 }
 return (
 <span
  className={`grid shrink-0 place-items-center rounded-none border border-brand-600 bg-brand-500 font-semibold text-white ${SIZES[size]}`}
 >
  {label}
 </span>
 );
}
