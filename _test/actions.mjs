// 写操作行为测试：经 /api/dev-test（真实会话 cookie 调 server action）+ Prisma 直查 DB 断言。
// 用法：node _test/actions.mjs（dev server 须在 3000 端口运行）
// 所有测试产物（评论/资源/夹子/举报/媒体等）测完即清理还原。
import { PrismaClient } from "@prisma/client";

const BASE = "http://localhost:3000";
const db = new PrismaClient();
let pass = 0,
  fail = 0;
const failures = [];
function ok(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`  PASS ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL ${name} ${extra}`);
  }
}

function makeSession() {
  const jar = {};
  return {
    set(res) {
      const raw = res.headers.getSetCookie?.() ?? [];
      for (const c of raw) {
        const i = c.indexOf("=");
        jar[c.slice(0, i)] = c.slice(i + 1);
      }
    },
    header() {
      return Object.entries(jar)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    },
  };
}
async function login(sess, identifier, password) {
  let r = await fetch(`${BASE}/api/auth/csrf`);
  sess.set(r);
  const { csrfToken } = await r.json();
  r = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: sess.header() },
    body: new URLSearchParams({ csrfToken, identifier, password, callbackUrl: BASE }),
    redirect: "manual",
  });
  sess.set(r);
}
async function call(sess, name, ...args) {
  const r = await fetch(`${BASE}/api/dev-test`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sess.header() },
    body: JSON.stringify({ name, args }),
  });
  // 保存响应 set-cookie（下载计数等 action 会回写去重 cookie）
  sess.set(r);
  return r.json();
}

// ---------- 准备 ----------
const creator = makeSession();
const admin = makeSession();
await login(creator, "creator@example.com", "test1234");
await login(admin, "admin@example.com", "test1234");

const creatorRow = await db.user.findUnique({ where: { email: "creator@example.com" } });
const adminRow = await db.user.findUnique({ where: { email: "admin@example.com" } });
const demoRow = await db.user.findUnique({ where: { email: "demo@example.com" } });
// 找一个 admin 发布的资源（供 creator 点赞/收藏/评论/举报），和 creator 自己的资源（供加版本）
const anyResource = await db.resource.findFirst({
  where: { status: "PUBLISHED", authorId: adminRow.id },
  select: { id: true, slug: true, likeCount: true, externalUrl: true },
});
const creatorResource = await db.resource.findFirst({
  where: { status: "PUBLISHED", authorId: creatorRow.id },
  orderBy: { createdAt: "asc" },
  select: { id: true, externalUrl: true },
});
const category = await db.category.findFirst();
ok("测试前置数据就绪", !!creatorRow && !!adminRow && !!anyResource && !!category);

