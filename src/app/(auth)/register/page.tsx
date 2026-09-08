import RegisterForm from "@/components/auth/register-form";
import { emailCodeRequired } from "@/lib/register-code";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "注册" };

export default async function RegisterPage() {
  // 后台开启邮箱验证码且 SMTP 可用时，表单渲染验证码栏（否则不显示，开箱即用）
  const codeRequired = await emailCodeRequired();
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-16">
      <RegisterForm codeRequired={codeRequired} />
    </div>
  );
}
