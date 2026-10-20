import type { EffectState } from "./types";

export const uid = (): string =>
  `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;

export const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** SMPTE-ish timecode mm:ss:ff at `fps`. */
export function timecode(sec: number, fps = 24): string {
  const safe = Math.max(0, sec);
  const totalFrames = Math.floor(safe * fps);
  const frames = totalFrames % fps;
  const seconds = Math.floor(totalFrames / fps);
  const minutes = Math.floor(seconds / 60);
  return `${pad2(minutes)}:${pad2(seconds % 60)}:${pad2(frames)}`;
}

/** Clock time m:ss.m for logs/lists. */
export function clockTime(sec: number): string {
  const safe = Math.max(0, sec);
  const m = Math.floor(safe / 60);
  const s = safe - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

export function formatMemory(bytes: number): string {
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

/**
 * Builds a CSS `filter` string from the grade panel state.
 * Warmth is approximated with sepia + hue offsets — cheap and GPU-composited.
 * CSS variable assignment happens once per change on the stage element; the
 * heavy lifting is done by the compositor, not JS.
 */
export function filterString(e: EffectState): string {
  const parts: string[] = [];
  if (Math.abs(e.exposure - 1) > 0.004) parts.push(`brightness(${e.exposure.toFixed(3)})`);
  if (Math.abs(e.contrast - 1) > 0.004) parts.push(`contrast(${e.contrast.toFixed(3)})`);
  if (Math.abs(e.saturation - 1) > 0.004) parts.push(`saturate(${e.saturation.toFixed(3)})`);
  if (Math.abs(e.warmth) > 0.004) {
    const a = Math.abs(e.warmth);
    parts.push(`sepia(${(a * 0.55).toFixed(3)})`);
    parts.push(`hue-rotate(${((e.warmth > 0 ? -1 : 1) * a * 26).toFixed(2)}deg)`);
  }
  if (Math.abs(e.hue) > 0.05) parts.push(`hue-rotate(${e.hue.toFixed(2)}deg)`);
  if (e.blur > 0.05) parts.push(`blur(${e.blur.toFixed(2)}px)`);
  return parts.length ? parts.join(" ") : "none";
}

/** Same grade, expressed for CanvasRenderingContext2D.filter. */
export const canvasFilterString = filterString;
