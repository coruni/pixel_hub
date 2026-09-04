import Link from "next/link";
import { ArrowUpRight, Bell, Calendar, Megaphone } from "lucide-react";
import type { ReactNode } from "react";
import { getHomeStats } from "@/lib/home";
import { widgetTitle, type SidebarWidget } from "@/lib/site-config";
import { formatCount } from "@/lib/format";
import Markdown from "@/components/rte/Markdown";
import AdBlock, { type AdCfg } from "@/components/ads/AdBlock";
import { WidgetShell } from "../shell";

/** 静态类侧边栏组件：站点数据 / 说明 / 公告栏 / 自定义内容 / 广告位 */

export async function renderStats(w: SidebarWidget) {
  const stats = await getHomeStats();
  const items = [
    { label: "上架内容", v: stats.resources },
    { label: "注册用户", v: stats.users },
    { label: "累计下载", v: stats.downloads },
    { label: "累计浏览", v: stats.views },
  ];
  return (
    <WidgetShell title={widgetTitle(w)}>
      <div className="grid grid-cols-2 gap-2">
        {items.map((it) => (
          <div
            key={it.label}
            className="rounded-none border border-brand-200 bg-brand-50/40 px-2.5 py-2 text-center"
          >
            <div className="text-base font-semibold tabular-nums text-brand-700">
              {formatCount(it.v)}
            </div>
            <div className="text-[11px] text-neutral-400">{it.label}</div>
          </div>
        ))}
      </div>
    </WidgetShell>
  );
}

export function renderAbout(w: SidebarWidget) {
  const cfg = w.config as { text: string };
  const text = cfg.text?.trim();
  if (!text) return null;
  return (
    <WidgetShell title={widgetTitle(w)}>
      <p className="whitespace-pre-wrap text-xs leading-5 text-neutral-600">{text}</p>
    </WidgetShell>
  );
}

// ---------- 公告栏 ----------

const NOTICE_STYLES: Record<string, { box: string; icon: ReactNode }> = {
  info: {
    box: "border-sky-200 bg-sky-50/70 text-sky-900",
    icon: <Bell size={13} aria-hidden />,
  },
  warn: {
    box: "border-amber-200 bg-amber-50/70 text-amber-900",
    icon: <Megaphone size={13} aria-hidden />,
  },
  event: {
    box: "border-rose-200 bg-rose-50/70 text-rose-900",
    icon: <Calendar size={13} aria-hidden />,
  },
};

export function renderNotice(w: SidebarWidget) {
  const cfg = w.config as { items: { level: "info" | "warn" | "event"; text: string }[] };
  const items = (cfg.items ?? []).filter((n) => n.text?.trim());
  if (items.length === 0) return null;

  return (
    <WidgetShell title={widgetTitle(w)}>
      <ul className="space-y-1.5">
        {items.map((n, i) => {
          const s = NOTICE_STYLES[n.level] ?? NOTICE_STYLES.info;
          return (
            <li
              key={i}
              className={`flex items-start gap-2 rounded-none border px-2.5 py-2 text-xs leading-5 ${s.box}`}
            >
              <span className="mt-0.5 shrink-0 opacity-70">{s.icon}</span>
              <span className="min-w-0 whitespace-pre-wrap">{n.text}</span>
            </li>
          );
        })}
      </ul>
    </WidgetShell>
  );
}

// ---------- 自定义内容（Markdown + 链接列表） ----------

export function renderCustom(w: SidebarWidget) {
  const cfg = w.config as { content: string; links: { label: string; href: string }[] };
  const content = (cfg.content ?? "").trim();
  const links = Array.isArray(cfg.links) ? cfg.links : [];
  if (!content && links.length === 0) return null;
  return (
    <WidgetShell title={widgetTitle(w)}>
      {content && (
        <div className="md-body">
          <Markdown>{content}</Markdown>
        </div>
      )}
      {links.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {links.map((l, i) => {
            const ext = /^https?:\/\//i.test(l.href);
            return (
              <li key={`${l.href}-${i}`}>
                <Link
                  href={l.href}
                  target={ext ? "_blank" : undefined}
                  rel={ext ? "noopener noreferrer" : undefined}
                  className="group flex items-center gap-2 rounded-none px-2 py-1.5 text-sm text-neutral-700 transition hover:bg-brand-50 hover:text-neutral-900"
                >
                  <span className="min-w-0 flex-1 truncate">{l.label}</span>
                  {ext && (
                    <ArrowUpRight
                      size={12}
                      className="shrink-0 text-neutral-300 transition group-hover:text-neutral-500"
                      aria-hidden
                    />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetShell>
  );
}

// ---------- 广告位（图片+链接 或 HTML 片段，带「广告」角标；无内边距让横幅贴边） ----------

export function renderAd(w: SidebarWidget) {
  return <AdBlock cfg={w.config as AdCfg} />;
}
