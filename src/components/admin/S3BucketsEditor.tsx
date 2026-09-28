"use client";

// 备用存储桶编辑器（站点配置 → 存储）：主桶之外的 S3 桶列表。
//
// 为什么主桶仍留在上面那一组固定的输入框里：单桶是绝大多数部署的现状，把它塞进列表会
// 让「什么都没配」的升级路径多出一层折叠/空态。这里只负责**增量**部分，且不引任何
// 服务端模块（S3_MAX_EXTRA_BUCKETS 来自 storage/bucket-limits），免得把 prisma 打进浏览器包。
//
// 每个备用桶都是**完全独立的一份配置**：只填桶名 = 同账号多桶（其余继承主桶）；
// 换成别人的账号/服务商，就把 Endpoint、Region、凭据、公开基址各填各的。
// 可见性与寻址风格用下拉而不是勾选框：这两项都要能表达「跟随主桶」，
// 布尔分不出「没填」和「填了否」。
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SquareCheckbox } from "@/components/admin/SquareCheckbox";
import { INPUT, LABEL_STRONG } from "@/lib/ui/cls";
import { S3_MAX_EXTRA_BUCKETS } from "@/lib/storage/bucket-limits";
import type { S3BucketEntry } from "@/lib/runtime-config";

export function emptyBucketEntry(): S3BucketEntry {
  return {
    label: "",
    bucket: "",
    endpoint: "",
    region: "",
    publicBase: "",
    accessKeyId: "",
    secretAccessKey: "",
    aclMode: "",
    urlStyle: "",
    full: false,
  };
}

