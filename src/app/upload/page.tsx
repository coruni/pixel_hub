import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { getCategories } from "@/lib/queries";
import UploadWizard from "@/components/upload/UploadWizard";

export const metadata: Metadata = { title: "发布资源", robots: { index: false } };

export default async function UploadPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/upload");

  const categories = await getCategories();
  return <UploadWizard categories={categories.map((c) => ({ id: c.id, name: c.name }))} />;
}