console.log("\n[1] 点赞 / 收藏 / 关注");
// 点赞：开 → DB 行 + 计数 → 关 → 还原
{
  const before = anyResource.likeCount;
  const r1 = await call(creator, "toggleLike", anyResource.id);
  const like = await db.like.findUnique({
    where: { userId_resourceId: { userId: creatorRow.id, resourceId: anyResource.id } },
  });
  const mid = await db.resource.findUnique({
    where: { id: anyResource.id },
    select: { likeCount: true },
  });
  const r2 = await call(creator, "toggleLike", anyResource.id);
  const after = await db.resource.findUnique({
    where: { id: anyResource.id },
    select: { likeCount: true },
  });
  ok("点赞开", r1.result?.liked === true && !!like, JSON.stringify(r1));
  ok("点赞计数 +1", mid.likeCount === before + 1, `${before}->${mid.likeCount}`);
  ok("点赞关还原", r2.result?.liked === false && after.likeCount === before);
}
// 收藏：默认夹自动创建 + 移动夹子 + 删除夹子归未分组 + 取消收藏还原
{
  await call(creator, "toggleFavorite", anyResource.id);
  const fav = await db.favorite.findUnique({
    where: { userId_resourceId: { userId: creatorRow.id, resourceId: anyResource.id } },
  });
  const defCol = await db.collection.findFirst({
    where: { ownerId: creatorRow.id, name: "默认收藏" },
  });
  ok("收藏落默认夹", !!fav && fav.collectionId === defCol.id);

  await call(creator, "createCollection", { __fd: { name: "测试夹子-A" } });
  const col = await db.collection.findFirst({
    where: { ownerId: creatorRow.id, name: "测试夹子-A" },
  });
  ok("新建夹子", !!col);
  await call(creator, "setFavoriteCollection", anyResource.id, col.id);
  const fav2 = await db.favorite.findUnique({
    where: { userId_resourceId: { userId: creatorRow.id, resourceId: anyResource.id } },
  });
  ok("收藏移入新夹", fav2.collectionId === col.id);
  await call(creator, "renameCollection", { __fd: { id: col.id, name: "测试夹子-B" } });
  const col2 = await db.collection.findUnique({ where: { id: col.id } });
  ok("夹子重命名", col2.name === "测试夹子-B");
  await call(creator, "deleteCollection", { __fd: { id: col.id } });
  const fav3 = await db.favorite.findUnique({
    where: { userId_resourceId: { userId: creatorRow.id, resourceId: anyResource.id } },
  });
  ok(
    "删夹子收藏归未分组",
    fav3.collectionId === null && !(await db.collection.findUnique({ where: { id: col.id } })),
  );
  const favCountBefore = await db.resource.findUnique({
    where: { id: anyResource.id },
    select: { favoriteCount: true },
  });
  await call(creator, "toggleFavorite", anyResource.id);
  const favGone = await db.favorite.findUnique({
    where: { userId_resourceId: { userId: creatorRow.id, resourceId: anyResource.id } },
  });
  const favCountAfter = await db.resource.findUnique({
    where: { id: anyResource.id },
    select: { favoriteCount: true },
  });
  ok("取消收藏还原", !favGone && favCountAfter.favoriteCount === favCountBefore.favoriteCount - 1);
}
// 关注：开 → 通知 → 关
{
  const r1 = await call(creator, "toggleFollow", adminRow.id);
  const f = await db.follow.findUnique({
    where: { followerId_followingId: { followerId: creatorRow.id, followingId: adminRow.id } },
  });
  const note = await db.notification.findFirst({
    where: { userId: adminRow.id, actorId: creatorRow.id, type: "FOLLOW" },
    orderBy: { createdAt: "desc" },
  });
  ok("关注 + 作者通知", r1.result?.following === true && !!f && !!note);
  const r2 = await call(creator, "toggleFollow", adminRow.id);
  ok("取关还原", r2.result?.following === false);
  await db.notification.deleteMany({ where: { id: note.id } }); // 清理
}

console.log("\n[2] 评论（文字）");
let testCommentId;
{
  const r = await call(
    creator,
    "addComment",
    {},
    { __fd: { resourceId: anyResource.id, content: "行为测试评论——稍后自动删除" } },
  );
  const c = await db.comment.findFirst({
    where: {
      resourceId: anyResource.id,
      authorId: creatorRow.id,
      content: { contains: "行为测试评论" },
    },
    orderBy: { createdAt: "desc" },
  });
  const note = await db.notification.findFirst({
    where: { userId: adminRow.id, actorId: creatorRow.id, type: "COMMENT" },
    orderBy: { createdAt: "desc" },
  });
  ok("发评论 + 作者通知", r.result?.ok === true && !!c && !!note, JSON.stringify(r));
  testCommentId = c?.id;
  // 回复楼层
  const rr = await call(
    creator,
    "addComment",
    {},
    { __fd: { resourceId: anyResource.id, content: "行为测试回复", parentId: c.id } },
  );
  const reply = await db.comment.findFirst({ where: { parentId: c.id } });
  ok("回复楼层", rr.result?.ok === true && !!reply);
  await call(creator, "deleteComment", reply.id);
  // 删评（作者本人）
  const d = await call(creator, "deleteComment", c.id);
  const gone = await db.comment.findUnique({ where: { id: c.id } });
  ok("删评论软删", d.result?.ok === true && gone.status === "DELETED");
  await db.notification.deleteMany({ where: { id: note.id } }); // 清理通知
  await db.comment.deleteMany({ where: { id: { in: [c.id, reply.id] } } }); // 清理行
}

