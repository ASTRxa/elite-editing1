import { clamp } from "./format";
import type { Clip, Track } from "./types";

/** Pure timeline geometry/collision helpers — no DOM, no React. */

export const MIN_CLIP = 0.12; // seconds
export const EPS = 1e-3;

export const clipEnd = (c: Clip): number => c.start + c.duration;

export function clipsOnTrack(clips: Clip[], trackId: string): Clip[] {
  return clips
    .filter((c) => c.trackId === trackId)
    .sort((a, b) => a.start - b.start);
}

function neighbors(sorted: Clip[], id: string) {
  const i = sorted.findIndex((c) => c.id === id);
  return {
    prev: i > 0 ? sorted[i - 1] : null,
    next: i >= 0 && i < sorted.length - 1 ? sorted[i + 1] : null,
  };
}

/** Clamp a move so the clip stays ≥ 0 and never overlaps track neighbors. */
export function clampMoveStart(
  sorted: Clip[],
  clipId: string,
  duration: number,
  desired: number
): number {
  const { prev, next } = neighbors(sorted, clipId);
  const lo = prev ? clipEnd(prev) : 0;
  const hi = next ? next.start - duration : Number.POSITIVE_INFINITY;
  return clamp(desired, lo, Math.max(lo, hi));
}

/** Clamp a left-edge trim; keeps source offset ≥ 0 and duration ≥ MIN_CLIP. */
export function clampTrimLeft(
  sorted: Clip[],
  clip: Clip,
  desiredStart: number
): { start: number; offset: number; duration: number } {
  const { prev } = neighbors(sorted, clip.id);
  const end = clipEnd(clip);
  const loBound = Math.max(prev ? clipEnd(prev) : 0, clip.start - clip.offset / clip.speed);
  const hiBound = end - MIN_CLIP;
  const start = clamp(desiredStart, loBound, hiBound);
  return {
    start,
    offset: Math.max(0, clip.offset + (start - clip.start) * clip.speed),
    duration: end - start,
  };
}

/** Clamp a right-edge trim by neighbors and remaining source material. */
export function clampTrimRight(
  sorted: Clip[],
  clip: Clip,
  srcDuration: number,
  desiredDuration: number
): number {
  const { next } = neighbors(sorted, clip.id);
  const byNeighbor = next ? next.start - clip.start : Number.POSITIVE_INFINITY;
  const bySource = Math.max(MIN_CLIP, (srcDuration - clip.offset) / clip.speed);
  return clamp(desiredDuration, MIN_CLIP, Math.min(byNeighbor, bySource));
}

/** Split a clip at time t (absolute). Returns [left, right] or null. */
export function splitClipParts(clip: Clip, t: number, rightId: string): [Clip, Clip] | null {
  const leftDur = t - clip.start;
  if (leftDur < MIN_CLIP || clip.duration - leftDur < MIN_CLIP) return null;
  const consumed = leftDur * clip.speed;
  const left: Clip = { ...clip, duration: leftDur };
  const right: Clip = {
    ...clip,
    id: rightId,
    start: t,
    duration: clip.duration - leftDur,
    offset: clip.offset + consumed,
  };
  return [left, right];
}

/** Video tracks that can show pixels right now (solo/hidden resolved), top first. */
export function visibleVideoTracks(tracks: Track[]): Track[] {
  const videos = tracks.filter((t) => t.kind === "video");
  const solos = videos.filter((t) => t.solo);
  const pool = solos.length ? videos.filter((t) => t.solo) : videos;
  return pool.filter((t) => !t.hidden);
}

export function isTrackAudible(track: Track, all: Track[]): boolean {
  const sameKind = all.filter((t) => t.kind === track.kind);
  const solos = sameKind.filter((t) => t.solo);
  if (solos.length && !track.solo) return false;
  return !track.muted;
}

export function activeVideoClip(
  tracks: Track[],
  clips: Clip[],
  t: number
): { clip: Clip; track: Track } | null {
  for (const track of visibleVideoTracks(tracks)) {
    const clip = clips.find(
      (c) =>
        c.trackId === track.id &&
        c.start - EPS <= t &&
        t < clipEnd(c) - EPS + c.duration * EPS
    );
    if (clip && t < clipEnd(clip)) return { clip, track };
    if (clip) return { clip, track };
  }
  return null;
}

export function activeAudioItems(
  tracks: Track[],
  clips: Clip[],
  t: number
): { clip: Clip; track: Track }[] {
  const out: { clip: Clip; track: Track }[] = [];
  for (const track of tracks) {
    if (track.kind !== "audio" || !isTrackAudible(track, tracks)) continue;
    for (const c of clips) {
      if (c.trackId !== track.id || c.muted) continue;
      if (c.start - EPS <= t && t < clipEnd(c)) out.push({ clip: c, track });
    }
  }
  return out;
}

/** Any clip (any visible/audible track) present under t — for status slates. */
export function anyClipAt(tracks: Track[], clips: Clip[], t: number): Clip | null {
  for (const track of tracks) {
    if (track.kind === "video" && track.hidden) continue;
    const c = clips.find(
      (x) => x.trackId === track.id && x.start - EPS <= t && t < clipEnd(x)
    );
    if (c) return c;
  }
  return null;
}

export const timelineEnd = (clips: Clip[]): number =>
  clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);

/** First fit gap ≥ duration at-or-after atTime on a track; appends if none. */
export function findGapPlacement(
  clips: Clip[],
  trackId: string,
  duration: number,
  atTime: number
): number {
  const sorted = clipsOnTrack(clips, trackId);
  let cursor = Math.max(0, atTime);
  for (const c of sorted) {
    if (clipEnd(c) <= cursor + EPS) continue;
    if (c.start >= cursor + duration - EPS) return cursor;
    cursor = Math.max(cursor, clipEnd(c));
  }
  return cursor;
}

/** Snap candidate times: every edge of every clip except the excluded one. */
export function snapPoints(clips: Clip[], excludeId: string, extra: number[] = []): number[] {
  const pts: number[] = extra.slice();
  for (const c of clips) {
    if (c.id === excludeId) continue;
    pts.push(c.start, clipEnd(c));
  }
  pts.push(0);
  return Array.from(new Set(pts)).sort((a, b) => a - b);
}

export function snapValue(value: number, candidates: number[], threshold: number): number {
  let best = value;
  let bestDist = threshold;
  for (const p of candidates) {
    const d = Math.abs(p - value);
    if (d <= bestDist + EPS) {
      if (d < bestDist - EPS || Math.abs(p - value) < Math.abs(best - value)) {
        best = p;
        bestDist = d;
      }
    }
    if (p - value > threshold) break;
  }
  return best;
}