export default function S3BucketsEditor({
  buckets,
  onChange,
  primaryAclPrivate,
}: {
  buckets: S3BucketEntry[];
  onChange: (next: S3BucketEntry[]) => void;
  /** 主桶是否为私有桶：用于把「跟随主桶」的**实际结果**直接写在选项里 */
  primaryAclPrivate: boolean;
}) {
  const patch = (i: number, next: Partial<S3BucketEntry>) =>
    onChange(buckets.map((b, j) => (j === i ? { ...b, ...next } : b)));
  const remove = (i: number) => onChange(buckets.filter((_, j) => j !== i));

  return (
    <div className="border-t border-dashed border-brand-300 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-neutral-900">备用存储桶</h4>
        <span className="text-[11px] text-neutral-400">
          上传顺序：主桶 → 备用桶 1…N，标记「已满」的整桶跳过
        </span>
        <span className="ml-auto">
          <Button
            type="button"
            onClick={() => onChange([...buckets, emptyBucketEntry()])}
            disabled={buckets.length >= S3_MAX_EXTRA_BUCKETS}
            variant="ghost"
          >
            <Plus size={12} aria-hidden /> 添加存储桶
          </Button>
        </span>
      </div>

      {buckets.length === 0 ? (
        <p className="mt-2 text-xs leading-5 text-neutral-400">
          未配置备用桶：所有上传写主桶（与升级前行为一致）。
          主桶写满后可在此追加新桶并回到上方勾选「主桶已满」，上传即自动切到下一个。
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {buckets.map((b, i) => (
            <li key={i} className="border border-brand-200 bg-surface p-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-sm font-medium text-neutral-900">
                  {b.label || b.bucket || `备用桶 ${i + 1}`}
                </span>
                {b.full ? (
                  <span className="text-[11px] text-amber-600">已满 · 上传时跳过</span>
                ) : b.bucket.trim() ? (
                  <span className="text-[11px] text-neutral-400">参与上传</span>
                ) : (
                  <span className="text-[11px] text-amber-600">未填桶名 · 保存时忽略</span>
                )}
                <span className="ml-auto">
                  <Button type="button" onClick={() => remove(i)} variant="dangerGhost">
                    <Trash2 size={12} aria-hidden /> 删除
                  </Button>
                </span>
              </div>

              <div className="mt-3 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor={`s3b-${i}-label`} className={LABEL_STRONG}>
                      名称（可选）
                    </label>
                    <input
                      id={`s3b-${i}-label`}
                      value={b.label}
                      onChange={(e) => patch(i, { label: e.target.value })}
                      className={INPUT}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="例：R2 二号桶"
                    />
                  </div>
                  <div>
                    <label htmlFor={`s3b-${i}-bucket`} className={LABEL_STRONG}>
                      Bucket
                    </label>
                    <input
                      id={`s3b-${i}-bucket`}
                      value={b.bucket}
                      onChange={(e) => patch(i, { bucket: e.target.value })}
                      className={INPUT}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="必填；留空的行不会保存"
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor={`s3b-${i}-endpoint`} className={LABEL_STRONG}>
                      Endpoint
                    </label>
                    <input
                      id={`s3b-${i}-endpoint`}
                      value={b.endpoint}
                      onChange={(e) => patch(i, { endpoint: e.target.value })}
                      className={INPUT}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="留空 = 与主桶同一 Endpoint；换服务商时必填"
                    />
                  </div>
                  <div>
                    <label htmlFor={`s3b-${i}-region`} className={LABEL_STRONG}>
                      Region
                    </label>
                    <input
                      id={`s3b-${i}-region`}
                      value={b.region}
                      onChange={(e) => patch(i, { region: e.target.value })}
                      className={INPUT}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="留空 = 与主桶相同"
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor={`s3b-${i}-ak`} className={LABEL_STRONG}>
                      Access Key ID
                    </label>
                    <input
                      id={`s3b-${i}-ak`}
                      value={b.accessKeyId}
                      onChange={(e) => patch(i, { accessKeyId: e.target.value })}
                      className={INPUT}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="留空 = 用主桶凭据"
                    />
                  </div>
                  <div>
                    <label htmlFor={`s3b-${i}-sk`} className={LABEL_STRONG}>
                      Secret Access Key
                    </label>
                    <input
                      id={`s3b-${i}-sk`}
                      type="password"
                      value={b.secretAccessKey}
                      onChange={(e) => patch(i, { secretAccessKey: e.target.value })}
                      className={INPUT}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="留空 = 用主桶凭据"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor={`s3b-${i}-base`} className={LABEL_STRONG}>
                    公开访问基址
                  </label>
                  <input
                    id={`s3b-${i}-base`}
                    value={b.publicBase}
                    onChange={(e) => patch(i, { publicBase: e.target.value })}
                    className={INPUT}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="留空用 Endpoint/Bucket 拼接；私有桶填 CDN 地址"
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor={`s3b-${i}-acl`} className={LABEL_STRONG}>
                      可见性
                    </label>
                    <select
                      id={`s3b-${i}-acl`}
                      value={b.aclMode}
                      onChange={(e) => patch(i, { aclMode: e.target.value as S3BucketEntry["aclMode"] })}
                      className={INPUT}
                    >
                      <option value="">
                        跟随主桶（当前：{primaryAclPrivate ? "私有桶" : "公开桶"}）
                      </option>
                      <option value="public">公开桶（上传时设 public-read）</option>
                      <option value="private">私有桶（不设 ACL，需 CDN 反代）</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor={`s3b-${i}-style`} className={LABEL_STRONG}>
                      寻址风格
                    </label>
                    <select
                      id={`s3b-${i}-style`}
                      value={b.urlStyle}
                      onChange={(e) => patch(i, { urlStyle: e.target.value as S3BucketEntry["urlStyle"] })}
                      className={INPUT}
                    >
                      <option value="">path-style（与主桶一致）</option>
                      <option value="virtual">virtual-host style</option>
                    </select>
                  </div>
                </div>
                <p className="text-[11px] leading-4 text-neutral-400">
                  MinIO / R2 与多数 S3 兼容网关需要 path-style（
                  <code>endpoint/bucket/key</code>）；阿里云 OSS 等只认 virtual-host style（
                  <code>bucket.endpoint/key</code>），连不上时切过去试试。
                </p>

                <label className="flex cursor-pointer items-start gap-2.5">
                  <SquareCheckbox
                    checked={b.full}
                    onChange={(next) => patch(i, { full: next })}
                    ariaLabel={`标记备用桶 ${i + 1} 已满`}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-sm text-neutral-900">已满</span>
                    <span className="mt-0.5 block text-xs text-neutral-400">
                      勾选后不再往这个桶写新文件（读取与下载旧文件不受影响）。
                    </span>
                  </span>
                </label>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-[11px] leading-4 text-neutral-400">
        最多 {S3_MAX_EXTRA_BUCKETS} 个备用桶。已落库的文件 URL 不变，增删备用桶只影响之后的上传；
        备用桶的公开访问域名会自动加入下载白名单。
      </p>
    </div>
  );
}