console.log("\n[3] 发布资源（非 trusted → PENDING / trusted → 直发）+ 审核上架");
let testResourceId;
{
  // creator 是 trusted → 直发 PUBLISHED 并 redirect 到详情页
  const r = await call(
    creator,
    "createResource",
    {},
    {
      __fd: {
        type: "ARTICLE",
        title: "行为测试文章-勿留",
        summary: "测试",
        description: "这是一篇行为测试文章的描述内容，超过十个字。",
        categoryId: category.id,
        tags: "测试标签",
      },
    },
  );
  const res = await db.resource.findFirst({ where: { title: "行为测试文章-勿留" } });
  ok(
    "trusted 用户直发上架",
    r.error === "NEXT_REDIRECT" && res?.status === "PUBLISHED",
    JSON.stringify(r).slice(0, 120),
  );
  const a = await call(admin, "approveResource", res.id);
  ok("admin 对已发布资源重复通过无害", a.result?.ok === true);
  testResourceId = res.id;

  // demo 非 trusted → 进审核队列
  const demo = makeSession();
  await login(demo, "demo@example.com", "test1234");
  const r2 = await call(
    demo,
    "createResource",
    {},
    {
      __fd: {
        type: "ARTICLE",
        title: "行为测试文章2-勿留",
        description: "这是第二篇行为测试文章的描述，超过十个字。",
        categoryId: category.id,
      },
    },
  );
  const res2 = await db.resource.findFirst({ where: { title: "行为测试文章2-勿留" } });
  ok(
    "非 trusted 发布进审核队列",
    r2.result?.pending === true && res2?.status === "PENDING",
    JSON.stringify(r2).slice(0, 120),
  );
  const a2 = await call(admin, "approveResource", res2.id);
  const after = await db.resource.findUnique({
    where: { id: res2.id },
    select: { status: true, publishedAt: true },
  });
  ok(
    "admin 通过上架",
    a2.result?.ok === true && after.status === "PUBLISHED" && !!after.publishedAt,
  );
  const modNote = await db.notification.findFirst({
    where: { userId: demoRow.id, type: "MODERATION", resourceId: res2.id },
  });
  ok("作者收到审核通知", !!modNote);
}

console.log("\n[4] 版本管理");
{
  const r = await call(
    creator,
    "addVersion",
    {},
    {
      __fd: {
        resourceId: creatorResource.id,
        version: "9.9.9",
        changelog: "行为测试版本",
        url: "/uploads/files/test.zip",
      },
    },
  );
  const v = await db.resourceVersion.findFirst({
    where: { resourceId: creatorResource.id, version: "9.9.9" },
  });
  ok("作者追加版本", r.result?.ok === true && !!v, JSON.stringify(r).slice(0, 200));
  ok("版本 url 落库", v?.url === "/uploads/files/test.zip");
  // 下载计数（会话去重：同 cookie 两次只计一次）
  const c1 = v.downloadCount;
  await call(creator, "bumpVersionDownload", v.id);
  await call(creator, "bumpVersionDownload", v.id);
  const v2 = await db.resourceVersion.findUnique({ where: { id: v.id } });
  ok("下载计数会话去重", v2.downloadCount === c1 + 1, `${c1}->${v2.downloadCount}`);
  // 清理：删版本行 + 还原 externalUrl
  await db.resourceVersion.delete({ where: { id: v.id } });
  await db.resource.update({
    where: { id: creatorResource.id },
    data: { externalUrl: creatorResource.externalUrl },
  });
  ok(
    "版本测试数据清理",
    !(await db.resourceVersion.findFirst({
      where: { resourceId: creatorResource.id, version: "9.9.9" },
    })),
  );
}

