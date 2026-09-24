// fontkit 2.x 不自带类型声明（dist 里只有 .cjs/.mjs）。这里只声明本项目用到的那一点面。
//
// 注意 import 形式：fontkit 的 ESM 产物（dist/module.mjs）**只有具名导出** create/open/…，
// 没有 default —— 写 `import fontkit from "fontkit"` 在 Turbopack 下会直接编译失败
// （实测 "Export default doesn't exist in target module"）。一律 `import * as` + 具名取用。
// 真正的表结构由 src/lib/media/watermark.ts 的 FontkitFont 收窄。
declare module "fontkit" {
  export function create(source: Uint8Array | ArrayBuffer): unknown;
}
