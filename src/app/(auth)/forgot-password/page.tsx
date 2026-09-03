import ForgotPasswordForm from "@/components/auth/forgot-password-form";

export const metadata = { title: "找回密码" };

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-16">
      <ForgotPasswordForm />
    </div>
  );
}