console.log("\n[5] 举报");
{
  const r = await call(creator, "reportResource", anyResource.id, "垃圾广告", "行为测试举报");
  const rep = await db.report.findFirst({
    where: { reporterId: creatorRow.id, targetResourceId: anyResource.id, status: "OPEN" },
  });
  ok("提交举报", r.result?.ok === true && !!rep, JSON.stringify(r));
  // 重复举报被忽略
  const r2 = await call(creator, "reportResource", anyResource.id, "垃圾广告");
  ok("重复举报被拒", r2.result?.ok === false);
  // 非法理由被拒
  const r3 = await call(creator, "reportResource", anyResource.id, "自定义理由");
  ok("非白名单理由被拒", r3.result?.ok === false);
  // 清理
  if (rep) await db.report.deleteMany({ where: { id: rep.id } });
  ok("举报数据清理", true);
}

console.log("\n[6] 账号安全（改密码 / 换邮箱，改完即改回）");
{
  const r1 = await call(
    creator,
    "changePassword",
    {},
    { __fd: { current: "test1234", next: "tmp-pass-123", confirm: "tmp-pass-123" } },
  );
  const row1 = await db.user.findUnique({
    where: { id: creatorRow.id },
    select: { passwordHash: true },
  });
  const changed = row1.passwordHash !== creatorRow.passwordHash;
  const r2 = await call(
    creator,
    "changePassword",
    {},
    { __fd: { current: "tmp-pass-123", next: "test1234", confirm: "test1234" } },
  );
  // 错误旧密码要被拒
  const r3 = await call(
    creator,
    "changePassword",
    {},
    { __fd: { current: "wrong-pass", next: "x".repeat(10), confirm: "x".repeat(10) } },
  );
  ok("改密码生效", r1.result?.ok === true && changed, JSON.stringify(r1));
  ok("改回原密码", r2.result?.ok === true);
  ok("错误旧密码被拒", r3.result?.ok !== true || !!r3.result?.fieldErrors);
}
{
  const r1 = await call(
    creator,
    "changeEmail",
    {},
    { __fd: { email: "creator-tmp@example.com", password: "test1234" } },
  );
  const e1 = await db.user.findUnique({ where: { id: creatorRow.id }, select: { email: true } });
  ok(
    "换邮箱生效",
    r1.result?.ok === true && e1.email === "creator-tmp@example.com",
    JSON.stringify(r1),
  );
  // 被占邮箱被拒
  const r2 = await call(
    creator,
    "changeEmail",
    {},
    { __fd: { email: "admin@example.com", password: "test1234" } },
  );
  ok("占用邮箱被拒", r2.result?.ok !== true || !!r2.result?.fieldErrors);
  const r3 = await call(
    creator,
    "changeEmail",
    {},
    { __fd: { email: "creator@example.com", password: "test1234" } },
  );
  ok("邮箱还原", r3.result?.ok === true);
}

console.log("\n[7] 通知中心动作（用临时测试用户，避免污染真实通知）");
{
  const t = await db.user.create({
    data: {
      email: "notify-tmp@example.com",
      username: "notify_tmp",
      passwordHash: "x",
      name: "notify tmp",
    },
  });
  const n1 = await db.notification.create({
    data: { userId: t.id, type: "LIKE", resourceId: anyResource.id, actorId: creatorRow.id },
  });
  const n2 = await db.notification.create({
    data: { userId: t.id, type: "SYSTEM", message: "行为测试系统通知" },
  });

  // 用临时用户登录（passwordHash 是假 hash，走不了 credentials）→ 改用直接构造 action 调用不行，
  // dev-test 路由依赖会话 cookie。改为：临时把密码设为可登录的真实 hash，测完删号。
  // （bcrypt 同步 hash）
  const bcrypt = (await import("bcryptjs")).default;
  await db.user.update({
    where: { id: t.id },
    data: { passwordHash: bcrypt.hashSync("test1234", 10) },
  });
  const ts = makeSession();
  await login(ts, "notify_tmp", "test1234");

  const unreadBefore = await db.notification.count({ where: { userId: t.id, readAt: null } });
  ok("临时用户有 2 未读", unreadBefore === 2, `count=${unreadBefore}`);
  await call(ts, "markAllNotificationsRead");
  const readAll = await db.notification.count({ where: { userId: t.id, readAt: null } });
  ok("全部已读", readAll === 0);
  await call(ts, "deleteNotification", n1.id);
  ok("单条删除", !(await db.notification.findUnique({ where: { id: n1.id } })));
  await call(ts, "clearNotifications");
  const left = await db.notification.count({ where: { userId: t.id } });
  ok("清空全部", left === 0);
  await db.user.delete({ where: { id: t.id } });
  ok("临时用户清理", true);
}

