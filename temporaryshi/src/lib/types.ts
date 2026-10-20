/** Core domain model for Astro's Editor. All times are seconds (float). */

export type TrackKind = "video" | "audio";
export type MediaKind = "video" | "audio";
export type ToolId = "select" | "razor" | "hand";

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  solo: boolean;
  locked: boolean;
  hidden: boolean;
  /** 0..1 track bus volume */
  volume: number;
}

export interface Clip {
  id: string;
  trackId: string;
  assetId: string;
  name: string;
  kind: TrackKind;
  /** timeline start (s) */
  start: number;
  /** visible duration on timeline (s) */
  duration: number;
  /** source in-point (s) */
  offset: number;
  /** playback rate multiplier 0.25..4 */
  speed: number;
  /** 0..1 clip gain */
  volume: number;
  muted: boolean;
}

export interface AssetMeta {
  id: string;
  name: string;
  mediaType: MediaKind;
  mime: string;
  size: number;
  duration: number;
  width: number;
  height: number;
  /** data-URL thumbnail, generated locally */
  thumb: string | null;
  /** RMS peaks 0..1 for waveform rendering */
  peaks: number[] | null;
  /** offline = no live object URL this session (needs relink) */
  status: "online" | "offline";
}

export interface EffectState {
  exposure: number; // 0.25..2.5, 1 neutral
  contrast: number; // 0.25..2.5, 1 neutral
  saturation: number; // 0..3, 1 neutral
  warmth: number; // -1..1 (0 neutral)
  hue: number; // -60..60 deg
  blur: number; // 0..20 px
  bloom: boolean;
  bloomRadius: number; // 4..60 px
  bloomIntensity: number; // 0..1
  vignette: number; // 0..1
  grain: number; // 0..1
  letterbox: boolean;
}

export interface TransformState {
  scale: number; // 0.2..3
  rotate: number; // -180..180 deg
  x: number; // -50..50 (% of stage)
  y: number; // -50..50
  opacity: number; // 0..1
}

export interface ProjectMeta {
  width: number;
  height: number;
  fps: number;
}

export type RenderState = "queued" | "rendering" | "done" | "error" | "canceled";

export interface RenderJob {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  state: RenderState;
  progress: number;
  url: string | null;
  size: number | null;
  note: string | null;
}

export interface PersistedProject {
  name: string;
  meta: ProjectMeta;
  tracks: Track[];
  clips: Clip[];
  assets: AssetMeta[];
  effects: EffectState;
  transform: TransformState;
  masterVolume: number;
  inPoint: number | null;
  outPoint: number | null;
  savedAt?: string;
}
