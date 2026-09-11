# Pixel Hub —— 长期项目约定

## 图片压缩（重要，改动前必读）
- 所有服务端图片压缩必须走 `src/lib/media/compress.ts` 的 `compressWith()`，禁止在业务代码里直接写 `.webp()/.jpeg()/.png()`。
- alpha 通道规则：webp 锁定 `alphaQuality: 100`；png `quality<100` 用 `palette: true` 量化（带 alpha 支持）、`quality=100` 走无损；jpg 无 alpha，必须先 `flatten({ background: "#ffffff" })` 合成白底再编码（否则透明区域变黑）。
- 压缩参数来源：`SiteSetting["uploadLimits"]` 的 `imageFormat`（webp/jpg/png，默认 webp）与 `imageQuality`（1..100，默认 82），后台入口 `/admin/uploads` 的「图片压缩」区块。
- 缩略图质量 = 主图质量 − 8（下限 40，默认 82 → 74），保持与原硬编码值一致。
- 落盘 key 的扩展名必须与输出格式一致（local/s3/chevereto 驱动按 key 扩展名识别 content-type）。
- 回归验证：`npx tsx _test/compress-alpha.ts`（断言 webp/png 保留 alpha、jpg 合白底、缩略图降档）。

## ImageViewer（src/components/ui/ImageViewer.tsx）
- 平移能力按「可平移空间」（`panBounds`/`canPan`）判定，不用 `zoom > 1` 当代理条件：缩小时同样可拖动。
- 位移必须在 `applyZoom`/`rotateBy` 后重新夹取，否则放大拖动后再缩回会停在偏移位置。
- react-hooks v7 的 immutability 规则不允许在 useCallback/useEffect 中写 `useRef.current`（仅 useLayoutEffect 内允许），需要随渲染变化的镜像值优先直接读 state。
