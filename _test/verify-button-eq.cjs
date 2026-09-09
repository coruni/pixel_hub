// 等价性验证:对比 HEAD 版本与工作区版本中每个 <button>/<Button> 的 className 表达式是否一致。
// 原理:codemod 只替换标签名 + 注入 import,不应改动任何 className 内容。
// 若某按钮 className 在替换前后不同,则输出警告。
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p).forEach((x) => out.push(x));
    else if (/\.tsx$/.test(ent.name)) out.push(p);
  }
  return out;
}

/** 提取每个 <button|Button 开标签的 className 表达式(仅简单/字符串/常量/模板截断,足够对比) */
function classExprs(src, tagName) {
  const out = [];
  const re = new RegExp(`<${tagName}\\b[\\s\\S]*?(/?>)`, "g");
  let m;
  while ((m = re.exec(src))) {
    const open = m[0];
    const cm = open.match(/\bclassName=\{?([^}]*)\}?/);
    const c = cm ? cm[1].trim().replace(/\s+/g, " ") : "(none)";
    out.push(c.slice(0, 400));
  }
  return out;
}

const ROOT = path.resolve("src");
let bad = 0;
let total = 0;
for (const f of walk(ROOT)) {
  if (/components[\\/]ui[\\/]Button\.tsx$/.test(f)) continue;
  const rel = path.relative(process.cwd(), f).replace(/\\/g, "/");
  let head;
  try {
    head = execSync(`git show HEAD:"${rel}"`, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  } catch {
    continue; // 新文件(如 feedback.tsx)
  }
  const cur = fs.readFileSync(f, "utf8");
  const oldExprs = classExprs(head, "button");
  const newExprs = classExprs(cur, "Button");
  if (oldExprs.length !== newExprs.length) {
    console.log(`COUNT MISMATCH ${rel}: old=${oldExprs.length} new=${newExprs.length}`);
    bad++;
    continue;
  }
  for (let i = 0; i < oldExprs.length; i++) {
    total++;
    if (oldExprs[i] !== newExprs[i]) {
      console.log(`CLASS DIFF ${rel} #${i}`);
      console.log(`  HEAD: ${oldExprs[i]}`);
      console.log(`  CUR : ${newExprs[i]}`);
      bad++;
    }
  }
}
console.log(`\nchecked ${total} buttons, mismatches: ${bad}`);
