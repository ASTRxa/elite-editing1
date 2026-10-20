"use client";

import { canvasFilterString } from "./format";
import { getAssetUrl } from "./media";
import { activeVideoClip, clipEnd } from "./timelineMath";
import type { Clip, EffectState, Track, TransformState } from "./types";

/**
 * Frame-by-frame canvas exporter. Paces itself at the target fps in wall
 * time and pipes frames through MediaRecorder, producing a real downloadable
 * WebM with the full effect stack baked in.
 */

export interface ExportSpec {
  tracks: Track[];
  clips: Clip[];
  effects: EffectState;
  transform: TransformState;
  start: number;
  end: number;
  width: number;
  height: number;
  fps: number;
  onProgress: (p: number) => void;
  token: { canceled: boolean };
}

const pickMime = (): string | null =>
  ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) =>
    typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)
  ) ?? null;

function buildNoiseTile(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(Math.random() * 255);
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 26;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function seekTo(v: HTMLVideoElement, t: number, timeoutMs = 1400): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      v.removeEventListener("seeked", finish);
      clearTimeout(to);
      resolve();
    };
    const to = setTimeout(finish, timeoutMs);
    v.addEventListener("seeked", finish);
    if (Math.abs(v.currentTime - t) > 0.004) v.currentTime = t;
    else finish();
  });
}

function whenCanPlay(v: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    if (v.readyState >= 2) return resolve();
    const to = setTimeout(() => reject(new Error("media load timeout")), 8000);
    v.oncanplay = () => {
      clearTimeout(to);
      resolve();
    };
    v.onerror = () => {
      clearTimeout(to);
      reject(new Error("media failed to load"));
    };
  });
}

export async function exportWebM(spec: ExportSpec): Promise<Blob> {
  const { tracks, clips, effects, transform, start, end, width, height, fps } = spec;
  const mime = pickMime();
  if (!mime) throw new Error("MediaRecorder WebM is not supported in this browser");

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("No 2D context available");
  // graded export requires canvas filter support (Chromium / Firefox)
  ctx.filter = "saturate(1)";
  if (!ctx.filter || ctx.filter === "none") {
    throw new Error("Canvas filter is unsupported here — export needs Chromium or Firefox");
  }

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  const stream = canvas.captureStream(fps);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const filter = canvasFilterString(effects);
  const noise = buildNoiseTile();
  const totalFrames = Math.max(1, Math.round((end - start) * fps));
  const frameMs = 1000 / fps;
  let currentUrl = "";

  rec.start(250);
  const t0 = performance.now();

  try {
    for (let i = 0; i < totalFrames; i++) {
      if (spec.token.canceled) throw new Error("canceled");
      const t = start + i / fps;

      // base frame
      ctx.filter = "none";
      ctx.fillStyle = "#05060a";
      ctx.fillRect(0, 0, width, height);

      const av = activeVideoClip(tracks, clips, t);
      const url = av ? getAssetUrl(av.clip.assetId) : null;
      if (av && url) {
        if (currentUrl !== url) {
          video.src = url;
          currentUrl = url;
          await whenCanPlay(video).catch(() => undefined);
        }
        const srcT = Math.min(
          Math.max(0, av.clip.offset + (t - av.clip.start) * av.clip.speed),
          Math.max(0, video.duration - 0.05 || Number.MAX_SAFE_INTEGER)
        );
        await seekTo(video, srcT);

        if (video.readyState >= 2 && video.videoWidth > 0) {
          ctx.save();
          ctx.filter = filter;
          ctx.globalAlpha = transform.opacity;
          // contain-fit inside the frame
          const va = video.videoWidth / video.videoHeight;
          const ca = width / height;
          let dw = width;
          let dh = height;
          if (va > ca) dh = width / va;
          else dw = height * va;
          // transform around centre
          ctx.translate(width / 2 + (transform.x / 100) * width, height / 2 + (transform.y / 100) * height);
          ctx.rotate((transform.rotate * Math.PI) / 180);
          ctx.scale(transform.scale, transform.scale);
          ctx.drawImage(video, -dw / 2, -dh / 2, dw, dh);
          ctx.restore();
        }
      }

      // vignette
      if (effects.vignette > 0.01) {
        const g = ctx.createRadialGradient(
          width / 2, height / 2, Math.min(width, height) * 0.36,
          width / 2, height / 2, Math.max(width, height) * 0.72
        );
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, `rgba(0,0,0,${Math.min(0.85, effects.vignette * 0.9)})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, width, height);
      }

      // grain — repositioned every frame for temporal shimmer
      if (effects.grain > 0.01) {
        ctx.save();
        ctx.globalAlpha = effects.grain;
        const ox = Math.floor(Math.random() * 64);
        const oy = Math.floor(Math.random() * 64);
        for (let x = -ox; x < width; x += 128)
          for (let y = -oy; y < height; y += 128) ctx.drawImage(noise, x, y);
        ctx.restore();
      }

      // letterbox
      if (effects.letterbox) {
        const bar = Math.round((height - width / 2.35) / 2);
        if (bar > 0) {
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, width, bar);
          ctx.fillRect(0, height - bar, width, bar);
        }
      }

      spec.onProgress((i + 1) / totalFrames);

      // pace to wall-clock so MediaRecorder gets real-time frame cadence
      const due = t0 + (i + 1) * frameMs;
      const wait = due - performance.now();
      if (wait > 0.5) await new Promise((r) => setTimeout(r, wait));
    }
  } finally {
    rec.stop();
    video.removeAttribute("src");
    video.load();
  }

  return new Promise((resolve, reject) => {
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      if (spec.token.canceled) reject(new Error("canceled"));
      else if (blob.size === 0) reject(new Error("render produced no data"));
      else resolve(blob);
    };
    // if already stopped by the time we attach, resolve on next tick
    setTimeout(() => {
      if (rec.state === "inactive" && chunks.length) {
        const blob = new Blob(chunks, { type: "video/webm" });
        resolve(blob);
      }
    }, 600);
  });
}

export function exportDuration(clips: Clip[], start: number, end: number): number {
  return Math.max(0, end - start) || clipEnd(clips[0] ?? { start: 0, duration: 0 } as Clip);
}
