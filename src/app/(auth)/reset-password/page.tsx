import Link from "next/link";
import type { Metadata } from "next";
import { str, type SP } from "@/lib/search-params";
import ResetPasswordForm from "@/components/auth/reset-password-form";

export const metadata: Metadata = { title: "重置密码" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const token = str(sp, "token") ?? "";

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-16">
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div className="w-full max-w-md rounded-none border border-brand-200 bg-surface p-8 text-center">
          <h1 className="text-xl font-semibold text-neutral-900">链接无效</h1>
          <p className="mt-2 text-sm text-neutral-500">
            缺少重置凭证或链接不完整，请重新发起找回。
          </p>
          <Link
            href="/forgot-password"
            className="mt-6 inline-block rounded-none border border-brand-600 bg-brand-500 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-brand-600"
          >
            重新找回
          </Link>
        </div>
      )}
    </div>
  );
}
