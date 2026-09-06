// 一次性探测：用 .env 里已配的 GRAPH_* 客户端凭据，确认哪些 Graph 端点实际可达，
// 并打印可直接粘贴到后台「云盘 → 登记」locator 框的真实值。只读不写、不打印密钥。
//
// 用法（仓库根目录运行）：
//   node _test/graph-locator.mjs                       # 探测菜单：列可达的盘 / 用户 / 租户信息
//   node _test/graph-locator.mjs "https://X.sharepoint.com/sites/资料"   # 校验某 SharePoint 站点
//   node _test/graph-locator.mjs "alice@X.onmicrosoft.com"              # 校验某用户的 OneDrive
//   node _test/graph-locator.mjs "drives/<已有id>"                       # 复核既有 locator
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ---- 极简 .env 解析（仅取 GRAPH_*）----
function loadEnv(file) {
  const out = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const envPath = fileURLToPath(new URL("../.env", import.meta.url));
const env = loadEnv(envPath);
const tenant = env.GRAPH_TENANT_ID?.trim() || "";
const clientId = env.GRAPH_CLIENT_ID?.trim() || "";
const clientSecret = env.GRAPH_CLIENT_SECRET?.trim() || "";
const endpoint = (env.GRAPH_ENDPOINT?.trim() || "https://graph.microsoft.com").replace(/\/+$/, "");

if (!tenant || !clientId || !clientSecret) {
  console.error("✗ .env 未填全 GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET");
  process.exit(1);
}

// ---- token（client_credentials）----
const tokenRes = await fetch(
  `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
  {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: `${endpoint}/.default`,
      grant_type: "client_credentials",
    }),
  },
);
const tokenText = await tokenRes.text().catch(() => "");
if (!tokenRes.ok) {
  console.error(`✗ 取 token 失败 HTTP ${tokenRes.status}`);
  console.error(`  ${tokenText.slice(0, 300)}`);
  process.exit(1);
}
const TOKEN = JSON.parse(tokenText).access_token;
const BEARER = { authorization: `Bearer ${TOKEN}`, accept: "application/json" };

// 解码 access_token 声明（本地 JWT，无签名校验，只看授权角色）
function decodeRoles(tok) {
  const parts = tok.split(".");
  if (parts.length < 2) return null;
  const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.padEnd(Math.ceil(b64.length / 4) * 4, "=");
  try {
    const claims = JSON.parse(Buffer.from(pad, "base64").toString("utf8"));
    return {
      aud: claims.aud,
      roles: Array.isArray(claims.roles) ? claims.roles : [],
      scp: claims.scp ?? "",
      appid: claims.appid,
    };
  } catch {
    return null;
  }
}
const claim = decodeRoles(TOKEN);
console.log("── 当前 token 声明 ──");
if (!claim) console.log("（无法解码 token）");
else {
  console.log(`aud（目标资源）：${claim.aud}`);
  console.log(`appid：${claim.appid}`);
  console.log(`roles（应用程序权限，实际授权的）：`);
  if (claim.roles.length) for (const r of claim.roles) console.log(`  • ${r}`);
  else console.log("  （空 —— 应用在 Azure 里没有已同意的应用程序权限！）");
  if (claim.scp) console.log(`scp（委派作用域）：${claim.scp}`);
}
console.log("");

async function call(url) {
  const res = await fetch(url, { headers: BEARER, cache: "no-store" });
  const text = await res.text().catch(() => "");
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, json, text: text.slice(0, 300) };
}

function stat(r, label) {
  const code = r.json?.error?.code ?? "";
  const msg = r.json?.error?.message ?? "";
  if (r.status === 200) return `${label} ✓ HTTP 200`;
  let h = "";
  if (r.status === 403) h = "权限不足（应用未获该范围，或 Sites.Selected 未授权此目标）";
  else if (r.status === 404) h = "目标不存在/路径拼写错";
  else if (r.status === 401) h = "token 被 Graph 拒绝（见 code，多为权限/audience 问题）";
  return `${label} ✗ HTTP ${r.status}（${h}）code=${code} ${msg ? msg.slice(0, 220) : ""}`.trim();
}

const SAFE_ID = /^[A-Za-z0-9@._:(){}[\],-]+$/;

// ---- 按指定目标校验 ----
async function checkTarget(raw) {
  const t = (raw || "").trim();
  let locators;
  if (/^https?:\/\//i.test(t)) {
    const u = new URL(t);
    const p = u.pathname.replace(/\/+$/, "");
    const m = /^\/(sites|teams)\/(.+)$/i.exec(p);
    if (!m) {
      console.error(`✗ 只支持 /sites/<名> 或 /teams/<名> 形式的站点 URL：${u.origin + p}`);
      process.exit(1);
    }
    locators = [`sites/${u.host}:/${m[1]}/${m[2]}:/drive`];
  } else if (t.includes("@")) {
    locators = [`users/${t.replace(/\/+$/, "")}/drive`];
  } else if (/^(drives|sites|users|groups)\//.test(t)) {
    locators = [t.replace(/^\/+|\/+$/g, "")];
  } else if (/^[A-Za-z0-9._-]{5,}$/.test(t)) {
    locators = [`drives/${t}`];
  } else {
    console.error("✗ 无法识别输入：给站点 URL / 用户 UPN / 既有 locator");
    process.exit(1);
  }
  for (const locator of locators) {
    console.log(`\n▶ 校验 locator：${locator}`);
    const r = await call(`${endpoint}/v1.0/${locator}?$select=id,webUrl,name`);
    if (r.status === 200 && r.json?.id) {
      console.log(`  ✓ 可达，drive id=${r.json.id}`);
      console.log(`  webUrl=${r.json.webUrl ?? "—"}`);
      console.log(`  → 表单「locator」粘贴：${locator}`);
      if (SAFE_ID.test(r.json.id))
        console.log(`  → 等价写法（可选）：drives/${r.json.id}`);
      else
        console.log(`  → drive id 含特殊字符，勿用 drives/… 写法，用上方完整 locator`);
    } else {
      console.log(stat(r, "  ✗"));
    }
  }
}

// ---- 探测菜单：无参时列出可达盘 / 用户 ----
async function menu() {
  console.log("无目标参数 → 探测应用到底能访问哪些资源（凭据已通过 token 校验）：\n");

  const org = await call(`${endpoint}/v1.0/organization?$select=id,displayName`);
  if (org.status === 200 && org.json?.value?.length) {
    const o = org.json.value[0];
    console.log(`✓ 租户可读：${o.displayName}（${o.id}）`);
  } else console.log(stat(org, "organization"));

  const drives = await call(`${endpoint}/v1.0/drives?$top=20&$select=id,name,driveType,webUrl`);
  if (drives.status === 200 && drives.json?.value?.length) {
    console.log(`\n✓ 应用可见的文档库 / 驱动器（/drives）共 ${drives.json.value.length} 个：`);
    for (const d of drives.json.value) {
      const ok = SAFE_ID.test(d.id) ? "" : "  （id 含特殊字符，改用站点 locator）";
      console.log(`  • ${d.name ?? d.driveType ?? "?"} [${d.driveType}]`);
      console.log(`      drives/${d.id}${ok}`);
      if (d.webUrl) console.log(`      ${d.webUrl}`);
    }
  } else console.log(stat(drives, "/drives"));

  const sitesRoot = await call(`${endpoint}/v1.0/sites/root?$select=id,name,webUrl`);
  console.log(`\n${stat(sitesRoot, "/sites/root")}`);
  if (sitesRoot.status === 200 && sitesRoot.json?.id) {
    console.log(`  root site id=${sitesRoot.json.id} webUrl=${sitesRoot.json.webUrl ?? "—"}`);
    const dr = await call(`${endpoint}/v1.0/sites/root/drive?$select=id,webUrl`);
    if (dr.status === 200 && dr.json?.id) {
      console.log(`  → 根站文档库 drive id=${dr.json.id}`);
      if (SAFE_ID.test(dr.json.id)) console.log(`  → locator：drives/${dr.json.id}`);
    } else console.log(stat(dr, "  /sites/root/drive"));
  }

  const users = await call(`${endpoint}/v1.0/users?$top=8&$select=id,userPrincipalName,displayName`);
  if (users.status === 200 && users.json?.value?.length) {
    console.log(`\n✓ /users 可读（前 ${users.json.value.length} 个）：`);
    for (const u of users.json.value)
      console.log(`  • ${u.displayName} <${u.userPrincipalName}> → users/${u.userPrincipalName}/drive`);
  } else console.log(stat(users, "/users"));

  console.log(
    "\n提示：/drives、/users、/organization 若都 403/401，说明应用在 Azure 里还没被授予对应的",
    "应用程序权限（Files.ReadWrite.All 或 Sites.ReadWrite.All 等）或尚未同意——后台测试连通也过不了。",
  );
}

const arg = (process.argv[2] ?? "").trim();
if (arg) await checkTarget(arg);
else await menu();
