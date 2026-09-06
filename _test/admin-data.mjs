// 后台数据管理行为测试：内容库（Task 1）/ 用户管理（Task 2）/ 媒体库（Task 3）
// 用法：node _test/admin-data.mjs（dev server 须在 3000 端口运行）
// 所有测试产物（临时账号/资源/媒体/标签/评论）测完即清理还原。
import fs from "fs";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

// 会话池（5432）被 dev server 占满，测试侧走事务池 6543 读写
const raw = fs.readFileSync("E:/project/cms/.env", "utf8").match(/^DATABASE_URL="?([^"\r\n]+)"?/m)[1];
const pu = new URL(raw);
pu.port = "6543";
pu.search = "?pgbouncer=true";

const BASE = "http://localhost:3000";
const db = new PrismaClient({ datasources: { db: { url: pu.toString() } } });
const TS = String(Date.now()).slice(-8);
const PASS = "test1234";

let pass = 0,
  fail = 0;
const failures = [];
function ok(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`  PASS ${name}`);
  } else {
    fail++;
    failures.push(name + (extra ? ` — ${extra}` : ""));
    console.log(`  FAIL ${name} ${extra}`);
  }
}

function makeSession() {
  const jar = {};
  return {
    set(res) {
      for (const c of res.headers.getSetCookie?.() ?? []) {
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
async function login(sess, identifier) {
  let r = await fetch(`${BASE}/api/auth/csrf`);
  sess.set(r);
  const { csrfToken } = await r.json();
  r = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: sess.header() },
    body: new URLSearchParams({ csrfToken, identifier, password: PASS, callbackUrl: BASE }),
    redirect: "manual",
  });
  sess.set(r);
  return r.status;
}
async function get(sess, path, redirect = "manual") {
  const r = await fetch(BASE + path, { headers: { cookie: sess.header() }, redirect });
  const text = r.status === 200 ? await r.text() : "";
  return { r, text };
}
async function call(sess, name, ...args) {
  const r = await fetch(`${BASE}/api/dev-test`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sess.header() },
    body: JSON.stringify({ name, args }),
  });
  sess.set(r);
  return r.json();
}

// ---------- 准备：临时账号（不依赖 seed 数据，测完即删） ----------
const hash = bcrypt.hashSync(PASS, 10);
async function tempUser(role, tag) {
  return db.user.create({
    data: {
      email: `tmp-${tag}-${TS}@example.com`,
      username: `tmp_${tag}_${TS}`,
      passwordHash: hash,
      name: `临时${tag}-${TS}`,
      role,
      trusted: role !== "USER",
    },
  });
}
const adminRow = await tempUser("ADMIN", "admin");
const modRow = await tempUser("MODERATOR", "mod");
const userRow = await tempUser("USER", "user");

const admin = makeSession();
const mod = makeSession();
const plain = makeSession();
ok(
  "临时账号登录",
  (await login(admin, adminRow.email)) === 302 &&
    (await login(mod, modRow.email)) === 302 &&
    (await login(plain, userRow.email)) === 302,
);

const category = await db.category.findFirst({ orderBy: { sort: "asc" } });
const otherCategory = await db.category.findFirst({ where: { id: { not: category.id } } });
ok("测试前置数据就绪", !!category && !!otherCategory, `cats=${!!category}/${!!otherCategory}`);

