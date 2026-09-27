// 音视频封面抽帧 —— 上传视频后从文件里取一帧当封面。
//
// 【为什么这里只剩抽帧】原来本文件还负责「读内嵌标签（ID3 / MP4 ilst）+ 读时长与分辨率」，
// 用来自动填作者的时长 / 艺术家 / 分辨率三个字段。那三个字段已整体取消（作者不需要手填、
// 也不在详情页展示），文件自带标签与分辨率因此没有任何落库去处，相关解析全部删除。
// 播放器里的进度时长是媒体元素自己报的（见 detail/av-controls.tsx），与这里无关。
//
// 为什么在浏览器里抽：服务端不接触浏览器直传的大文件（字节直接进云盘），拿不到画面；
// 而 `<video>` + canvas 是唯一不依赖 ffmpeg 的通用解。

/** 抽帧目标时间：取 10% 处（上限 3s）而不是第 0 帧——不少视频首帧是纯黑或台标空白 */
function posterTime(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 1) return 0;
  return Math.min(duration * 0.1, 3);
}

/**
 * 从本地视频文件抽一帧当封面，返回可直接上传的 JPEG File；抽不到返回 null。
 *
 * 输出宽度压到 maxWidth（默认 1280）：封面卡片是 3:4 小图，原尺寸抽出来纯属浪费流量，
 * 服务端还会再压缩一次（见 compressWith），这里只做粗裁。
 */
export async function capturePoster(
  file: File,
  maxWidth = 1280,
  timeoutMs = 12000,
): Promise<File | null> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  try {
    // preload=metadata 拿不到可绘制的帧，必须让浏览器解码
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.src = url;

    const ready = await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), timeoutMs);
      const end = (v: boolean) => {
        clearTimeout(t);
        resolve(v);
      };
      video.onloadedmetadata = () => end(true);
      video.onerror = () => end(false);
    });
    if (!ready || !video.videoWidth || !video.videoHeight) return null;

    const at = posterTime(video.duration);
    if (at > 0) {
      const seeked = await new Promise<boolean>((resolve) => {
        const t = setTimeout(() => resolve(false), timeoutMs);
        video.onseeked = () => {
          clearTimeout(t);
          resolve(true);
        };
        video.currentTime = at;
      });
      // seek 失败时退回当前帧（通常就是首帧），总比完全没有封面强
      if (!seeked) return null;
    }

    const w = Math.max(1, Math.min(video.videoWidth, maxWidth));
    const h = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * w));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d");
    if (!g) return null;
    g.drawImage(video, 0, 0, w, h);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );
    if (!blob) return null;
    const base = file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "video";
    return new File([blob], `${base}-封面.jpg`, { type: "image/jpeg" });
  } catch {
    return null;
  } finally {
    video.removeAttribute("src");
    URL.revokeObjectURL(url);
  }
}
