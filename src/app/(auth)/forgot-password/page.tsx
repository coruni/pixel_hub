import ForgotPasswordForm from "@/components/auth/forgot-password-form";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "找回密码" };

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-16">
      <ForgotPasswordForm />
    </div>
  );
}
