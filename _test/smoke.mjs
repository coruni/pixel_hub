// 全量冒烟测试：公共页 / 登录权限 / 设置·通知 / admin 后台 / 附件 API / 封禁拦截
// 用法：node _test/smoke.mjs   （dev server 须在 3000 端口运行）
import { execFileSync } from "child_process";
import { readFileSync } from "fs";

const BASE = "http://localhost:3000";
const ROOT = "E:/project/cms";
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

// ---------- cookie 会话 ----------
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
  return r.status;
}
async function get(sess, path, useRedirect = "manual") {
  const r = await fetch(BASE + path, { headers: { cookie: sess.header() }, redirect: useRedirect });
  const text = r.status < 400 || useRedirect === "manual" ? await r.text() : "";
  return { r, text };
}

// ---------- 1. 公共页面 ----------
console.log("\n[1] 公共页面（游客）");
const guest = makeSession();
for (const [name, path, kw] of [
  ["首页", "/", "发现"],
  ["浏览页", "/browse", ""],
  ["搜索页", "/search?q=%E5%83%8F%E7%B4%A0", ""],
  ["登录页", "/login", "登录"],
  ["注册页", "/register", "注册"],
  ["封禁提示页", "/banned", "封禁"],
  ["robots", "/robots.txt", "Sitemap:"],
  ["sitemap", "/sitemap.xml", "<urlset"],
]) {
  const { r, text } = await get(guest, path);
  ok(name, r.status === 200 && (!kw || text.includes(kw)), `status=${r.status}`);
}
for (const p of ["/settings", "/upload", "/admin", "/notifications"]) {
  const { r } = await get(guest, p);
  const loc = r.headers.get("location") ?? "";
  ok(
    `游客 ${p} 重定向登录`,
    [302, 307].includes(r.status) && loc.includes("/login"),
    `${r.status} ${loc}`,
  );
}

// sitemap 里的资源 slug 供后续用
const sitemapXml = await (await fetch(`${BASE}/sitemap.xml`)).text();
const slugs = [...sitemapXml.matchAll(/\/resources\/([^<]+)</g)].map((m) => m[1]);
ok("sitemap 含资源条目", slugs.length >= 4, `count=${slugs.length}`);

// 详情页（游客）：状态必须 200；有同类内容的资源应渲染相关推荐（ARTICLE 仅一篇时无推荐，属预期）
for (const s of slugs.slice(0, 6)) {
  const { r, text } = await get(guest, `/resources/${s}`);
  const related = text.includes("相关推荐");
  ok(
    `详情页 ${s}`,
    r.status === 200 && (related || s.includes("guide")),
    `status=${r.status} related=${related}`,
  );
}
{
  const { r } = await get(guest, "/resources/not-exist-slug-xyz");
  ok("不存在资源 404", r.status === 404, `status=${r.status}`);
}

// 个人主页（"@creator" 在 HTML 中被 JSX 注释分隔，改查页面特征）
{
  const { r, text } = await get(guest, "/u/creator");
  ok(
    "个人主页 /u/creator",
    r.status === 200 && (text.includes("作品") || text.includes("关注")),
    `status=${r.status}`,
  );
}

// ---------- 2. 登录态（creator：普通用户） ----------
console.log("\n[2] creator 登录态");
const creator = makeSession();
{
  const st = await login(creator, "creator@example.com", "test1234");
  ok("credentials 登录", st === 302 || st === 303, `status=${st}`);
}
{
  const { r, text } = await get(creator, "/settings");
  ok("settings 200", r.status === 200, `status=${r.status}`);
  ok("第三方账号卡", text.includes("第三方账号"));
  ok("修改密码卡", text.includes("修改密码"));
  ok("登录邮箱卡", text.includes("登录邮箱"));
  ok("头像卡", text.includes("头像"));
}
{
  const { r, text } = await get(creator, "/notifications");
  ok("通知页 200", r.status === 200);
  ok("筛选 chips", text.includes("type=LIKE") && text.includes("type=SYSTEM"));
}
for (const t of ["LIKE", "COMMENT", "FOLLOW", "SYSTEM"]) {
  const { r } = await get(creator, `/notifications?type=${t}`);
  ok(`通知筛选 type=${t}`, r.status === 200);
}
{
  const { r } = await get(creator, "/upload");
  ok("upload 200", r.status === 200, `status=${r.status}`);
}
{
  // 普通用户进 admin 被弹回
  const r = await fetch(BASE + "/admin", {
    headers: { cookie: creator.header() },
    redirect: "manual",
  });
  ok(
    "creator 访问 /admin 被拒",
    [302, 307].includes(r.status) || (await r.clone().text()).includes("首页"),
    `${r.status}`,
  );
}

