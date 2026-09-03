import LoginForm from "@/components/auth/login-form";

export const metadata = { title: "登录" };

type SP = Record<string, string | string[] | undefined>;
export default async function LoginPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const raw = typeof sp.callbackUrl === "string" ? sp.callbackUrl : "/";
  const callbackUrl = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
  const githubEnabled = Boolean(process.env.GITHUB_ID && process.env.GITHUB_SECRET);
  const resetDone = sp.reset === "1";
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        {resetDone && (
          <p className="mb-4 rounded-none bg-brand-50 px-3 py-2 text-sm text-neutral-700">
            密码已重置，请用新密码登录。
          </p>
        )}
        <LoginForm githubEnabled={githubEnabled} callbackUrl={callbackUrl} />
      </div>
    </div>
  );
}