console.log("\n[8] admin 媒体库（直传 + 删除）");
{
  // 1x1 PNG
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const r = await call(
    admin,
    "uploadMedia",
    {},
    { __fd: {}, __file: { name: "smoke.png", mime: "image/png", base64: png.toString("base64") } },
  );
  // uploadMediaAction(prev, fd) 的 fd 里文件字段名是 file
  ok("admin 直传图片", r.result?.ok === true, JSON.stringify(r).slice(0, 200));
  const m = await db.media.findFirst({
    where: { fileName: "smoke.png" },
    orderBy: { createdAt: "desc" },
  });
  ok("媒体落库", !!m);
  if (m) {
    const d = await call(admin, "deleteMedia", m.id);
    ok(
      "删除未引用媒体",
      d.result?.ok === true && !(await db.media.findUnique({ where: { id: m.id } })),
      JSON.stringify(d).slice(0, 200),
    );
  }
  // 被引用的媒体拒绝删除（拿一个正在当封面的媒体）
  const withCover = await db.resource.findFirst({
    where: { coverMediaId: { not: null } },
    select: { coverMediaId: true },
  });
  const cover = withCover
    ? await db.media.findUnique({ where: { id: withCover.coverMediaId } })
    : null;
  if (cover) {
    const d = await call(admin, "deleteMedia", cover.id);
    ok("使用中媒体拒删", d.result?.ok === false, JSON.stringify(d).slice(0, 200));
  } else {
    ok("使用中媒体拒删（跳过：无封面媒体）", true);
  }
}

console.log("\n[9] 封禁/解封（admin action + 审计日志）");
{
  const r = await call(admin, "setUserBanned", demoRow.id, true, "行为测试封禁");
  const b = await db.user.findUnique({ where: { id: demoRow.id }, select: { bannedAt: true } });
  const audit = await db.auditLog.findFirst({
    where: { action: "BAN", targetId: demoRow.id },
    orderBy: { createdAt: "desc" },
  });
  ok("封禁生效 + 审计", r.result?.ok === true && !!b.bannedAt && !!audit, JSON.stringify(r));
  const r2 = await call(admin, "setUserBanned", demoRow.id, false);
  const b2 = await db.user.findUnique({ where: { id: demoRow.id }, select: { bannedAt: true } });
  ok("解封还原", r2.result?.ok === true && !b2.bannedAt);
}

console.log("\n[10] 清理发布测试资源");
{
  for (const title of ["行为测试文章-勿留", "行为测试文章2-勿留"]) {
    const res = await db.resource.findFirst({ where: { title }, select: { id: true } });
    if (!res) continue;
    const tagLinks = await db.tagOnResource.findMany({ where: { resourceId: res.id } });
    await db.tagOnResource.deleteMany({ where: { resourceId: res.id } });
    for (const l of tagLinks)
      await db.tag
        .update({ where: { id: l.tagId }, data: { count: { decrement: 1 } } })
        .catch(() => {});
    await db.resource.delete({ where: { id: res.id } });
  }
  const left = await db.resource.count({ where: { title: { contains: "行为测试" } } });
  ok("测试资源全部删除", left === 0, `left=${left}`);
}

await db.$disconnect();
console.log(`\n========== 结果：${pass} PASS / ${fail} FAIL ==========`);
if (failures.length) {
  console.log("失败项：");
  failures.forEach((f) => console.log(" -", f));
  process.exit(1);
}