// ============================================================
console.log("\n[1] 内容库：检索 / 分页 / 稳定排序");
const probeIds = [];
{
  // 35 条探针资源（01 最旧 → 35 最新），用于验证 30/页 与 createdAt desc 稳定排序
  const base = Date.now() - 40_000;
  for (let i = 1; i <= 35; i++) {
    const r = await db.resource.create({
      data: {
        slug: `probe-${TS}-${i}`,
        title: `分页探针-${String(i).padStart(2, "0")}`,
        description: "后台数据管理分页测试探针资源的描述内容。",
        type: "ARTICLE",
        categoryId: category.id,
        authorId: userRow.id,
        status: "PUBLISHED",
        publishedAt: new Date(base + i * 1000),
        createdAt: new Date(base + i * 1000),
        meta: JSON.stringify({ license: "", downloads: [] }),
      },
      select: { id: true },
    });
    probeIds.push(r.id);
  }

  const p1 = await get(admin, `/admin/content?q=${encodeURIComponent("分页探针")}`);
  ok("关键词筛选返回", p1.r.status === 200, `status=${p1.r.status}`);
  ok("第 1 页含最新探针 35", p1.text.includes("分页探针-35"));
  ok("第 1 页含第 30 条探针 06", p1.text.includes("分页探针-06"));
  ok("第 1 页不含第 31 条探针 05", !p1.text.includes("分页探针-05"));
  ok("每页 30 条（35 条分两页）", !p1.text.includes("分页探针-01"));

  const p2 = await get(admin, `/admin/content?q=${encodeURIComponent("分页探针")}&page=2`);
  ok("第 2 页含探针 05", p2.text.includes("分页探针-05"));
  ok("第 2 页含最旧探针 01", p2.text.includes("分页探针-01"));
  ok("第 2 页不含探针 06", !p2.text.includes("分页探针-06"));
  ok("总数显示 35", p2.text.includes("35"), "应展示筛选后的总数");

  // 关键词精确命中
  const one = await get(admin, `/admin/content?q=${encodeURIComponent("分页探针-07")}`);
  ok(
    "关键词精确筛选",
    one.text.includes("分页探针-07") && !one.text.includes("分页探针-08"),
  );

  // 类型筛选：探针全是 ARTICLE，type=GAME 应为空
  const byType = await get(admin, `/admin/content?q=${encodeURIComponent("分页探针")}&type=GAME`);
  ok("类型筛选生效", byType.text.includes("暂无内容"));

  // 作者筛选
  const byAuthor = await get(
    admin,
    `/admin/content?author=${encodeURIComponent(userRow.username)}&q=${encodeURIComponent("分页探针")}`,
  );
  const byNoAuthor = await get(
    admin,
    `/admin/content?author=nobody-${TS}&q=${encodeURIComponent("分页探针")}`,
  );
  // 第 1 页只有最新 30 条，命中判断用 -35（-01 在第 2 页）
  ok("作者筛选命中", byAuthor.text.includes("分页探针-35"));
  ok("作者筛选无结果", byNoAuthor.text.includes("暂无内容"));

  // 分类筛选
  const byCat = await get(
    admin,
    `/admin/content?cat=${category.id}&q=${encodeURIComponent("分页探针")}`,
  );
  const byOtherCat = await get(
    admin,
    `/admin/content?cat=${otherCategory.id}&q=${encodeURIComponent("分页探针")}`,
  );
  ok("分类筛选命中", byCat.text.includes("分页探针-35"));
  ok("分类筛选无结果", byOtherCat.text.includes("暂无内容"));

  // 状态筛选：探针全 PUBLISHED，切 REMOVED 应为空
  const byStatus = await get(
    admin,
    `/admin/content?status=REMOVED&q=${encodeURIComponent("分页探针")}`,
  );
  ok("状态筛选生效", byStatus.text.includes("暂无内容"));

  // 编辑入口
  await db.resource.update({ where: { id: probeIds[0] }, data: { status: "REMOVED" } });
  const withRemoved = await get(
    admin,
    `/admin/content?status=REMOVED&q=${encodeURIComponent("分页探针")}`,
  );
  ok("编辑入口存在", withRemoved.text.includes(`/admin/content/${probeIds[0]}/edit`));
  await db.resource.update({ where: { id: probeIds[0] }, data: { status: "PUBLISHED" } });

  // 分页参数边界
  for (const bad of ["0", "-3", "abc", "9999"]) {
    const g = await get(admin, `/admin/content?q=${encodeURIComponent("分页探针")}&page=${bad}`);
    ok(`page=${bad} 不报错`, g.r.status === 200, `status=${g.r.status}`);
  }
}

