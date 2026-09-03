import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { isOnline } from "@/lib/online";
import { publicUrl } from "@/lib/storage";

// 评论增量轮询端点：GET /api/comments?resourceId=...&since=<ISO>
// 返回 since 之后新增/状态变化的评论（含作者在线状态），客户端合并进列表。
// 不做全量刷新，避免打掉用户正在输入的回复框状态。

export async function GET(req: NextRequest) {
  const resourceId = req.nextUrl.searchParams.get("resourceId") ?? "";
  const sinceRaw = req.nextUrl.searchParams.get("since") ?? "";
  if (!resourceId) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const since = sinceRaw ? new Date(sinceRaw) : null;
  if (since && Number.isNaN(since.getTime())) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const comments = await prisma.comment.findMany({
    where: {
      resourceId,
      status: "PUBLIC",
      // 增量：只取 since 之后新建的（删除的由 revision 兜底，见下）
      ...(since ? { createdAt: { gt: since } } : {}),
    },
    orderBy: { createdAt: "asc" },
    include: {
      author: { select: { id: true, username: true, name: true, avatarKey: true, bio: true, role: true, trusted: true, createdAt: true } },
      media: { orderBy: { sort: "asc" }, select: { storageKey: true, width: true, height: true } },
    },
  });

  const authorIds = [...new Set(comments.map((c) => c.authorId))];
  const authorStats = authorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: authorIds } },
        select: { id: true, lastSeenAt: true, _count: { select: { resources: true, followers: true } } },
      })
    : [];
  const statsMap = new Map(authorStats.map((u) => [u.id, u]));

  // 服务端时钟给客户端做下一轮 since 基准，避免客户端时钟偏差
  const now = new Date();

  const items = comments.map((c) => {
    const s = statsMap.get(c.authorId);
    return {
      id: c.id,
      parentId: c.parentId,
      authorId: c.authorId,
      content: c.content,
      createdAt: c.createdAt,
      author: {
        username: c.author.username,
        name: c.author.name,
        avatarKey: c.author.avatarKey ? publicUrl(c.author.avatarKey) : null,
        bio: c.author.bio,
        role: c.author.role,
        trusted: c.author.trusted,
        createdAt: c.author.createdAt,
        resourceCount: s?._count.resources,
        followerCount: s?._count.followers,
        online: isOnline(s?.lastSeenAt),
      },
      images: c.media.map((m) => ({ url: publicUrl(m.storageKey), width: m.width, height: m.height })),
    };
  });

  // revision：现存公开评论的 id+updatedAt 签名（评论无 updatedAt，用全量 id 集合），
  // 客户端发现列表里多出的 id 被删除（本端不返回）时自行 router.refresh() 兜底
  const liveIds = await prisma.comment.findMany({
    where: { resourceId, status: "PUBLIC" },
    select: { id: true },
  });

  return NextResponse.json({ items, serverTime: now.toISOString(), liveIds: liveIds.map((x) => x.id) });
}
