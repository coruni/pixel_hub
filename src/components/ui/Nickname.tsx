import { getIncentive } from "@/lib/incentive";
import NicknameText, { type NicknameTextProps } from "./NicknameText";

export type NicknameProps = Omit<NicknameTextProps, "enabled">;

/**
 * 服务端昵称：自动读激励配置里的昵称特效色开关，再交给 NicknameText 渲染。
 *
 * 【为什么是两个组件】开关存在服务端配置里，客户端组件读不到：
 *   · 服务端渲染点 → 用这个 async 组件，调用方不必再 `await getIncentive()`，
 *     也就不会出现「忘了读配置 → 管理员关掉功能后这里还在上色」；
 *   · 客户端渲染点（评论区、用户悬浮卡）→ 用 NicknameText，把开关当 prop 传下去。
 * 反过来用会直接编译失败（客户端组件引不了本文件），正好当护栏。
 *
 * getIncentive() 走 cache()：同一次请求内无论渲染多少个昵称，都只查一次库。
 */
export default async function Nickname(props: NicknameProps) {
  const enabled = (await getIncentive()).decoration.nicknameEnabled;
  return <NicknameText {...props} enabled={enabled} />;
}
