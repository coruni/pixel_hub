// 摸底 v3:精确提取每个 <button 的 className 表达式(正确处理嵌套 {})。
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve("src");
const all = [];
function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (/\.tsx$/.test(ent.name)) all.push(p);
  }
}
walk(ROOT);

/** 从 src 的 idx 处(指向 '{')读取配对的 JSX 表达式文本 */
function readExpr(src, idx) {
  let depth = 0;
  let i = idx;
  let inStr = null; // ' " `
  let esc = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") inStr = c;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(idx, i);
    }
  }
  return src.slice(idx);
}

const records = [];
for (const f of all) {
  const src = fs.readFileSync(f, "utf8");
  const re = /<button\b[\s\S]*?>/g;
  let m;
  while ((m = re.exec(src))) {
    const open = m[0];
    const pos = m.index;
    const line = src.slice(0, pos).split("\n").length;
    // 若 open 未闭合到真正的 >(className 内含 > ?),退化为:直接以 m 为开标签。
    const clsM = open.match(/\bclassName=\{/);
    let clsExpr = "";
    if (clsM) {
      const rel = clsM.index + "className={".length;
      const abs = pos + rel;
      clsExpr = readExpr(src, abs).trim();
    } else {
      const clsAttr = open.match(/\bclassName="([^"]*)"/);
      if (clsAttr) clsExpr = clsAttr[1].trim();
    }
    const typeM = open.match(/\btype="([^"]*)"/);
    records.push({
      file: path.relative(process.cwd(), f).replace(/\\/g, "/"),
      line,
      clsExpr: clsExpr.replace(/\s+/g, " ").slice(0, 300),
      type: typeM ? typeM[1] : "",
    });
  }
}
console.log("TOTAL:", records.length);
const byExpr = new Map();
for (const r of records) {
  if (!byExpr.has(r.clsExpr)) byExpr.set(r.clsExpr, []);
  byExpr.get(r.clsExpr).push(r);
}
const sorted = [...byExpr.entries()].sort((a, b) => b[1].length - a[1].length);
let n = 0;
for (const [k, items] of sorted) {
  n++;
  const head = items.slice(0, 4).map((i) => `${i.file}:${i.line}`).join("  ");
  console.log(`\n[${n}] ×${items.length}  ${k || "(空/多行拼接)"}`);
  console.log(`     ${head}`);
  if (items.length > 4) console.log(`     …共 ${items.length} 处`);
}
