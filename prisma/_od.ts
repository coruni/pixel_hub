// 临时探针：验证 /od 云盘出口既能「内联播放音视频」又能「附件照旧 302」。用完即删。
const BASE = "http://127.0.0.1:3000";
// CloudDrive 表里 active=true 的那条（附件 OneDrive-user）
const DRIVE = "cmtpnoouz000ft51g89lurj1c";
const ROOT = "pixelhub/202609";

let failed = 0;
function ok(name: string, cond: boolean, actual: unknown) {
  if (!cond) failed += 1;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name} — ${String(actual)}`);
}

async function main() {
  // ---- 1) 音频：必须内联 + 正确 MIME（上游给的是 octet-stream + attachment） ----
  const a = await fetch(`${BASE}/od/${DRIVE}/${ROOT}/track.mp3`);
  const ab = Buffer.from(await a.arrayBuffer());
  ok("mp3 → 200", a.status === 200, `HTTP ${a.status}`);
  ok("mp3 MIME 由本站裁定为 audio/mpeg", a.headers.get("content-type") === "audio/mpeg", a.headers.get("content-type"));
  ok("mp3 覆盖掉上游的 attachment", (a.headers.get("content-disposition") ?? "").startsWith("inline"), a.headers.get("content-disposition"));
  ok("mp3 声明 Accept-Ranges", a.headers.get("accept-ranges") === "bytes", a.headers.get("accept-ranges"));
  ok("mp3 字节完整", ab.length === 8 * 1024 * 1024, `${ab.length} bytes`);

  // ---- 2) Range → 206 + Content-Range（<video> 拖动进度条依赖） ----
  const r = await fetch(`${BASE}/od/${DRIVE}/${ROOT}/clip.mp4`, {
    headers: { range: "bytes=1024-2047" },
  });
  const rb = Buffer.from(await r.arrayBuffer());
  ok("mp4 Range → 206", r.status === 206, `HTTP ${r.status}`);
  ok("mp4 Content-Range 透传", r.headers.get("content-range") === `bytes 1024-2047/${8 * 1024 * 1024}`, r.headers.get("content-range"));
  ok("mp4 只回了请求的那 1024 字节", rb.length === 1024, `${rb.length} bytes`);
  ok("mp4 MIME 为 video/mp4", r.headers.get("content-type") === "video/mp4", r.headers.get("content-type"));
  ok("mp4 内联", (r.headers.get("content-disposition") ?? "").startsWith("inline"), r.headers.get("content-disposition"));

  // ---- 3) mkv：走内置 MIME 表（不在常见系统映射里，必须显式给） ----
  const m = await fetch(`${BASE}/od/${DRIVE}/${ROOT}/movie.mkv`);
  ok("mkv MIME 为 video/x-matroska", m.headers.get("content-type") === "video/x-matroska", m.headers.get("content-type"));
  await m.arrayBuffer().catch(() => {});

  // ---- 4) 附件：保持 302，不转发字节（省带宽这条路不能被顺手改掉） ----
  const z = await fetch(`${BASE}/od/${DRIVE}/${ROOT}/pack.zip`, { redirect: "manual" });
  ok("zip → 302", z.status === 302, `HTTP ${z.status}`);
  ok("zip 跳到预鉴权下载地址", z.headers.get("location") === "https://1drv.ms/fake-download", z.headers.get("location"));
  await z.arrayBuffer().catch(() => {});

  // ---- 5) 路径与参数校验没被削弱 ----
  const badId = await fetch(`${BASE}/od/bad!id/${ROOT}/a.mp3`);
  ok("非法 driveId → 400", badId.status === 400, `HTTP ${badId.status}`);
  const trav = await fetch(`${BASE}/od/${DRIVE}/${ROOT}/../secret.mp3`);
  ok("路径穿越 .. 被拒", trav.status === 400 || trav.status === 404, `HTTP ${trav.status}`);
  await trav.arrayBuffer().catch(() => {});
  const miss = await fetch(`${BASE}/od/cmzzzzzzzzzzzzzzzzzzzzzzz/${ROOT}/a.mp3`);
  ok("不存在的盘 → 404", miss.status === 404, `HTTP ${miss.status}`);
  await miss.arrayBuffer().catch(() => {});

  console.log(`\n${failed === 0 ? "全部通过" : failed + " 条失败"}`);
  process.exit(failed === 0 ? 0 : 1);
}

void main().catch((e) => {
  console.error("PROBE ERROR", e);
  process.exit(1);
});
