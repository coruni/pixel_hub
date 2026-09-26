"use client";

// Milkdown 体积较大：仅在真正挂载编辑器的客户端组件中加载，避免详情页游客首包携带编辑器。
import dynamic from "next/dynamic";
import type { MdEditorProps } from "./MdEditor";

const LazyMdEditor = dynamic(() => import("./MdEditor"), {
  ssr: false,
  loading: () => (
    <div
      className="md-editor relative rounded-none border border-brand-200 bg-surface"
      style={{ minHeight: "6rem" }}
      aria-busy="true"
      aria-label="编辑器加载中"
    />
  ),
});

export default function MdEditorLazy(props: MdEditorProps) {
  return <LazyMdEditor {...props} />;
}
