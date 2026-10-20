"use client";

import type { AssetMeta } from "./types";
import { uid } from "./format";

/**
 * Client-only media pipeline. Object URLs live in a module map (never in the
 * DB). Thumbnails and waveforms are generated locally; waveform decode is
 * chunked so the main thread never drops frames while importing.
 */

const assetUrls = new Map<string, string>();

export const getAssetUrl = (id: string): string | null => assetUrls.get(id) ?? null;

export function revokeAssetUrl(id: string): void {
  const url = assetUrls.get(id);
  if (url) URL.revokeObjectURL(url);
  assetUrls.delete(id);
}

export function revokeAllAssetUrls(): void {
  for (const id of Array.from(assetUrls.keys())) revokeAssetUrl(id);
}

const ACCEPT = /^(video|audio)\//;

export const isSupportedFile = (f: File): boolean => ACCEPT.test(f.type);

/** Probe duration/dimensions without autoplaying anything. */
function probe(url: string, mediaType: "video" | "audio") {
  return new Promise<{ duration: number; width: number; height: number }>(
    (resolve, reject) => {
      const el = document.createElement(mediaType === "video" ? "video" : "audio");
      el.preload = "metadata";
      el.muted = true;
      const cleanup = () => {
        el.removeAttribute("src");
        el.load();
      };
      el.onloadedmetadata = () => {
        const meta = {
          duration: Number.isFinite(el.duration) ? el.duration : 0,
          width: mediaType === "video" ? (el as HTMLVideoElement).videoWidth : 0,
          height: mediaType === "video" ? (el as HTMLVideoElement).videoHeight : 0,
        };
        cleanup();
        resolve(meta);
      };
      el.onerror = () => {
        cleanup();
        reject(new Error("metadata probe failed"));
      };
      el.src = url;
    }
  );
}

/** Capture a small JPEG thumbnail from the video's early frames. */
async function captureThumb(url: string, at: number): Promise<string | null> {
  try {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = url;
    await new Promise<void>((resolve, reject) => {
      v.onloadeddata = () => resolve();
      v.onerror = () => reject(new Error("thumb load failed"));
    });
    v.currentTime = Math.min(Math.max(at, 0.05), 2);
    await new Promise<void>((resolve) => {
      const to = setTimeout(resolve, 1200);
      v.onseeked = () => {
        clearTimeout(to);
        resolve();
      };
    });
    const aspect = v.videoWidth > 0 && v.videoHeight > 0 ? v.videoWidth / v.videoHeight : 16 / 9;
    const w = 208;
    const h = Math.round(w / aspect);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, w, h);
    const out = canvas.toDataURL("image/jpeg", 0.62);
    v.removeAttribute("src");
    v.load();
    return out;
  } catch {
    return null;
  }
}

/**
 * RMS peak series for timeline waveforms. Decodes the whole file (bounded by
 * browser memory) and yields to the event loop between bucket batches.
 */
async function computePeaks(file: File, buckets = 160): Promise<number[] | null> {
  try {
    const ab = await file.arrayBuffer();
    const AC: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    const buf = await ctx.decodeAudioData(ab.slice(0));
    void ctx.close().catch(() => undefined);
    const chan = buf.getChannelData(0);
    const chan2 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
    const total = chan.length;
    const windowSize = Math.max(1, Math.floor(total / buckets));
    const peaks: number[] = new Array(buckets).fill(0);
    let max = 0;
    for (let b = 0; b < buckets; b++) {
      const start = b * windowSize;
      let sum = 0;
      let count = 0;
      // stride sub-sample: 1 of every 8 samples is plenty for RMS shape
      for (let i = start; i < start + windowSize && i < total; i += 8) {
        const v = chan2 ? (chan[i] + chan2[i]) * 0.5 : chan[i];
        sum += v * v;
        count++;
      }
      const rms = Math.sqrt(sum / Math.max(1, count));
      peaks[b] = rms;
      if (rms > max) max = rms;
      if (b % 16 === 15) await new Promise((r) => setTimeout(r, 0));
    }
    if (max > 0) for (let b = 0; b < buckets; b++) peaks[b] = peaks[b] / max;
    return peaks;
  } catch {
    return null;
  }
}

export interface IngestResult {
  meta: AssetMeta;
  /** Resolves later with waveform peaks generated off the hot path. */
  enhance: () => Promise<{ peaks: number[] | null }>;
}

export async function ingestFile(file: File): Promise<IngestResult> {
  const mediaType = file.type.startsWith("video") ? "video" : "audio";
  const id = uid();
  const url = URL.createObjectURL(file);
  assetUrls.set(id, url);
  const probed = await probe(url, mediaType).catch(() => ({
    duration: 0,
    width: 0,
    height: 0,
  }));
  const thumb =
    mediaType === "video" ? await captureThumb(url, probed.duration * 0.08) : null;
  const meta: AssetMeta = {
    id,
    name: file.name,
    mediaType,
    mime: file.type,
    size: file.size,
    duration: probed.duration,
    width: probed.width,
    height: probed.height,
    thumb,
    peaks: null,
    status: "online",
  };
  return {
    meta,
    enhance: async () => ({ peaks: await computePeaks(file) }),
  };
}

/** Relink an offline asset to a newly picked file. */
export async function relinkFile(
  asset: AssetMeta,
  file: File
): Promise<{ patch: Partial<AssetMeta>; enhance: () => Promise<{ peaks: number[] | null }> }> {
  const url = URL.createObjectURL(file);
  revokeAssetUrl(asset.id);
  const key = asset.id;
  assetUrls.set(key, url);
  const mediaType = file.type.startsWith("video") ? "video" : "audio";
  const probed = await probe(url, mediaType).catch(() => null);
  const thumb =
    !asset.thumb && mediaType === "video" ? await captureThumb(url, (probed?.duration ?? 1) * 0.08) : null;
  const patch: Partial<AssetMeta> = {
    status: "online",
    size: file.size,
    ...(probed
      ? { duration: probed.duration, width: probed.width, height: probed.height }
      : {}),
    ...(thumb ? { thumb } : {}),
  };
  return { patch, enhance: async () => ({ peaks: asset.peaks ? asset.peaks : await computePeaks(file) }) };
}
