import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { getProfile } from "@/lib/queries";
import SettingsForm from "@/components/auth/settings-form";

export const metadata: Metadata = { title: "账户设置" };

export default async function SettingsPage() {
 const session = await auth();
 if (!session?.user) redirect("/login?callbackUrl=/settings");

 const me = session.user;
 const profile = await getProfile(me.username, me.id);

 return (
 <div className="mx-auto max-w-xl px-4 py-10 sm:px-6">
 <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">账户设置</h1>
 <p className="mt-1 text-sm text-neutral-500">
 @{me.username} {me.email}
 </p>
 <div className="mt-6 rounded-none border border-brand-200 bg-surface p-6">
 <SettingsForm name={profile?.name ?? null} bio={profile?.bio ?? null} />
 </div>
 <p className="mt-4 text-xs text-neutral-400">
 更多设置（头像、密码、账号绑定）将在后续版本开放。
 </p>
 </div>
 );
}
