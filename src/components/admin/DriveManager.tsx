"use client";

import { useState } from "react";
import MiniBadge from "@/components/ui/MiniBadge";
import {
  CheckCircle2,
  HardDrive,
  Pencil,
  PlugZap,
  Plus,
  Save,
  Star,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  createDriveAction,
  deleteDriveAction,
  setActiveDriveAction,
  testDriveAction,
  updateDriveAction,
} from "@/lib/actions/drives";
import { useAction } from "@/lib/hooks";
import { BTN_DANGER_SM, BTN_GHOST_SM, BTN_PRIMARY_SM, INPUT_SM, LABEL_STRONG } from "@/lib/ui/cls";

export type DriveRow = {
  id: string;
  label: string;
  locator: string;
  rootPath: string;
  active: boolean;
  enabled: boolean;
  lastError: string | null;
  lastOkAt: string | null;
  refs: number;
};

const okAt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("zh-CN", { hour12: false }) : "—";

const locKind = (locator: string) =>
  locator.startsWith("drives/")
    ? "drives"
    : locator.startsWith("sites/")
      ? "sites"
      : locator.startsWith("users/")
        ? "users"
        : "?";

// ---------- 目标类型友好化：用户选类型，代码拼 locator ----------

type DriveKind = "user" | "site" | "drive" | "custom";

/** 每种目标类型的字段文案与提示；custom 暴露原始 locator 以兼容复杂路径 */
const KINDS: {
  id: DriveKind;
  label: string;
  field: string;
  ph: string;
  hint: string;
}[] = [
  {
    id: "user",
    label: "OneDrive（用户）",
    field: "用户邮箱 / UPN",
    ph: "erois@erois.onmicrosoft.com",
    hint: "写入该用户的个人 OneDrive「文件」视图。需应用权限 Files.ReadWrite.All 并已授予管理员同意。",
  },
  {
    id: "site",
    label: "SharePoint 站点库",
    field: "站点 ID",
    ph: "站点 GUID，如 6f2a…-…-… ",
    hint: "写入该 SharePoint 站点的默认文档库（界面显示名为「文档」）。需 Sites.ReadWrite.All 同意。",
  },
  {
    id: "drive",
    label: "指定驱动器 ID",
    field: "驱动器 ID",
    ph: "drive 的 id（从地址栏/Graph API 取得）",
    hint: "任意驱动器（含非默认文档库）。可用 GET /v1.0/drives 枚举取得 id。",
  },
  {
    id: "custom",
    label: "自定义（高级）",
    field: "locator（完整）",
    ph: "drives/<id> | sites/<id>/drive | users/<upn>/drive",
    hint: "手工填写完整 locator，支持复杂路径（如 sites/host:/sites/team:/drive）。",
  },
];

/** 由类型 + 值拼出存储层认识的 locator */
function composeLocator(kind: DriveKind, value: string): string {
  const v = value.trim();
  switch (kind) {
    case "user":
      return `users/${v}/drive`;
    case "site":
      return `sites/${v}/drive`;
    case "drive":
      return `drives/${v}`;
    case "custom":
      return v;
  }
}

/** 把已存 locator 反推回类型 + 值（复杂路径回退 custom，保证可无损编辑） */
function parseLocator(locator: string): { kind: DriveKind; value: string } {
  const t = locator;
  if (t.startsWith("users/") && t.endsWith("/drive"))
    return { kind: "user", value: t.slice("users/".length, -"/drive".length) };
  if (t.startsWith("drives/")) return { kind: "drive", value: t.slice("drives/".length) };
  if (t.startsWith("sites/") && t.endsWith("/drive")) {
    const mid = t.slice("sites/".length, -"/drive".length);
    // 简单单段站点 ID 用友好字段；含 : 或 / 的复杂路径回退自定义
    if (/^[A-Za-z0-9._-]+$/.test(mid)) return { kind: "site", value: mid };
  }
  return { kind: "custom", value: t };
}

