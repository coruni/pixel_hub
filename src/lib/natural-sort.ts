// 自然排序（alphanumeric / 人类直觉排序）。
//
// 把字符串按「连续数字」和「非数字」切成小段，数字段按数值比较，
// 这样 "img2" 排在 "img10" 之前，而不是字典序的 "img10" < "img2"。
//
// 用途：拖拽 / 选择多张图片时，浏览器给的 FileList 顺序是混沌的——
// 既不保证与文件管理器展示顺序一致，不同浏览器甚至可能是反的。
// 上传前按文件名自然排序，保证图集 / 封面顺序稳定可预期。

/** 切分正则：每捕获组要么是连续数字，要么是一段非数字 */
const CHUNK_RE = /(\d+|\D+)/g;

function chunkCompare(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  const aNum = a !== "" && Number.isFinite(na);
  const bNum = b !== "" && Number.isFinite(nb);
  // 两段都是数字：按数值比较（"10" > "2"）
  if (aNum && bNum) return na - nb;
  // 否则按字典序（其中一段是数字、另一段不是时也走这里，行为稳定可预期）
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** 自然序比较两个字符串：数字按数值、其余按字典序，逐段比对 */
export function naturalCompare(a: string, b: string): number {
  const aChunks = a.match(CHUNK_RE) ?? [a];
  const bChunks = b.match(CHUNK_RE) ?? [b];
  const len = Math.max(aChunks.length, bChunks.length);
  for (let i = 0; i < len; i += 1) {
    const ac = aChunks[i] ?? "";
    const bc = bChunks[i] ?? "";
    const cmp = chunkCompare(ac, bc);
    if (cmp !== 0) return cmp;
  }
  return 0;
}

/**
 * 按文件名对一组带 name 的对象做自然排序，返回新数组（不修改入参）。
 * 泛型约束 `{ name: string }`，可直接吃 File[] / FileList 转换后的数组。
 */
export function sortFilesByNameNaturally<T extends { name: string }>(files: readonly T[]): T[] {
  return [...files].sort((x, y) => naturalCompare(x.name, y.name));
}
