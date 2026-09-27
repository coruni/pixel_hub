import type { Prisma } from "@prisma/client";

/**
 * 标签的 find-or-create 与关联，**在事务里也必须安全**。
 *
 * 为什么不能用 `create().catch(...)` 兜唯一键冲突：
 * Postgres 的交互式事务是「一旦有语句报错，整个事务立刻进入 aborted 状态」的 ——
 * 之后每条语句都返回 25P02（current transaction is aborted, commands ignored until
 * end of transaction block），**与 JS 层有没有 catch 无关**。catch 只吞掉了 JS 错误，
 * 事务在服务端已经死了，紧接着的下一条语句（媒体认领 / 计数更新）会以
 * `PrismaClientUnknownRequestError` + 25P02 的形式炸出来，把真正的根因（唯一键冲突）
 * 盖得干干净净 —— 排查时看到的是「media.updateMany 失败」，而错的其实是上一句的 tagOnResource.create。
 *
 * 改用 createMany({ skipDuplicates: true })：落库是 INSERT ... ON CONFLICT DO NOTHING，
 * 冲突既不报错也不中断事务，只是插入 0 行。再回查一次即可拿到目标行。
 */

/** 按 name 与 slug 双查：同名不同写法会解析到同一行（如「云」和「yun」的拼音 slug 都是 yun），
 *  这是唯一键冲突最常见的来源，只查 name 会漏掉 slug 上的撞车。 */
function findTag(
  tx: Prisma.TransactionClient,
  name: string,
  slug: string,
): Promise<{ id: string } | null> {
  return tx.tag
    .findUnique({ where: { name }, select: { id: true } })
    .then((byName) => byName ?? tx.tag.findUnique({ where: { slug }, select: { id: true } }));
}

/** 取回或建出该标签；建不出来（理论上不可达）返回 null，调用方跳过这一条而不是炸掉整个事务。 */
export async function findOrCreateTag(
  tx: Prisma.TransactionClient,
  name: string,
  slug: string,
): Promise<{ id: string } | null> {
  const existing = await findTag(tx, name, slug);
  if (existing) return existing;
  await tx.tag.createMany({ data: [{ name, slug }], skipDuplicates: true });
  return findTag(tx, name, slug);
}

/** 建资源↔标签关联。返回是否真的新建了关联 —— 已存在的关联不重复给 Tag.count 加一。 */
export async function linkTag(
  tx: Prisma.TransactionClient,
  resourceId: string,
  tagId: string,
): Promise<boolean> {
  const res = await tx.tagOnResource.createMany({
    data: [{ resourceId, tagId }],
    skipDuplicates: true,
  });
  return res.count > 0;
}
