// 逆向 codemod:撤销 Button 标签替换与注入,恢复原状(供修复后重跑)。
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
let n = 0;
for (const f of all) {
  if (/components[/\\]ui[/\\]Button\.tsx$/.test(f)) continue;
  let src = fs.readFileSync(f, "utf8");
  const before = src;
  // 1) 删除注入的 Button import 行(含被错误插入在中间的情况)
  src = src
    .split("\n")
    .filter((l) => !/^\s*import\s*\{[^}]*Button[^}]*\}\s*from\s*["']@\/components\/ui\/Button["']\s*;?\s*$/.test(l))
    .join("\n");
  // 2) 标签还原
  src = src.replace(/<\/Button>/g, "</button>").replace(/<Button\b/g, "<button");
  if (src !== before) {
    fs.writeFileSync(f, src);
    n++;
  }
}
console.log("reverted files:", n);
