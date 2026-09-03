import RegisterForm from "@/components/auth/register-form";

export const metadata = { title: "注册 · 资源社区" };

export default function RegisterPage() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-16">
      <RegisterForm />
    </div>
  );
}