// ============================================================
console.log("\n[2] 内容库：后台编辑资源（updateResourceAdmin）");
{
  const target = probeIds[34]; // 分页探针-35
  const before = await db.resource.findUnique({
    where: { id: target },
    select: { slug: true, authorId: true, likeCount: true, title: true },
  });

  // 权限：普通用户 / 游客不得编辑
  const byUser = await call(plain, "updateResourceAdmin", {}, { __fd: { id: target, title: "越权标题" } });
  const afterUser = await db.resource.findUnique({ where: { id: target }, select: { title: true } });
  ok(
    "普通用户无权编辑",
    !(byUser.result?.ok === true) && afterUser.title === before.title,
    JSON.stringify(byUser).slice(0, 160),
  );

  // 校验：标题过短 / 描述过短 / 下载地址非法
  const bad1 = await call(
    admin,
    "updateResourceAdmin",
    {},
    { __fd: { id: target, title: "短", description: "合法的描述内容，至少十个字。", categoryId: category.id } },
  );
  ok("标题过短被拒", !!bad1.result?.fieldErrors?.title, JSON.stringify(bad1).slice(0, 160));
  const bad2 = await call(
    admin,
    "updateResourceAdmin",
    {},
    { __fd: { id: target, title: "合法的新标题", description: "短", categoryId: category.id } },
  );
  ok("描述过短被拒", !!bad2.result?.fieldErrors?.description, JSON.stringify(bad2).slice(0, 160));
  const bad3 = await call(
    admin,
    "updateResourceAdmin",
    {},
    {
      __fd: {
        id: target,
        title: "合法的新标题",
        description: "合法的描述内容，至少十个字。",
        categoryId: category.id,
        externalUrl: "javascript:alert(1)",
      },
    },
  );
  ok("非法下载地址被拒", !!bad3.result?.fieldErrors?.externalUrl, JSON.stringify(bad3).slice(0, 200));
  const bad4 = await call(
    admin,
    "updateResourceAdmin",
    {},
    { __fd: { id: "not-exist-id", title: "合法的新标题", description: "合法的描述内容，至少十个字。", categoryId: category.id } },
  );
  ok("资源不存在被拒", bad4.result?.ok !== true, JSON.stringify(bad4).slice(0, 160));

  // 正常编辑（版主也有权）
  const tagNameA = `标签A-${TS}`;
  const tagNameB = `标签B-${TS}`;
  const r1 = await call(
    mod,
    "updateResourceAdmin",
    {},
    {
      __fd: {
        id: target,
        title: "已改标题-探针",
        summary: "已改简介",
        description: "已经修改过的正文描述内容，长度足够。",
        categoryId: otherCategory.id,
        tags: `${tagNameA},${tagNameB}`,
        nsfw: "on",
        loginRequired: "on",
        allowComments: "off",
        isDownloadable: "off",
      },
    },
  );
  const after1 = await db.resource.findUnique({
    where: { id: target },
    select: {
      title: true,
      summary: true,
      description: true,
      categoryId: true,
      slug: true,
      authorId: true,
      likeCount: true,
      nsfw: true,
      loginRequired: true,
      allowComments: true,
      isDownloadable: true,
      tags: { include: { tag: true } },
    },
  });
  ok("版主可编辑", r1.result?.ok === true, JSON.stringify(r1).slice(0, 200));
  ok("标题/简介/正文/分类已更新", after1.title === "已改标题-探针" && after1.summary === "已改简介" && after1.categoryId === otherCategory.id);
  ok("slug 不变", after1.slug === before.slug);
  ok("作者与统计不变", after1.authorId === before.authorId && after1.likeCount === before.likeCount);
  ok(
    "可见性开关生效",
    after1.nsfw === true &&
      after1.loginRequired === true &&
      after1.allowComments === false &&
      after1.isDownloadable === false,
  );

  // 标签同步与计数
  const tagA = await db.tag.findUnique({ where: { name: tagNameA } });
  const tagB = await db.tag.findUnique({ where: { name: tagNameB } });
  ok(
    "新标签建立关联",
    after1.tags.length === 2 && !!tagA && !!tagB,
    `links=${after1.tags.length} A=${!!tagA} B=${!!tagB}`,
  );
  ok("新标签计数为 1", tagA?.count === 1 && tagB?.count === 1, `A=${tagA?.count} B=${tagB?.count}`);

  // 去掉 B、保留 A → A 计数不变、B 计数归零/删除；重复提交不重复计数
  const tagNameC = `标签C-${TS}`;
  await call(
    admin,
    "updateResourceAdmin",
    {},
    {
      __fd: {
        id: target,
        title: "已改标题-探针",
        description: "已经修改过的正文描述内容，长度足够。",
        categoryId: otherCategory.id,
        tags: `${tagNameA},${tagNameC}`,
      },
    },
  );
  const tagA2 = await db.tag.findUnique({ where: { name: tagNameA } });
  const tagB2 = await db.tag.findUnique({ where: { name: tagNameB } });
  const tagC = await db.tag.findUnique({ where: { name: tagNameC } });
  const links2 = await db.tagOnResource.findMany({ where: { resourceId: target } });
  ok("保留标签计数不变（不重复累加）", tagA2?.count === 1, `A=${tagA2?.count}`);
  ok("移除标签计数递减", !tagB2 || tagB2.count === 0, `B=${tagB2?.count}`);
  ok("新增标签计数 +1", tagC?.count === 1, `C=${tagC?.count}`);
  ok("关联行与提交一致", links2.length === 2, `links=${links2.length}`);

  // 还原
  await db.resource.update({
    where: { id: target },
    data: {
      title: before.title,
      summary: null,
      description: "后台数据管理分页测试探针资源的描述内容。",
      categoryId: category.id,
      nsfw: false,
      loginRequired: false,
      allowComments: true,
      isDownloadable: true,
    },
  });
  await db.tagOnResource.deleteMany({ where: { resourceId: target } });
  await db.tag.deleteMany({ where: { name: { in: [tagNameA, tagNameB, tagNameC] } } });
}

