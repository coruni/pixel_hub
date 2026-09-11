import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ensureUploadLimits, getUploadLimits } from "@/lib/upload-limits";
import UploadLimitsManager from "@/components/admin/UploadLimitsManager";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "上传限制" };

export default async function AdminUploadsPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/admin");

  // 首次进入自动落库默认上传限制，保证可编辑
  await ensureUploadLimits();
  const limits = await getUploadLimits();

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-medium text-neutral-900">上传限制</h2>
        <p className="mt-0.5 text-xs text-neutral-500">
          体积与张数上限、允许后缀、图片压缩格式与质量，即时应用到所有上传入口。仅管理员可见。
        </p>
      </div>
      <UploadLimitsManager limits={limits} />
    </div>
  );
}
