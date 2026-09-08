import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth";
import { countDriveRefs, graphEnabled } from "@/lib/storage/onedrive";
import { DriveManager } from "@/components/admin/DriveManager";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "云盘" };

export default async function DrivesAdminPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/admin");

  const drives = await prisma.cloudDrive.findMany({
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
  });
  const rows = await Promise.all(
    drives.map(async (d) => ({
      id: d.id,
      label: d.label,
      locator: d.locator,
      rootPath: d.rootPath,
      active: d.active,
      enabled: d.enabled,
      lastError: d.lastError,
      lastOkAt: d.lastOkAt ? d.lastOkAt.toISOString() : null,
      refs: await countDriveRefs(d.id),
    })),
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium text-neutral-900">附件云盘</h2>
        <p className="mt-0.5 text-xs text-neutral-500">
          登记 OneDrive / SharePoint 驱动器；大附件写入<b>活跃盘</b>，切活跃不影响历史下载。
        </p>
      </div>
      <DriveManager rows={rows} credsConfigured={await graphEnabled()} />
    </div>
  );
}