// ============================================================
console.log("\n[3] 用户管理：检索 / 筛选 / 分页边界 / 权限");
const userIds = [];
{
  // 35 个探针用户（01 最旧 → 35 最新）
  const base = Date.now() - 40_000;
  for (let i = 1; i <= 35; i++) {
    const u = await db.user.create({
      data: {
        email: `pg${TS}-${i}@example.com`,
        username: `pg${TS}-${String(i).padStart(2, "0")}`,
        passwordHash: hash,
        name: `pg${TS}-${String(i).padStart(2, "0")}`,
        createdAt: new Date(base + i * 1000),
      },
      select: { id: true },
    });
    userIds.push(u.id);
  }
  const q = `pg${TS}`;

  const p1 = await get(admin, `/admin/users?q=${q}`);
  ok("用户关键词检索", p1.r.status === 200 && p1.text.includes(`pg${TS}-35`), `status=${p1.r.status}`);
  ok("第 1 页 30 条（不含 -05）", !p1.text.includes(`pg${TS}-05`));
  ok("总数显示 35", p1.text.includes("35"));
  const p2 = await get(admin, `/admin/users?q=${q}&page=2`);
  ok("第 2 页含最旧 -01", p2.text.includes(`pg${TS}-01`));
  ok("第 2 页不含 -06", !p2.text.includes(`pg${TS}-06`));

  // 邮箱 / 昵称命中
  const byMail = await get(admin, `/admin/users?q=${encodeURIComponent(`pg${TS}-07@example.com`)}`);
  ok("邮箱命中", byMail.text.includes(`pg${TS}-07`));

  // 角色筛选
  const byRole = await get(admin, `/admin/users?role=ADMIN&q=${q}`);
  ok("角色筛选（ADMIN 无探针用户）", byRole.r.status === 200 && !byRole.text.includes(`pg${TS}-01`));
  await db.user.update({ where: { id: userIds[0] }, data: { role: "MODERATOR" } });
  const byRole2 = await get(admin, `/admin/users?role=MODERATOR&q=${q}`);
  ok("角色筛选命中", byRole2.text.includes(`pg${TS}-01`));
  await db.user.update({ where: { id: userIds[0] }, data: { role: "USER" } });

  // 封禁 / 免审筛选
  await db.user.update({ where: { id: userIds[1] }, data: { bannedAt: new Date() } });
  await db.user.update({ where: { id: userIds[2] }, data: { trusted: true } });
  const banned = await get(admin, `/admin/users?banned=1&q=${q}`);
  ok("封禁筛选命中", banned.text.includes(`pg${TS}-02`) && !banned.text.includes(`pg${TS}-03`));
  const active = await get(admin, `/admin/users?banned=0&q=${q}`);
  ok("正常筛选不含封禁用户", !active.text.includes(`pg${TS}-02`));
  const trusted = await get(admin, `/admin/users?trusted=1&q=${q}`);
  ok("免审筛选命中", trusted.text.includes(`pg${TS}-03`) && !trusted.text.includes(`pg${TS}-02`));

  // 分页边界
  for (const bad of ["0", "-1", "abc", "99999"]) {
    const g = await get(admin, `/admin/users?q=${q}&page=${bad}`);
    ok(`page=${bad} 不报错`, g.r.status === 200, `status=${g.r.status}`);
  }

  // 非 ADMIN 不得访问：页面标题带总数（用户管理（N）），版主侧不应出现
  const byMod = await get(mod, "/admin/users");
  ok(
    "版主访问用户管理被拒",
    !byMod.text.includes("用户管理（") && !byMod.text.includes("已封禁"),
    `status=${byMod.r.status}`,
  );
  const byModAction = await call(mod, "setUserTrusted", userIds[0], true);
  ok("版主调用用户动作被拒", byModAction.result?.ok === false, JSON.stringify(byModAction).slice(0, 160));
}

