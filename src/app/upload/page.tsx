import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { getCategories } from "@/lib/queries";
import { getUploadLimits } from "@/lib/upload-limits";
import { autoSaveEnabled, countDrafts, getDraft } from "@/lib/draft-store";
import UploadWizard from "@/components/upload/UploadWizard";

export const metadata: Metadata = { title: "发布资源", robots: { index: false } };

export default async function UploadPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/upload");

  const draftParam = (await searchParams).draft ?? "";
  const [categories, limits, autoSave, draftCount, draft] = await Promise.all([
    getCategories(),
    getUploadLimits(),
    autoSaveEnabled(session.user.id),
    countDrafts(session.user.id),
    getDraft(session.user.id, draftParam),
  ]);

  return (
    <UploadWizard
      // 按草稿 id 重挂载：切换恢复的草稿时，非受控输入需要重新按新 defaultValue 初始化
      key={draft?.id ?? "new"}
      categories={categories.map((c) => ({ id: c.id, name: c.name }))}
      limits={limits}
      autoSave={autoSave}
      draftCount={draftCount}
      initialDraft={
        draft ? { id: draft.id, payload: draft.payload, updatedAt: draft.updatedAt.toISOString() } : null
      }
    />
  );
}
