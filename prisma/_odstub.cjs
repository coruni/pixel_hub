// 临时桩：把 Graph 拦成一个「故意不友好」的假上游（注入方式 NODE_OPTIONS=--require）。
// 故意做两件坏事，用来证明 /od 路由确实自己裁定了响应头：
//   1. Content-Type 一律 application/octet-stream（若路由不自裁 MIME，<video> 会拒绝解码）
//   2. Content-Disposition: attachment（若路由不覆盖，浏览器会存盘而不是内联播放）
// 同时支持 Range → 206，用来验证拖动进度条所需的透传。用完即删。
const BIG = Buffer.alloc(8 * 1024 * 1024, 0x41); // 8MB 假音视频

globalThis.fetch = async function (input, init) {
  const url =
    typeof input === "string" ? input : input && input.url ? input.url : String(input);
  const hdrs = new Headers((init && init.headers) || (input && input.headers) || undefined);

  // 1) 令牌端点：给出假 token
  if (url.includes("login.microsoftonline.com")) {
    return new Response(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  if (url.includes("fake.local")) {
    // 2) 元数据查询（?select=id,@microsoft.graph.downloadUrl）
    if (url.includes("select=")) {
      return new Response(
        JSON.stringify({ id: "item1", "@microsoft.graph.downloadUrl": "https://1drv.ms/fake-download" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    // 3) /content 直读（支持 Range）
    if (url.includes("/content")) {
      const range = hdrs.get("range");
      const bad = {
        "content-type": "application/octet-stream",
        "content-disposition": "attachment; filename=upstream-name.bin",
      };
      if (range) {
        const m = /bytes=(\d+)-(\d*)/.exec(range);
        const start = Number(m && m[1]);
        const end = m && m[2] ? Math.min(Number(m[2]), BIG.length - 1) : BIG.length - 1;
        const slice = BIG.subarray(start, end + 1);
        return new Response(slice, {
          status: 206,
          headers: {
            ...bad,
            "content-range": `bytes ${start}-${end}/${BIG.length}`,
            "content-length": String(slice.length),
          },
        });
      }
      return new Response(BIG, {
        status: 200,
        headers: { ...bad, "content-length": String(BIG.length), "accept-ranges": "bytes" },
      });
    }
  }
  return new Response("not found", { status: 404 });
};

console.log("[od-stub] 假 Graph 已注入");