// ============================================================
console.log("\n[4] 媒体库：筛选 / 参数保持 / 孤儿多选");
const mediaIds = [];
const commentMediaIds = [];
let avatarUserId;
{
  const mk = (over) =>
    db.media.create({
      data: {
        kind: "ORIGINAL",
        storageKey: `/uploads/probe/${TS}-${Math.random().toString(36).slice(2, 8)}.png`,
        uploaderId: userRow.id,
        status: "READY",
        fileName: `孤儿探针-${TS}.png`,
        size: 1024,
        ...over,
      },
      select: { id: true, storageKey: true },
    });

  // 3 个真孤儿
  const o1 = await mk({ fileName: `孤儿探针-${TS}-1.png` });
  const o2 = await mk({ fileName: `孤儿探针-${TS}-2.png` });
  const o3 = await mk({ fileName: `特殊名字-${TS}.png` });
  mediaIds.push(o1.id, o2.id, o3.id);

  // 关联资源 / 评论 / 封面 / 头像 → 都不得被批量清理
  const attached = await mk({ fileName: `孤儿探针-${TS}-资源图.png`, resourceId: probeIds[0] });
  mediaIds.push(attached.id);

  const tmpComment = await db.comment.create({
    data: { resourceId: probeIds[1], authorId: userRow.id, content: "后台媒体库测试评论" },
    select: { id: true },
  });
  const onComment = await mk({ fileName: `孤儿探针-${TS}-评论图.png`, commentId: tmpComment.id });
  commentMediaIds.push(onComment.id);

  const cover = await mk({ fileName: `孤儿探针-${TS}-封面.png` });
  await db.resource.update({ where: { id: probeIds[2] }, data: { coverMediaId: cover.id } });
  mediaIds.push(cover.id);

  const forAvatar = await mk({ fileName: `孤儿探针-${TS}-头像.png` });
  const avatarUser = await db.user.create({
    data: {
      email: `avatar-${TS}@example.com`,
      username: `avatar_${TS}`,
      passwordHash: hash,
      avatarKey: forAvatar.storageKey,
    },
    select: { id: true },
  });
  avatarUserId = avatarUser.id;
  mediaIds.push(forAvatar.id);

  // 31 个孤儿探针：验证媒体库 30/页 与筛选参数在翻页时保留
  for (let i = 1; i <= 31; i++) {
    const m = await mk({ fileName: `分页媒体-${TS}-${String(i).padStart(2, "0")}.png` });
    mediaIds.push(m.id);
  }

  // 文件名筛选
  const byName = await get(admin, `/admin/media?fileName=${encodeURIComponent(`孤儿探针-${TS}`)}`);
  ok("文件名筛选命中", byName.r.status === 200 && byName.text.includes(`孤儿探针-${TS}-1.png`));
  ok("文件名筛选排除无关项", !byName.text.includes(`特殊名字-${TS}.png`));

  // 孤儿筛选：排除资源图/评论图/封面/头像图
  const onlyOrphan = await get(
    admin,
    `/admin/media?fileName=${encodeURIComponent(`孤儿探针-${TS}`)}&orphan=1`,
  );
  ok("孤儿筛选保留孤儿", onlyOrphan.text.includes(`孤儿探针-${TS}-1.png`));
  // 孤儿筛选按「未关联资源/评论」过滤；头像引用是裸 key，列表层查不出，由清理动作逐条拦
  ok(
    "孤儿筛选排除已引用",
    !onlyOrphan.text.includes(`孤儿探针-${TS}-资源图.png`) &&
      !onlyOrphan.text.includes(`孤儿探针-${TS}-评论图.png`) &&
      !onlyOrphan.text.includes(`孤儿探针-${TS}-封面.png`),
  );

  // 类型 / 状态 / 上传者筛选
  const byKind = await get(
    admin,
    `/admin/media?fileName=${encodeURIComponent(`孤儿探针-${TS}`)}&kind=COVER`,
  );
  ok("类型筛选生效", byKind.text.includes("没有匹配的媒体"));
  const byStatus = await get(
    admin,
    `/admin/media?fileName=${encodeURIComponent(`孤儿探针-${TS}`)}&status=FAILED`,
  );
  ok("状态筛选生效", byStatus.text.includes("没有匹配的媒体"));
  const byUploader = await get(
    admin,
    `/admin/media?fileName=${encodeURIComponent(`孤儿探针-${TS}`)}&user=${userRow.username}`,
  );
  const byNobody = await get(
    admin,
    `/admin/media?fileName=${encodeURIComponent(`孤儿探针-${TS}`)}&user=nobody-${TS}`,
  );
  ok("上传者筛选命中", byUploader.text.includes(`孤儿探针-${TS}-1.png`));
  ok("上传者筛选无结果", byNobody.text.includes("没有匹配的媒体"));

  // 分页：30/页 + 翻页保留全部筛选参数
  const mp1 = await get(
    admin,
    `/admin/media?fileName=${encodeURIComponent(`分页媒体-${TS}`)}&orphan=1`,
  );
  ok("媒体第 1 页含 -31", mp1.text.includes(`分页媒体-${TS}-31.png`));
  ok("媒体第 1 页 30 条（不含 -01）", !mp1.text.includes(`分页媒体-${TS}-01.png`));
  const mp2 = await get(
    admin,
    `/admin/media?fileName=${encodeURIComponent(`分页媒体-${TS}`)}&orphan=1&page=2`,
  );
  ok("媒体第 2 页含最旧 -01", mp2.text.includes(`分页媒体-${TS}-01.png`));
  ok("媒体第 2 页不含 -02", !mp2.text.includes(`分页媒体-${TS}-02.png`));
  ok(
    "分页链接保留筛选参数",
    /href="\/admin\/media\?[^"]*orphan=1/.test(mp1.text) &&
      /href="\/admin\/media\?[^"]*fileName=/.test(mp1.text),
    "孤儿筛选下应出现带 fileName + orphan 的分页链接",
  );

  // 孤儿多选 UI
  ok(
    "孤儿媒体带多选入口",
    onlyOrphan.text.includes(`data-orphan-id="${o1.id}"`) &&
      onlyOrphan.text.includes(`data-orphan-id="${o2.id}"`),
    "孤儿行应渲染可选条目",
  );
  ok(
    "已引用媒体不可选",
    !onlyOrphan.text.includes(`data-orphan-id="${attached.id}"`),
    "非孤儿行不应出现多选入口",
  );

  // ============================================================
  console.log("\n[5] 媒体库：孤儿批量清理（仅 ADMIN + 逐条校验）");
  const byMod = await call(mod, "bulkDeleteOrphanMedia", [o1.id]);
  ok("版主不可批量清理", byMod.result?.ok === false, JSON.stringify(byMod).slice(0, 160));
  const empty = await call(admin, "bulkDeleteOrphanMedia", []);
  ok("空选择被拒", empty.result?.ok === false, JSON.stringify(empty).slice(0, 160));

  const mixed = await call(admin, "bulkDeleteOrphanMedia", [
    o1.id,
    attached.id,
    onComment.id,
    cover.id,
    forAvatar.id,
    "not-exist-id",
    "<script>",
  ]);
  const survived = await db.media.findMany({
    where: { id: { in: [attached.id, onComment.id, cover.id, forAvatar.id] } },
    select: { id: true },
  });
  ok("清理返回成功与统计", mixed.result?.ok === true, JSON.stringify(mixed).slice(0, 200));
  ok("仅删除 1 条孤儿", mixed.result?.deleted === 1, `deleted=${mixed.result?.deleted}`);
  ok("跳过 6 条（引用/非法）", mixed.result?.skipped?.length === 6, `skipped=${JSON.stringify(mixed.result?.skipped)}`);
  ok("被引用与非法项均未删除", survived.length === 4, `survived=${survived.length}`);
  ok("孤儿已删除", !(await db.media.findUnique({ where: { id: o1.id } })));
  const auditRow = await db.auditLog.findFirst({
    where: { action: "DELETE_MEDIA_BULK", adminId: adminRow.id },
    orderBy: { createdAt: "desc" },
  });
  ok("清理写审计日志", !!auditRow, "应记录 DELETE_MEDIA_BULK");

  const rest = await call(admin, "bulkDeleteOrphanMedia", [o2.id, o3.id]);
  ok("批量清理剩余孤儿", rest.result?.ok === true && rest.result?.deleted === 2, JSON.stringify(rest).slice(0, 200));
}

