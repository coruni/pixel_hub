// 多桶配置的共享常量：运行时校验（runtime-config 的 zod schema）与后台表单（客户端组件）
// 必须用同一个上限，否则表单能加出被 schema 静默截断的行。
// 本文件刻意不引任何服务端依赖（prisma / node:*），"use client" 组件可以安全 import。
export const S3_MAX_EXTRA_BUCKETS = 8;
