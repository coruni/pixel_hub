// 临时校验（无浏览器）：把 ImageViewer 用 3 张图渲染成 HTML，检查上一张/下一张的接线与边界态。
// 用完即删。
import { renderToStaticMarkup } from "react-dom/server";
import ImageViewer from "@/components/ui/ImageViewer";

const images = [
  { url: "/a.webp", width: 800, height: 600 },
  { url: "/b.webp", width: 800, height: 600 },
  { url: "/c.webp", width: 800, height: 600 },
];

const strip = (html: string) =>
  html
    .replace(/<svg[\s\S]*?<\/svg>/g, "<svg/>")
    .replace(/class="[^"]*"/g, "")
    .replace(/\s+/g, " ");

for (const i of [0, 1, 2]) {
  const html = renderToStaticMarkup(
    <ImageViewer images={images} index={i} onIndexChange={() => {}} onClose={() => {}} />,
  );
  const prevBtn = html.match(/<button[^>]*aria-label="上一张"[^>]*>/)?.[0] ?? "缺失";
  const nextBtn = html.match(/<button[^>]*aria-label="下一张"[^>]*>/)?.[0] ?? "缺失";
  console.log(`index=${i}`);
  console.log("  上一张:", prevBtn.replace(/class="[^"]*"/, "").trim());
  console.log("  下一张:", nextBtn.replace(/class="[^"]*"/, "").trim());
  console.log("  当前图:", html.match(/<img[^>]*src="([^"]+)"/)?.[1] ?? "缺失");
  console.log(
    "  禁用态:",
    prevBtn.includes("pointer-events-none") ? "上一张禁用" : "上一张可用",
    "/",
    nextBtn.includes("pointer-events-none") ? "下一张禁用" : "下一张可用",
  );
}

// 单图：不应出现切换按钮
const single = renderToStaticMarkup(
  <ImageViewer images={[images[0]]} index={0} onIndexChange={() => {}} onClose={() => {}} />,
);
console.log("单图时是否渲染切换按钮:", /aria-label="上一张"/.test(single));
console.log("样例 HTML 片段:", strip(single).slice(0, 160));