// ---------- 清理 ----------
console.log("\n[6] 清理测试数据");
{
  await db.media.deleteMany({ where: { id: { in: [...mediaIds, ...commentMediaIds] } } });
  await db.comment.deleteMany({ where: { resourceId: { in: probeIds } } });
  await db.resource.deleteMany({ where: { id: { in: probeIds } } });
  await db.session.deleteMany({ where: { userId: { in: [adminRow.id, modRow.id, userRow.id, avatarUserId] } } });
  await db.user.deleteMany({
    where: { id: { in: [adminRow.id, modRow.id, userRow.id, avatarUserId, ...userIds] } },
  });
  await db.auditLog.deleteMany({ where: { adminId: { in: [adminRow.id, modRow.id] } } });
  const leftRes = await db.resource.count({ where: { slug: { startsWith: `probe-${TS}` } } });
  const leftUser = await db.user.count({ where: { username: { contains: TS } } });
  const leftMedia = await db.media.count({ where: { fileName: { contains: TS } } });
  ok("探针资源已清理", leftRes === 0, `left=${leftRes}`);
  ok("临时账号已清理", leftUser === 0, `left=${leftUser}`);
  ok("临时媒体已清理", leftMedia === 0, `left=${leftMedia}`);
}

await db.$disconnect();
console.log(`\n========== 结果：${pass} PASS / ${fail} FAIL ==========`);
if (failures.length) {
  console.log("失败项：");
  failures.forEach((f) => console.log(" -", f));
  process.exit(1);
}
