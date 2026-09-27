// 临时探针（用完即删）：用 postcss 实编 src/app/globals.css，确认本次新增的
// @utility 与颜色类真的产出了 CSS —— 只看源码看不出「类名写错 / 没被扫到」这类静默丢失。
import { readFileSync } from "node:fs";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

async function main() {
  const file = "src/app/globals.css";
  const css = readFileSync(file, "utf8");
  const out = (await postcss([tailwindcss()]).process(css, { from: file })).css;

  const cases: [string, RegExp][] = [
    // 本次新增的三个单边点划线 utility
    [".rule-dot-t 选择器", /\.rule-dot-t\s*\{/],
    [".rule-dot-b 选择器", /\.rule-dot-b\s*\{/],
    [".rule-dot-rows 选择器", /\.rule-dot-rows\s*\{/],
    // rule-dot-rows 的行间选择器必须落到子元素上
    [".rule-dot-rows > * + *", /\.rule-dot-rows\s*>\s*\* \+ \*\s*\{/],
    // 三个 utility 都要带上透明占位边框（保持盒模型）
    ["rule-dot-t 占位边框", /\.rule-dot-t\s*\{[^}]*border-top:\s*1px solid transparent/],
    ["rule-dot-b 占位边框", /\.rule-dot-b\s*\{[^}]*border-bottom:\s*1px solid transparent/],
    // 图案本体引用 --rule-dot
    ["utilities 引用 --rule-dot", /background-image:\s*var\(--rule-dot\)/],
    // :root 里 --rule-dot 与 .md-body hr 都要在
    [":root 定义 --rule-dot", /--rule-dot:\s*repeating-linear-gradient/],
    [".md-body hr 引用 --rule-dot", /\.md-body hr\s*\{[^}]*background-image:\s*var\(--rule-dot\)/],
    // 新的边框色阶真的要产出（Tailwind 只扫源码字面量）
    [".border-brand-300", /\.border-brand-300\s*\{/],
    [".hover\\:border-brand-500", /\.hover\\:border-brand-500:hover\s*\{/],
  ];

  let bad = 0;
  for (const [name, re] of cases) {
    const ok = re.test(out);
    if (!ok) bad++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  }
  console.log(`\n${cases.length - bad} PASS / ${bad} FAIL`);
  if (bad > 0) process.exitCode = 1;
}

void main();
