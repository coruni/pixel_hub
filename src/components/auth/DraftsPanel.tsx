import Link from "next/link";
import {
  Film,
  Gamepad2,
  Image as ImageIcon,
  Music,
  Newspaper,
  Pencil,
  type LucideIcon,
} from "lucide-react";
import { listDrafts, type DraftRow } from "@/lib/draft-store";
import { draftReadyHint, draftTimeText, type DraftType } from "@/lib/draft";
import { TYPE_LABEL } from "@/lib/display";
import { DraftDelete, DraftsClearAll } from "@/components/upload/draft-actions";

/**
 * 草稿箱（账户设置 · 发布分组内）。
 *
 * 原先是独立的 /drafts 页面，入口藏在用户下拉菜单里；草稿开关与草稿列表是同一件事，
 * 现在并到设置页同一屏，改开关时顺手就能看到草稿。旧链接由 /drafts 重定向兜底。
 *
 * 服务端组件：草稿按 ownerId 读取（草稿是私密数据，会话 userId 为准），
 * 删除/清空是客户端组件里的小按钮（带确认弹窗 + router.refresh 刷新本列表）。
 */

const TYPE_ICON: Record<DraftType, LucideIcon> = {
  IMAGE: ImageIcon,
  GAME: Gamepad2,
  ARTICLE: Newspaper,
  MUSIC: Music,
  VIDEO: Film,
};

export default async function DraftsPanel({ userId }: { userId: string }) {
  const drafts = await listDrafts(userId);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs tabular-nums text-neutral-400">
          共 {drafts.length} 条 · 发布成功后对应草稿自动清除
        </p>
        {drafts.length > 0 && <DraftsClearAll />}
      </div>

      <ul className="mt-3 space-y-2">
        {drafts.map((dr: DraftRow) => {
          const Icon = TYPE_ICON[dr.type] ?? ImageIcon;
          const hint = draftReadyHint(dr.payload);
          const title = dr.payload.title.trim() || "未命名草稿";
          return (
            <li
              key={dr.id}
              className="flex items-center gap-2.5 rounded-none border border-brand-200 bg-surface px-3 py-2.5 transition hover:border-brand-500"
            >
              {/* 方块图标底：与首页分类块的像素方块同一语言 */}
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-none border border-brand-200 bg-brand-50 text-brand-600">
                <Icon size={15} aria-hidden />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <Link
                    href={`/upload?draft=${dr.id}`}
                    className="min-w-0 truncate text-sm font-medium text-neutral-800 hover:underline"
                  >
                    {title}
                  </Link>
                  <span className="shrink-0 rounded-none border border-brand-200 px-1.5 py-0.5 text-[10px] text-neutral-500">
                    {TYPE_LABEL[dr.type] ?? dr.type}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-neutral-400">
                  {draftTimeText(dr.updatedAt.toISOString())} 保存
                  {dr.payload.media.length > 0 && ` · ${dr.payload.media.length} 张图`}
                  <span aria-hidden> · </span>
                  {hint ? (
                    <span className="text-amber-700">{hint}</span>
                  ) : (
                    <span className="text-emerald-600">可发布</span>
                  )}
                </p>
              </div>

              <Link
                href={`/upload?draft=${dr.id}`}
                className="inline-flex shrink-0 items-center gap-1 rounded-none border border-brand-200 px-2 py-1 text-[11px] text-neutral-600 transition hover:border-brand-500 hover:text-neutral-900"
              >
                <Pencil size={11} aria-hidden />
                <span className="hidden sm:inline">继续编辑</span>
              </Link>
              <DraftDelete id={dr.id} />
            </li>
          );
        })}

        {drafts.length === 0 && (
          <li className="rounded-none border border-dashed border-brand-200 py-10 text-center text-xs text-neutral-400">
            还没有草稿，去
            <Link href="/upload" className="mx-1 text-neutral-600 underline">
              发布内容
            </Link>
            写点什么吧
          </li>
        )}
      </ul>
    </div>
  );
}
