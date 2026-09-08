import type { Metadata } from "next";
import { getDocMarkdown } from "@/lib/doc-config";
import DocPageView from "@/components/doc/DocPageView";

export const metadata: Metadata = { title: "社区规则" };

export default async function RulesPage() {
  const markdown = await getDocMarkdown("rules");
  return (
    <DocPageView
      title="社区规则"
      subtitle="注册即视为同意以下规则 · 修订不另行通知"
      markdown={markdown}
      updatedAt={null}
    />
  );
}
