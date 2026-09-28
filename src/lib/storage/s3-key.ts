// 多桶下的「落库值 → 桶 + 桶内 key」反解（纯函数，无配置/网络依赖，便于直接断言）。
//
// 为什么需要它：put 落库的是**完整 URL**（桶信息藏在 URL 里），所以换桶/加桶不影响存量数据；
// 但 get/size/del 拿到的是一个字符串，必须还原出「哪个桶 + 桶内 key」才能发请求。
// 反解不中时退回主桶尽力而为 —— 删除本就是 best-effort，宁可删空也不能删错另一个桶的同名对象：
// 因此只认「命中某个桶的公开基址 / Endpoint+Bucket」与「path-style 的 /<bucket>/<key>」两种情况。
export type ResolvableBucket = {
  id: string;
  bucket: string;
  endpoint: string;
  /** 公开访问基址（末尾斜杠可有可无） */
  publicBase: string;
};

export type S3Target = { id: string; objectKey: string };

const trimSlash = (v: string) => v.replace(/\/+$/, "");

/** key 命中某个基址前缀时返回桶内对象 key（无命中返回 null） */
function hit(key: string, base: string): string | null {
  const b = trimSlash(base);
  return b && key.startsWith(`${b}/`) ? key.slice(b.length + 1) : null;
}

function decodeOnce(v: string): string {
  try {
    const d = decodeURIComponent(v);
    return d === v ? v : d;
  } catch {
    return v; // 非法百分号编码：保持原样
  }
}

/**
 * @param key 落库值：相对 key（`images/202609/xxx.webp`）或完整 URL
 * @param specs 生效桶清单，**specs[0] 必须是主桶**（相对 key 一律归主桶）
 */
export function resolveS3Target(key: string, specs: ResolvableBucket[]): S3Target | null {
  const primary = specs[0];
  if (!primary) return null;
  if (!key) return null;
  if (!/^https?:\/\//i.test(key)) {
    return { id: primary.id, objectKey: key.replace(/^\/+/, "") };
  }

  // 浏览器/邮件客户端可能重新编码过 URL 里的非 ASCII 键，两种形态都试一次
  const forms = [key];
  const decoded = decodeOnce(key);
  if (decoded !== key) forms.push(decoded);

  let best: S3Target | null = null;
  let bestLen = -1;
  for (const form of forms) {
    for (const spec of specs) {
      const bases = [
        spec.publicBase,
        spec.endpoint ? `${trimSlash(spec.endpoint)}/${spec.bucket}` : "",
      ];
      for (const base of bases) {
        const objectKey = hit(form, base);
        // 取**最长**命中：一个基址可能是另一个的前缀（如同一 Endpoint 下不同桶）
        if (objectKey !== null && trimSlash(base).length > bestLen) {
          best = { id: spec.id, objectKey };
          bestLen = trimSlash(base).length;
        }
      }
    }
  }
  if (best) return best;

  // path-style 的 <origin>/<bucket>/<key>（公开基址填的是纯域名时走这里）
  const path = (() => {
    try {
      return decodeOnce(new URL(key).pathname.replace(/^\/+/, ""));
    } catch {
      return "";
    }
  })();
  const [head, ...rest] = path.split("/");
  const byName = specs.find((s) => s.bucket === head);
  if (byName && rest.length > 0) return { id: byName.id, objectKey: rest.join("/") };

  return { id: primary.id, objectKey: path };
}