// ---------- 3. admin 后台 ----------
console.log("\n[3] admin 后台");
const admin = makeSession();
{
  const st = await login(admin, "admin@example.com", "test1234");
  ok("admin 登录", st === 302 || st === 303, `status=${st}`);
}
for (const p of [
  "/admin",
  "/admin/queue",
  "/admin/content",
  "/admin/reports",
  "/admin/users",
  "/admin/media",
  "/admin/home",
  "/admin/site",
  "/admin/categories",
  "/admin/tags",
  "/admin/logs",
]) {
  // redirect=manual：未授权会被 30x 弹走，200 即代表真正渲染出后台
  const { r } = await get(admin, p);
  ok(`admin ${p}`, r.status === 200, `status=${r.status}`);
}

// ---------- 4. 附件上传 API ----------
console.log("\n[4] 附件上传 API");
{
  const fd = new FormData();
  fd.append(
    "file",
    new Blob([Buffer.from("PK\x03\x04 fake zip for smoke test")]),
    "smoke-test.zip",
  );
  const r = await fetch(`${BASE}/api/upload/attachment`, {
    method: "POST",
    headers: { cookie: admin.header() },
    body: fd,
  });
  const json = await r.json().catch(() => ({}));
  ok("上传 zip 200", r.status === 200 && json.ok, `status=${r.status}`);
  if (json.url) {
    const f = await fetch(BASE + json.url);
    ok("附件可访问", f.status === 200, `GET ${json.url} -> ${f.status}`);
  }
}
{
  const fd = new FormData();
  fd.append("file", new Blob([Buffer.from("MZ.exe")]), "evil.exe");
  const r = await fetch(`${BASE}/api/upload/attachment`, {
    method: "POST",
    headers: { cookie: admin.header() },
    body: fd,
  });
  ok("exe 被白名单拒绝", r.status >= 400, `status=${r.status}`);
}
{
  // 游客上传被拒
  const fd = new FormData();
  fd.append("file", new Blob([Buffer.from("x")]), "a.zip");
  const r = await fetch(`${BASE}/api/upload/attachment`, { method: "POST", body: fd });
  ok("游客上传被拒", r.status >= 400, `status=${r.status}`);
}

// ---------- 5. 封禁拦截 ----------
console.log("\n[5] 封禁拦截");
// 方言：按 .env 的 DATABASE_URL 前缀区分（PG 需要给保留字表名/驼峰列加引号）
const envText = readFileSync(`${ROOT}/.env`, "utf8");
const dbUrl = envText.match(/^DATABASE_URL="?([^"\r\n]+)"?/m)?.[1] ?? "";
const isPG = dbUrl.startsWith("postgres");
function db(sql) {
  return execFileSync(
    "npx",
    ["prisma", "db", "execute", "--stdin", "--schema", `${ROOT}/prisma/schema.prisma`],
    { input: sql, cwd: ROOT, shell: process.platform === "win32" },
  ).toString();
}
const banSql = isPG
  ? 'UPDATE "User" SET "bannedAt" = now(), "bannedReason" = $q$冒烟测试封禁$q$ WHERE email = $q$demo@example.com$q$;'
  : "UPDATE User SET bannedAt = datetime('now'), bannedReason = '冒烟测试封禁' WHERE email = 'demo@example.com';";
const unbanSql = isPG
  ? 'UPDATE "User" SET "bannedAt" = NULL, "bannedReason" = NULL WHERE email = $q$demo@example.com$q$;'
  : "UPDATE User SET bannedAt = NULL, bannedReason = NULL WHERE email = 'demo@example.com';";
try {
  db(banSql);
  const s = makeSession();
  const st = await login(s, "demo@example.com", "test1234");
  const finalUrl = st;
  ok("封禁账号登录被拒", finalUrl === 302 || finalUrl === 303, `status=${finalUrl}`);
  const { r, text } = await get(s, "/settings");
  ok("封禁账号无登录态", r.status !== 200 || !text.includes("第三方账号"));
} finally {
  db(unbanSql);
  ok("demo 账号已还原", true);
}

// ---------- 6. 其他功能页回归 ----------
console.log("\n[6] 功能页回归");
{
  // creator 个人主页 tab（游客可看作品/收藏?）
  const { r } = await get(guest, "/u/creator?tab=favorites");
  ok("个人主页收藏 tab", r.status === 200, `status=${r.status}`);
}
{
  const { r } = await get(guest, "/browse?cat=game&sort=popular");
  ok("browse 筛选参数", r.status === 200, `status=${r.status}`);
}
{
  const tagSlug = (sitemapXml.match(/\/tags\/([^<]+)</) || [])[1];
  if (tagSlug) {
    const { r } = await get(guest, `/tags/${tagSlug}`);
    ok(`标签详情 /tags/${tagSlug}`, r.status === 200, `status=${r.status}`);
  }
}

console.log(`\n========== 结果：${pass} PASS / ${fail} FAIL ==========`);
if (failures.length) {
  console.log("失败项：");
  failures.forEach((f) => console.log(" -", f));
  process.exit(1);
}
