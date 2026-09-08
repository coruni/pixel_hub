import type { Metadata } from "next";
import { getDocMarkdown } from "@/lib/doc-config";
import DocPageView from "@/components/doc/DocPageView";

export const metadata: Metadata = { title: "隐私协议" };

export default async function PrivacyPage() {
  const markdown = await getDocMarkdown("privacy");
  return (
    <DocPageView
      title="隐私协议"
      subtitle="使用本站即表示您已阅读并同意本隐私政策"
      markdown={markdown}
      updatedAt={null}
    />
  );
}
