// 建议审核的纯函数：逐字段决策记录 + 把"只改动选中字段"的完整资源编辑表单构造出来。
// 接受时委托 updateResourceAdminAction（而不是直接写 Resource），故需重建与人工改稿一致的表单。
import { parseMeta } from "@/lib/meta";

export type SuggestionDecision = { accepted: string[]; rejected: string[] };

/** 解析 decisionJson；损坏或为空一律回退为全未处理。 */
export function parseSuggestionDecision(raw: string | null | undefined): SuggestionDecision {
  if (!raw) return { accepted: [], rejected: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<SuggestionDecision>;
    return {
      accepted: Array.isArray(parsed.accepted)
        ? parsed.accepted.filter((x): x is string => typeof x === "string")
        : [],
      rejected: Array.isArray(parsed.rejected)
        ? parsed.rejected.filter((x): x is string => typeof x === "string")
        : [],
    };
  } catch {
    return { accepted: [], rejected: [] };
  }
}

/** 记录某字段的接受/拒绝；同名字段互斥（后决定覆盖先决定）。 */
export function mergeSuggestionDecision(
  current: SuggestionDecision,
  field: string,
  decision: "accepted" | "rejected",
): SuggestionDecision {
  const accepted = new Set(current.accepted);
  const rejected = new Set(current.rejected);
  accepted.delete(field);
  rejected.delete(field);
  (decision === "accepted" ? accepted : rejected).add(field);
  return { accepted: [...accepted], rejected: [...rejected] };
}

type ResourceForSuggestion = {
  id: string;
  type: "GAME" | "IMAGE" | "ARTICLE";
  title: string;
  summary: string | null;
  description: string;
  categoryId: string | null;
  externalUrl: string | null;
  nsfw: boolean;
  loginRequired: boolean;
  allowComments: boolean;
  isDownloadable: boolean;
  coverMediaId: string | null;
  meta: string | null;
  tags: Array<{ tag: { name: string } }>;
  media: Array<{ id: string }>;
};

function setOn(form: FormData, name: string, enabled: boolean): void {
  if (enabled) form.set(name, "on");
}

/**
 * 用当前资源现状重建一张完整表单，再仅把 selected.field 覆盖为 selected.value。
 * 其余可见性开关、meta、媒体顺序/封面、标签均原样保留，保证只改目标字段。
 */
export function buildResourceSuggestionForm(
  resource: ResourceForSuggestion,
  selected: { field: string; value: string },
): FormData {
  const form = new FormData();
  form.set("id", resource.id);
  form.set("title", resource.title);
  form.set("summary", resource.summary ?? "");
  form.set("description", resource.description);
  form.set("categoryId", resource.categoryId ?? "");
  form.set("externalUrl", resource.externalUrl ?? "");
  form.set("tags", resource.tags.map((item) => item.tag.name).join(","));
  form.set("mediaIds", JSON.stringify(resource.media.map((media) => media.id)));
  form.set("coverId", resource.coverMediaId ?? "");
  setOn(form, "nsfw", resource.nsfw);
  setOn(form, "loginRequired", resource.loginRequired);
  setOn(form, "allowComments", resource.allowComments);
  setOn(form, "isDownloadable", resource.isDownloadable);

  const meta = parseMeta(resource.type, resource.meta);
  form.set("license", meta.license);
  if (meta.kind === "GAME") {
    form.set("version", meta.version ?? "");
    form.set("size", meta.size ?? "");
    form.set("platforms", (meta.platforms ?? []).join(","));
    form.set("lang", meta.lang ?? "");
    form.set("note", meta.note ?? "");
  } else {
    form.set("downloads", JSON.stringify(meta.downloads));
    if (meta.kind === "IMAGE") {
      setOn(form, "isAiGenerated", meta.isAiGenerated);
      form.set("aiTool", meta.aiTool ?? "");
      form.set("aiModel", meta.aiModel ?? "");
      setOn(form, "original", meta.original);
      form.set("sourceNote", meta.sourceNote ?? "");
    }
  }

  // 布尔字段建议用 on/off 语义写回；字符串字段直接覆盖。
  const booleanFields = new Set(["isAiGenerated", "original"]);
  if (booleanFields.has(selected.field)) {
    form.delete(selected.field);
    setOn(
      form,
      selected.field,
      selected.value === "true" || selected.value === "on" || selected.value === "1",
    );
  } else if (form.has(selected.field)) {
    form.set(selected.field, selected.value);
  }
  return form;
}
