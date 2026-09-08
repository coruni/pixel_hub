import type { Metadata } from "next";
import { getDocMarkdown } from "@/lib/doc-config";
import DocPageView from "@/components/doc/DocPageView";

export const metadata: Metadata = { title: "用户协议" };

export default async function TermsPage() {
  const markdown = await getDocMarkdown("terms");
  return (
    <DocPageView
      title="用户协议"
      subtitle="注册并使用本站即表示您已阅读并同意本协议"
      markdown={markdown}
      updatedAt={null}
    />
  );
}
