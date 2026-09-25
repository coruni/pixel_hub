import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 构建/迁移临时备份目录（非源码，避免扫描产物与移除中的路由）
    ".next-bak-*/**",
    ".build-backup/**",
  ]),
  {
    // 自定义服务器与实时总线：由 Node 直接执行、不经 Next 编译器，
    // 必须是 CommonJS，不能用 ESM import（package.json 无 "type": "module"）。
    files: ["server.js", "server/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      // 服务器引导文件用 console 输出启动信息是刻意为之
      "no-console": "off",
    },
  },
]);

export default eslintConfig;