/** 新建 / 编辑共用的目标选择器：类型按钮 + 按类型变的字段 + 实时拼出预览 */
function LocatorPicker({
  kind,
  setKind,
  value,
  setValue,
}: {
  kind: DriveKind;
  setKind: (k: DriveKind) => void;
  value: string;
  setValue: (v: string) => void;
}) {
  const meta = KINDS.find((k) => k.id === kind) ?? KINDS[0];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            onClick={() => {
              setKind(k.id);
              if (k.id !== kind) setValue("");
            }}
            className={kind === k.id ? BTN_PRIMARY_SM : BTN_GHOST_SM}
          >
            {k.label}
          </button>
        ))}
      </div>
      <div>
        <label className={LABEL_STRONG} htmlFor="loc-val">
          {meta.field}
        </label>
        <input
          id="loc-val"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={meta.ph}
          className={`${INPUT_SM} w-full sm:w-[28rem] ${kind === "custom" ? "font-mono text-xs" : ""}`}
        />
        <p className="mt-1 text-[11px] leading-4 text-neutral-400">{meta.hint}</p>
      </div>
    </div>
  );
}

export function DriveManager({
  rows,
  credsConfigured,
}: {
  rows: DriveRow[];
  credsConfigured: boolean;
}) {
  const { run, pending } = useAction();
  const [label, setLabel] = useState("");
  const [newKind, setNewKind] = useState<DriveKind>("user");
  const [newValue, setNewValue] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    label: string;
    kind: DriveKind;
    value: string;
    rootPath: string;
  }>({ label: "", kind: "user", value: "", rootPath: "" });

  const canCloud = credsConfigured;
  const newComposed = composeLocator(newKind, newValue);

  return (
    <div className="space-y-6">
      {!canCloud && (
        <div className="rounded-none border border-amber-300 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
          未配置 GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET：登记盘仅作占位，附件仍走
          STORAGE_DRIVER（local/s3/chevereto）。配置后到 .env 补全并重启即可启用。
        </div>
      )}

      {/* 新建 */}
      <section className="rounded-none border border-brand-200 bg-surface p-4">
        <h3 className="text-sm font-semibold text-neutral-900">登记驱动器</h3>
        <div className="mt-3 space-y-3">
          <div>
            <label className={LABEL_STRONG} htmlFor="nd-label">
              名称
            </label>
            <input
              id="nd-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="如：Erois OneDrive"
              className={`${INPUT_SM} w-72`}
            />
          </div>

          <LocatorPicker kind={newKind} setKind={setNewKind} value={newValue} setValue={setNewValue} />

          <div>
            <label className={LABEL_STRONG} htmlFor="nd-root">
              根目录（可选）
            </label>
            <input
              id="nd-root"
              value={rootPath}
              onChange={(e) => setRootPath(e.target.value)}
              placeholder="如 pixel-hub（留空则直接进驱动器根）"
              className={`${INPUT_SM} w-72`}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <code className="rounded-none bg-neutral-100 px-2 py-1 font-mono text-[11px] text-neutral-500">
              {newComposed || "（待填）"}
            </code>
            <button
              type="button"
              disabled={pending || !label.trim() || !newValue.trim()}
              onClick={() =>
                run(async () => {
                  const r = await createDriveAction({
                    label,
                    locator: newComposed,
                    rootPath,
                  });
                  if (r.ok) {
                    setLabel("");
                    setNewValue("");
                    setRootPath("");
                  }
                  return r;
                })
              }
              className={BTN_PRIMARY_SM}
            >
              <Plus size={13} /> 登记
            </button>
          </div>
        </div>
      </section>

      {/* 列表 */}
      <section className="rounded-none border border-brand-200 bg-surface p-4">
        <h3 className="text-sm font-semibold text-neutral-900">
          驱动器
          <span className="ml-1.5 text-xs font-normal text-neutral-400">
            {rows.length} 个 · 新附件写入活跃盘
          </span>
        </h3>
        {rows.length === 0 ? (
          <p className="mt-3 py-6 text-center text-sm text-neutral-400">
            还没有登记任何云盘。先登记一个，再点「设为活跃」。
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-neutral-100">
            {rows.map((r) => {
              const editing = editingId === r.id;
              return (
                <li key={r.id} className="py-3">
                  {editing ? (
                    <div className="space-y-3">
                      <div>
                        <label className={LABEL_STRONG} htmlFor="ed-label">
                          名称
                        </label>
                        <input
                          id="ed-label"
                          value={draft.label}
                          onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                          className={`${INPUT_SM} w-72`}
                          aria-label="名称"
                        />
                      </div>
                      <LocatorPicker
                        kind={draft.kind}
                        setKind={(k) => setDraft((d) => ({ ...d, kind: k }))}
                        value={draft.value}
                        setValue={(v) => setDraft((d) => ({ ...d, value: v }))}
                      />
                      <div>
                        <label className={LABEL_STRONG} htmlFor="ed-root">
                          根目录（可选）
                        </label>
                        <input
                          id="ed-root"
                          value={draft.rootPath}
                          onChange={(e) => setDraft((d) => ({ ...d, rootPath: e.target.value }))}
                          placeholder="留空则直接进驱动器根"
                          className={`${INPUT_SM} w-72`}
                          aria-label="根目录"
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            run(async () => {
                              const r2 = await updateDriveAction({
                                id: r.id,
                                label: draft.label,
                                locator: composeLocator(draft.kind, draft.value),
                                rootPath: draft.rootPath,
                              });
                              if (r2.ok) setEditingId(null);
                              return r2;
                            })
                          }
                          className={BTN_GHOST_SM}
                        >
                          <Save size={12} /> 保存
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => setEditingId(null)}
                          className={BTN_GHOST_SM}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="flex items-center gap-1.5 font-medium text-neutral-900">
                        <HardDrive size={14} className="text-neutral-400" aria-hidden />
                        {r.label}
                        {r.active && (
                          <MiniBadge>
                            <Star size={10} className="text-amber-500" aria-hidden /> 活跃
                          </MiniBadge>
                        )}
                      </span>
                      <span className="rounded-none bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] text-neutral-500">
                        {locKind(r.locator)} · {r.locator}
                      </span>
                      {r.rootPath && (
                        <span className="font-mono text-xs text-neutral-400">/{r.rootPath}</span>
                      )}
                      <MiniBadge>{r.refs} 引用</MiniBadge>
                      {!r.enabled && (
                        <span className="text-[11px] text-neutral-400">（已停用）</span>
                      )}
                      {r.lastError ? (
                        <span
                          className="inline-flex items-center gap-1 text-[11px] text-red-600"
                          title={r.lastError}
                        >
                          <TriangleAlert size={11} aria-hidden /> 上次失败
                        </span>
                      ) : r.lastOkAt ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
                          <CheckCircle2 size={11} aria-hidden /> {okAt(r.lastOkAt)} 连通
                        </span>
                      ) : null}
                      <span className="ml-auto flex flex-wrap items-center gap-2">
                        {!r.active && (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              run(() =>
                                setActiveDriveAction({ id: r.id }).then((res) => {
                                  if (res.ok)
                                    window.alert(
                                      `已切换活跃盘到「${r.label}」。之后的附件将写入该盘。`,
                                    );
                                  return res;
                                }),
                              )
                            }
                            className={BTN_PRIMARY_SM}
                          >
                            <Star size={12} /> 设为活跃
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            run(() =>
                              updateDriveAction({ id: r.id, enabled: !r.enabled }).then((res) => {
                                if (res.ok && r.active)
                                  window.alert(
                                    r.enabled
                                      ? "活跃盘已停用：新附件将回退 STORAGE_DRIVER，旧 /od 下载不受影响。"
                                      : "活跃盘已重新启用。",
                                  );
                                return res;
                              }),
                            )
                          }
                          className={BTN_GHOST_SM}
                        >
                          {r.enabled ? "停用" : "启用"}
                        </button>
                        {canCloud && (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => {
                              if (!window.confirm(`测试连通「${r.label}」？（会上传并删除一个临时文件）`))
                                return;
                              run(async () => {
                                const res = await testDriveAction({ id: r.id });
                                if (res.ok) window.alert("连通测试通过：上传→下载链接→删除 均成功。");
                                return res;
                              });
                            }}
                            className={BTN_GHOST_SM}
                          >
                            <PlugZap size={12} /> 测试连通
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => {
                            const p = parseLocator(r.locator);
                            setDraft({
                              label: r.label,
                              kind: p.kind,
                              value: p.value,
                              rootPath: r.rootPath,
                            });
                            setEditingId(r.id);
                          }}
                          className={BTN_GHOST_SM}
                        >
                          <Pencil size={12} /> 编辑
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => {
                            if (!window.confirm(`删除云盘「${r.label}」？（有引用的盘会被拒绝）`))
                              return;
                            run(() => deleteDriveAction({ id: r.id }));
                          }}
                          className={BTN_DANGER_SM}
                        >
                          <Trash2 size={12} /> 删除
                        </button>
                      </span>
                    </div>
                  )}
                  {r.lastError && (
                    <p className="mt-1 text-[11px] leading-4 text-neutral-400">
                      上次错误：{r.lastError}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
