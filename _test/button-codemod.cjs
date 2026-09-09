// Button codemod v3(稳健版):
// 1) 标签替换 <button → <Button、</button> → </Button>,props 原样。
// 2) import 注入:插到文件最后一个顶层 import 语句的下一行(逐行找,多行 import 以分号/from 结束为准)。
//    对 "use client" + 多个 import 块均适用;只处理行首(trim 后)以 import 开头的语句块。
// 3) 立即写回。随后清理不再使用的 BTN_* import。
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
const SELF = (f) => /components[/\\]ui[/\\]Button\.tsx$/.test(f);
const BTN_IMPORT = 'import { Button } from "@/components/ui/Button";';

function injectButtonImport(src) {
  if (/import\s*\{[^}]*\bButton\b[^}]*\}\s*from\s*["']@\/components\/ui\/Button["']/.test(src)) return src;
  const lines = src.split("\n");
  let insertIdx = 0;
  // 找最后一个完整 import 语句的结束行
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t.startsWith("import ")) continue;
    // 从 i 开始拼,直到遇到 from "..." 且该行以 ; 结尾(或整段结束)
    let j = i;
    let merged = t;
    while (j < lines.length - 1 && !/from\s+["'][^"']*["']\s*;?\s*$/.test(merged)) {
      j++;
      merged += " " + lines[j].trim();
    }
    insertIdx = j + 1;
    i = j;
  }
  lines.splice(insertIdx, 0, BTN_IMPORT);
  return lines.join("\n");
}

let tagFiles = 0;
let tagCount = 0;
for (const f of all) {
  if (SELF(f)) continue;
  let src = fs.readFileSync(f, "utf8");
  if (!/<button\b/.test(src)) continue;
  tagFiles++;
  tagCount += (src.match(/<button\b/g) || []).length;
  src = src.replace(/<\/button>/g, "</Button>").replace(/<button\b/g, "<Button");
  src = injectButtonImport(src);
  fs.writeFileSync(f, src);
}

// 清理 unused BTN_* import
let clean = 0;
for (const f of all) {
  if (SELF(f)) continue;
  let src = fs.readFileSync(f, "utf8");
  if (!/from\s*["']@\/lib\/ui\/cls["']/.test(src)) continue;
  const lines = src.split("\n");
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t.startsWith("import ") || !/from\s*["']@\/lib\/ui\/cls["']/.test(t)) continue;
    const brace = lines[i].match(/\{([^}]*)\}/);
    if (!brace) continue;
    const names = brace[1].split(",").map((s) => s.trim().replace(/^type\s+/, "")).filter(Boolean);
    if (!names.length) continue;
    const rest = lines.filter((_, k) => k !== i).join("\n");
    const keep = names.filter((nm) => new RegExp(`\\b${nm}\\b`).test(rest));
    if (keep.length === names.length) continue;
    if (!keep.length) lines.splice(i, 1);
    else lines[i] = lines[i].replace(/\{([^}]*)\}/, `{ ${keep.join(", ")} }`);
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(f, lines.join("\n"));
    clean++;
  }
}
console.log(`tag files: ${tagFiles}, opens: ${tagCount}, import-cleaned: ${clean}`);
