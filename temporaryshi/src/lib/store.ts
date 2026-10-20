"use client";

import { create } from "zustand";
import { buildFakeEdit } from "./faker";
import { clamp, uid } from "./format";
import { revokeAllAssetUrls, revokeAssetUrl } from "./media";
import {
  clampMoveStart,
  clampTrimLeft,
  clampTrimRight,
  clipsOnTrack,
  clipEnd,
  findGapPlacement,
  splitClipParts,
  MIN_CLIP,
} from "./timelineMath";
import type {
  Clip,
  EffectState,
  PersistedProject,
  ProjectMeta,
  RenderJob,
  ToolId,
  Track,
  TrackKind,
  TransformState,
  AssetMeta,
} from "./types";

export type ToastTone = "info" | "success" | "warn" | "error";
export interface Toast {
  id: string;
  message: string;
  tone: ToastTone;
}

export type SaveStatus = "saved" | "dirty" | "saving" | "error";
export type TimelineTab = "timeline" | "graph" | "mixer";
export type EffectsTab = "effects" | "transform";

export const DEFAULT_EFFECTS: EffectState = {
  exposure: 1.02,
  contrast: 1.07,
  saturation: 1.12,
  warmth: 0.06,
  hue: 0,
  blur: 0,
  bloom: true,
  bloomRadius: 22,
  bloomIntensity: 0.26,
  vignette: 0.22,
  grain: 0.08,
  letterbox: false,
};

const DEFAULT_TRANSFORM: TransformState = { scale: 1, rotate: 0, x: 0, y: 0, opacity: 1 };
const DEFAULT_META: ProjectMeta = { width: 1920, height: 1080, fps: 24 };

const LOOKS: Record<string, EffectState> = {
  clean: { ...DEFAULT_EFFECTS, exposure: 1, contrast: 1, saturation: 1, warmth: 0, vignette: 0, grain: 0, bloom: false },
  noir: { ...DEFAULT_EFFECTS, exposure: 0.92, contrast: 1.38, saturation: 0, warmth: -0.06, vignette: 0.55, grain: 0.3, bloom: false },
  "teal-orange": { ...DEFAULT_EFFECTS, warmth: 0.42, hue: -10, saturation: 1.28, contrast: 1.16, vignette: 0.3 },
  vivid: { ...DEFAULT_EFFECTS, saturation: 1.65, contrast: 1.2, exposure: 1.06 },
  dream: { ...DEFAULT_EFFECTS, bloom: true, bloomIntensity: 0.7, bloomRadius: 42, blur: 0.6, saturation: 1.18, exposure: 1.08 },
};

function defaultTracks(): Track[] {
  const mk = (kind: TrackKind, name: string): Track => ({
    id: uid(),
    kind,
    name,
    muted: false,
    solo: false,
    locked: false,
    hidden: false,
    volume: 1,
  });
  return [
    mk("video", "V2 · OVERLAYS"),
    mk("video", "V1 · MAIN"),
    mk("audio", "A1 · SCORE"),
    mk("audio", "A2 · SFX"),
  ];
}

interface HistoryEntry {
  tracks: Track[];
  clips: Clip[];
  selectedClipId: string | null;
}

const past: HistoryEntry[] = [];
const future: HistoryEntry[] = [];
const HISTORY_CAP = 64;

export interface EditorStore {
  hydrated: boolean;
  projectId: string;
  projectName: string;
  meta: ProjectMeta;
  tracks: Track[];
  clips: Clip[];
  assets: AssetMeta[];
  effects: EffectState;
  transform: TransformState;
  masterVolume: number;
  inPoint: number | null;
  outPoint: number | null;

  selectedClipId: string | null;
  tool: ToolId;
  pxps: number;
  timelineTab: TimelineTab;
  effectsTab: EffectsTab;
  showSafeFrame: boolean;
  showGrid: boolean;
  loopPlayback: boolean;
  leftCollapsed: boolean;
  rightCollapsed: boolean;

  renderOpen: boolean;
  settingsOpen: boolean;
  aboutOpen: boolean;
  confirmNew: boolean;
  renderJobs: RenderJob[];
  toasts: Toast[];
  saveStatus: SaveStatus;
  undoCount: number;
  redoCount: number;
  renameClipId: string | null;
  monitor: "program" | "source";
  sourceAssetId: string | null;

  setRenameClipId: (id: string | null) => void;
  setMonitor: (m: "program" | "source") => void;
  openInSource: (assetId: string) => void;

  hydrate: (id: string, data: PersistedProject | null) => void;
  saveNow: () => Promise<void>;
  newProject: () => void;
  setProjectName: (name: string) => void;
  setMeta: (patch: Partial<ProjectMeta>) => void;

  addAssetMeta: (meta: AssetMeta) => void;
  patchAsset: (id: string, patch: Partial<AssetMeta>) => void;
  removeAsset: (id: string) => void;

  addClipFromAsset: (assetId: string, atTime: number) => void;
  commitMove: (id: string, desiredStart: number, desiredTrackId?: string) => void;
  commitTrimLeft: (id: string, desiredStart: number) => void;
  commitTrimRight: (id: string, desiredDuration: number) => void;
  splitClipAt: (id: string, t: number) => boolean;
  splitAtPlayhead: (t: number) => boolean;
  deleteClip: (id: string) => void;
  deleteSelected: () => void;
  duplicateClip: (id: string) => void;
  nudgeClip: (id: string, dt: number) => void;
  moveClipVertical: (id: string, dir: -1 | 1) => void;
  toggleClipMute: (id: string) => void;
  setClipVolume: (id: string, v: number) => void;
  setClipSpeed: (id: string, speed: number) => void;
  renameClip: (id: string, name: string) => void;
  speedRampSelected: () => void;
  smoothSlowMoSelected: () => void;

  addTrack: (kind: TrackKind) => void;
  removeTrack: (id: string) => void;
  injectFakeEdit: () => void;
  setTrackFlag: (id: string, patch: Partial<Pick<Track, "muted" | "solo" | "locked" | "hidden">>) => void;
  setTrackVolume: (id: string, v: number) => void;
  renameTrack: (id: string, name: string) => void;

  setEffect: <K extends keyof EffectState>(key: K, value: EffectState[K]) => void;
  setEffects: (patch: Partial<EffectState>) => void;
  resetEffects: () => void;
  applyLook: (look: string) => void;
  setTransform: (patch: Partial<TransformState>) => void;
  resetTransform: () => void;
  setMasterVolume: (v: number) => void;

  setInPoint: (t: number | null) => void;
  setOutPoint: (t: number | null) => void;
  clearPoints: () => void;

  selectClip: (id: string | null) => void;
  setTool: (tool: ToolId) => void;
  setPxps: (v: number) => void;
  setTimelineTab: (tab: TimelineTab) => void;
  setEffectsTab: (tab: EffectsTab) => void;
  toggleSafeFrame: () => void;
  toggleGrid: () => void;
  toggleLoop: () => void;
  toggleLeft: () => void;
  toggleRight: () => void;
  setRenderOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setAboutOpen: (open: boolean) => void;
  setConfirmNew: (open: boolean) => void;

  addRenderJob: (job: RenderJob) => void;
  patchRenderJob: (id: string, patch: Partial<RenderJob>) => void;
  removeRenderJob: (id: string) => void;

  toast: (message: string, tone?: ToastTone) => void;
  dismissToast: (id: string) => void;

  undo: () => void;
  redo: () => void;
}

function serialize(s: EditorStore): PersistedProject {
  return {
    name: s.projectName,
    meta: s.meta,
    tracks: s.tracks,
    clips: s.clips,
    assets: s.assets.map((a) => ({ ...a, status: "offline" as const })),
    effects: s.effects,
    transform: s.transform,
    masterVolume: s.masterVolume,
    inPoint: s.inPoint,
    outPoint: s.outPoint,
    savedAt: new Date().toISOString(),
  };
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const useEditorStore = create<EditorStore>()((set, get) => {
  const snapshot = (): HistoryEntry => {
    const s = get();
    return { tracks: s.tracks, clips: s.clips, selectedClipId: s.selectedClipId };
  };

  const queueSave = () => {
    if (!get().hydrated) return;
    set({ saveStatus: "dirty" });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void persist(), 800);
  };

  const persist = async () => {
    const s = get();
    if (!s.hydrated) return;
    set({ saveStatus: "saving" });
    try {
      localStorage.setItem("astro-editor:project:v1", JSON.stringify(serialize(s)));
      // let the "SAVING…" paint before flipping to saved
      await new Promise((r) => setTimeout(r, 120));
      set({ saveStatus: "saved" });
    } catch {
      set({ saveStatus: "error" });
    }
  };

  /** History-capturing timeline commit. */
  const commit = (fn: () => Partial<EditorStore>) => {
    past.push(snapshot());
    if (past.length > HISTORY_CAP) past.shift();
    future.length = 0;
    set({ ...fn(), undoCount: past.length, redoCount: 0 } as Partial<EditorStore>);
    queueSave();
  };

  const toast = (message: string, tone: ToastTone = "info") => {
    const id = uid();
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, tone }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 2600);
  };

  return {
    hydrated: false,
    projectId: "astro",
    projectName: "astro_cut_01",
    meta: DEFAULT_META,
    tracks: defaultTracks(),
    clips: [],
    assets: [],
    effects: DEFAULT_EFFECTS,
    transform: DEFAULT_TRANSFORM,
    masterVolume: 1,
    inPoint: null,
    outPoint: null,

    selectedClipId: null,
    tool: "select",
    pxps: 96,
    timelineTab: "timeline",
    effectsTab: "effects",
    showSafeFrame: false,
    showGrid: false,
    loopPlayback: false,
    leftCollapsed: false,
    rightCollapsed: false,

    renderOpen: false,
    settingsOpen: false,
    aboutOpen: false,
    confirmNew: false,
    renderJobs: [],
    toasts: [],
    saveStatus: "saved",
    undoCount: 0,
    redoCount: 0,
    renameClipId: null,
    monitor: "program",
    sourceAssetId: null,

    setRenameClipId: (id) => set({ renameClipId: id }),
    setMonitor: (m) => set({ monitor: m }),
    openInSource: (assetId) => set({ monitor: "source", sourceAssetId: assetId }),

    hydrate: (id, data) => {
      if (!data) {
        set({ projectId: id, hydrated: true });
        queueSave();
        return;
      }
      past.length = 0;
      future.length = 0;
      set({
        projectId: id,
        hydrated: true,
        projectName: data.name ?? "astro_cut_01",
        meta: data.meta ?? DEFAULT_META,
        tracks: data.tracks?.length ? data.tracks : defaultTracks(),
        clips: data.clips ?? [],
        assets: (data.assets ?? []).map((a) => ({ ...a, status: "offline" as const })),
        effects: { ...DEFAULT_EFFECTS, ...(data.effects ?? {}) },
        transform: { ...DEFAULT_TRANSFORM, ...(data.transform ?? {}) },
        masterVolume: data.masterVolume ?? 1,
        inPoint: data.inPoint ?? null,
        outPoint: data.outPoint ?? null,
        saveStatus: "saved",
        undoCount: 0,
        redoCount: 0,
        selectedClipId: null,
      });
    },

    saveNow: async () => {
      if (saveTimer) clearTimeout(saveTimer);
      await persist();
      toast("Project saved to workspace", "success");
    },

    newProject: () => {
      revokeAllAssetUrls();
      past.length = 0;
      future.length = 0;
      for (const job of get().renderJobs) if (job.url) URL.revokeObjectURL(job.url);
      set({
        projectName: "untitled_01",
        meta: DEFAULT_META,
        tracks: defaultTracks(),
        clips: [],
        assets: [],
        effects: DEFAULT_EFFECTS,
        transform: DEFAULT_TRANSFORM,
        masterVolume: 1,
        inPoint: null,
        outPoint: null,
        selectedClipId: null,
        renderJobs: [],
        undoCount: 0,
        redoCount: 0,
      });
      queueSave();
      toast("New project created", "success");
    },

    setProjectName: (name) => {
      set({ projectName: name });
      queueSave();
    },

    setMeta: (patch) => {
      set((s) => ({ meta: { ...s.meta, ...patch } }));
      queueSave();
    },

    addAssetMeta: (meta) => {
      set((s) => ({ assets: [...s.assets, meta] }));
      queueSave();
      toast(`Imported ${meta.name}`, "success");
    },

    patchAsset: (id, patch) => {
      set((s) => ({ assets: s.assets.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
      queueSave();
    },

    removeAsset: (id) => {
      const s = get();
      const asset = s.assets.find((a) => a.id === id);
      if (!asset) return;
      revokeAssetUrl(id);
      const stripClips = s.clips.some((c) => c.assetId === id);
      const apply = () => ({
        assets: s.assets.filter((a) => a.id !== id),
        clips: stripClips ? s.clips.filter((c) => c.assetId !== id) : s.clips,
        selectedClipId:
          s.selectedClipId && stripClips && !s.clips.some((c) => c.id === s.selectedClipId && c.assetId !== id)
            ? null
            : s.selectedClipId,
      });
      if (stripClips) commit(apply);
      else {
        set(apply() as Partial<EditorStore>);
        queueSave();
      }
      toast(`Removed ${asset.name}`, "warn");
    },

    addClipFromAsset: (assetId, atTime) => {
      const s = get();
      const asset = s.assets.find((a) => a.id === assetId);
      if (!asset) return;
      const kind: TrackKind = asset.mediaType === "video" ? "video" : "audio";
      // match source: conform the stage to the video's real frame size so the
      // program monitor fits the footage instead of floating inside 16:9
      if (kind === "video" && asset.width > 0 && asset.height > 0) {
        const stageAspect = s.meta.width / Math.max(1, s.meta.height);
        const mediaAspect = asset.width / asset.height;
        if (Math.abs(stageAspect - mediaAspect) > 0.005) {
          get().setMeta({ width: asset.width, height: asset.height });
        }
      }
      let tracks = s.tracks;
      let track = tracks.find((t) => t.kind === kind);
      if (!track) {
        const fresh: Track = {
          id: uid(),
          kind,
          name: kind === "video" ? "V1 · VIDEO" : "A1 · AUDIO",
          muted: false, solo: false, locked: false, hidden: false, volume: 1,
        };
        tracks = kind === "video" ? [fresh, ...tracks] : [...tracks, fresh];
        track = fresh;
        set({ tracks });
      }
      const duration = asset.duration > 0.1 ? asset.duration : 5;
      const start = findGapPlacement(s.clips, track.id, duration, atTime);
      const clip: Clip = {
        id: uid(),
        trackId: track.id,
        assetId,
        name: asset.name,
        kind,
        start,
        duration,
        offset: 0,
        speed: 1,
        volume: 1,
        muted: false,
      };
      commit(() => ({
        clips: [...get().clips, clip],
        selectedClipId: clip.id,
      }));
    },

    commitMove: (id, desiredStart, desiredTrackId) => {
      const s = get();
      const clip = s.clips.find((c) => c.id === id);
      if (!clip) return;
      const targetId = desiredTrackId ?? clip.trackId;
      const track = s.tracks.find((t) => t.id === targetId);
      if (!track || track.kind !== clip.kind) return;
      const sorted = clipsOnTrack(s.clips, targetId);
      const start = clampMoveStart(sorted, id, clip.duration, desiredStart);
      commit(() => ({
        clips: get().clips.map((c) => (c.id === id ? { ...c, start, trackId: targetId } : c)),
      }));
    },

    commitTrimLeft: (id, desiredStart) => {
      const s = get();
      const clip = s.clips.find((c) => c.id === id);
      if (!clip) return;
      const sorted = clipsOnTrack(s.clips, clip.trackId);
      const patch = clampTrimLeft(sorted, clip, desiredStart);
      commit(() => ({
        clips: get().clips.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      }));
    },

    commitTrimRight: (id, desiredDuration) => {
      const s = get();
      const clip = s.clips.find((c) => c.id === id);
      if (!clip) return;
      const asset = s.assets.find((a) => a.id === clip.assetId);
      const srcDuration = asset && asset.duration > 0 ? asset.duration : clip.offset + clip.duration * clip.speed;
      const sorted = clipsOnTrack(s.clips, clip.trackId);
      const duration = clampTrimRight(sorted, clip, srcDuration, desiredDuration);
      commit(() => ({
        clips: get().clips.map((c) => (c.id === id ? { ...c, duration } : c)),
      }));
    },

    splitClipAt: (id, t) => {
      const s = get();
      const clip = s.clips.find((c) => c.id === id);
      if (!clip) return false;
      const track = s.tracks.find((x) => x.id === clip.trackId);
      if (track?.locked) {
        toast("Track is locked", "warn");
        return false;
      }
      const parts = splitClipParts(clip, t, uid());
      if (!parts) {
        toast("Too close to an edge to split", "warn");
        return false;
      }
      const [left, right] = parts;
      commit(() => ({
        clips: get().clips.flatMap((c) => (c.id === id ? [left, right] : [c])),
        selectedClipId: right.id,
      }));
      toast("Clip split", "success");
      return true;
    },

    splitAtPlayhead: (t) => {
      const s = get();
      let target: Clip | undefined;
      if (s.selectedClipId) {
        const c = s.clips.find((x) => x.id === s.selectedClipId);
        if (c && c.start + MIN_CLIP < t && t < clipEnd(c) - MIN_CLIP) target = c;
      }
      if (!target) {
        const covering = s.clips.filter((c) => c.start + MIN_CLIP < t && t < clipEnd(c) - MIN_CLIP);
        const trackOf = (c: Clip) => s.tracks.findIndex((x) => x.id === c.trackId);
        covering.sort((a, b) => trackOf(a) - trackOf(b));
        target = covering[0];
      }
      if (!target) {
        toast("No clip under the playhead", "warn");
        return false;
      }
      return get().splitClipAt(target.id, t);
    },

    deleteClip: (id) => {
      commit(() => ({
        clips: get().clips.filter((c) => c.id !== id),
        selectedClipId: get().selectedClipId === id ? null : get().selectedClipId,
      }));
      toast("Clip deleted", "warn");
    },

    deleteSelected: () => {
      const id = get().selectedClipId;
      if (!id) {
        toast("Nothing selected", "info");
        return;
      }
      get().deleteClip(id);
    },

    duplicateClip: (id) => {
      const s = get();
      const clip = s.clips.find((c) => c.id === id);
      if (!clip) return;
      const desired = clipEnd(clip);
      const start = findGapPlacement(s.clips, clip.trackId, clip.duration, desired);
      const copy: Clip = { ...clip, id: uid(), start };
      commit(() => ({
        clips: [...get().clips, copy],
        selectedClipId: copy.id,
      }));
      toast("Clip duplicated", "success");
    },

    nudgeClip: (id, dt) => {
      const s = get();
      const clip = s.clips.find((c) => c.id === id);
      if (!clip) return;
      get().commitMove(id, clip.start + dt);
    },

    moveClipVertical: (id, dir) => {
      const s = get();
      const clip = s.clips.find((c) => c.id === id);
      if (!clip) return;
      const sameKind = s.tracks.filter((t) => t.kind === clip.kind);
      const idx = sameKind.findIndex((t) => t.id === clip.trackId);
      const target = sameKind[idx + dir];
      if (!target) {
        toast(dir < 0 ? "Already on the top track" : "Already on the bottom track", "info");
        return;
      }
      get().commitMove(id, clip.start, target.id);
    },

    toggleClipMute: (id) => {
      const s = get();
      const clip = s.clips.find((c) => c.id === id);
      if (!clip) return;
      commit(() => ({
        clips: get().clips.map((c) => (c.id === id ? { ...c, muted: !c.muted } : c)),
      }));
    },

    setClipVolume: (id, v) => {
      set((s) => ({ clips: s.clips.map((c) => (c.id === id ? { ...c, volume: clamp(v, 0, 1) } : c)) }));
      queueSave();
    },

    setClipSpeed: (id, speed) => {
      const s = get();
      const clip = s.clips.find((c) => c.id === id);
      if (!clip) return;
      const asset = s.assets.find((a) => a.id === clip.assetId);
      const srcRemaining = asset && asset.duration > 0 ? asset.duration - clip.offset : clip.duration * clip.speed;
      const maxSpeed = Math.max(0.25, Math.min(4, srcRemaining / clip.duration));
      const next = clamp(speed, 0.25, Math.max(0.25, maxSpeed));
      if (next < speed - 0.001) toast(`Speed clamped to ${next.toFixed(2)}x (source length)`, "warn");
      commit(() => ({
        clips: get().clips.map((c) => (c.id === id ? { ...c, speed: next } : c)),
      }));
    },

    renameClip: (id, name) => {
      set((s) => ({ clips: s.clips.map((c) => (c.id === id ? { ...c, name } : c)) }));
      queueSave();
    },

    /** Speed-ramp preset: splits the clip into 0.5x / 1.6x / 1x thirds. */
    speedRampSelected: () => {
      const s = get();
      const id = s.selectedClipId;
      const clip = s.clips.find((c) => c.id === id);
      if (!clip) {
        toast("Select a clip first", "info");
        return;
      }
      if (clip.duration < 0.9) {
        toast("Clip too short for a ramp", "warn");
        return;
      }
      const asset = s.assets.find((a) => a.id === clip.assetId);
      const unit = clip.duration / 3;
      const speeds = [0.5, 1.6, 1];
      const parts: Clip[] = [];
      let off = clip.offset;
      for (let i = 0; i < 3; i++) {
        parts.push({
          ...clip,
          id: uid(),
          start: clip.start + unit * i,
          duration: unit,
          offset: off,
          speed: speeds[i],
        });
        off += unit * speeds[i];
      }
      if (asset && asset.duration > 0 && off > asset.duration + 0.01) {
        toast("Not enough source footage for a ramp", "error");
        return;
      }
      commit(() => ({
        clips: get().clips.flatMap((c) => (c.id === clip.id ? parts : [c])),
        selectedClipId: parts[1].id,
      }));
      toast("Speed ramp applied (0.5x / 1.6x / 1x)", "success");
    },

    smoothSlowMoSelected: () => {
      const s = get();
      if (!s.selectedClipId) {
        toast("Select a clip first", "info");
        return;
      }
      get().setClipSpeed(s.selectedClipId, 0.5);
    },

    addTrack: (kind) => {
      const s = get();
      const count = s.tracks.filter((t) => t.kind === kind).length;
      const track: Track = {
        id: uid(),
        kind,
        name: `${kind === "video" ? "V" : "A"}${count + 1} · ${kind === "video" ? "VIDEO" : "AUDIO"}`,
        muted: false, solo: false, locked: false, hidden: false, volume: 1,
      };
      set({ tracks: kind === "video" ? [track, ...s.tracks] : [...s.tracks, track] });
      queueSave();
      toast(`${track.name} added`, "success");
    },

    removeTrack: (id) => {
      const s = get();
      const track = s.tracks.find((t) => t.id === id);
      if (!track) return;
      if (s.tracks.filter((t) => t.kind === track.kind).length <= 1) {
        toast("Keep at least one track of each kind", "warn");
        return;
      }
      commit(() => ({
        tracks: get().tracks.filter((t) => t.id !== id),
        clips: get().clips.filter((c) => c.trackId !== id),
      }));
      toast(`${track.name} removed`, "warn");
    },

    /**
     * Reconstruct the full editorial session from the session cache:
     * rebuilds the department stack to 160 tracks and re-lays every
     * element across the entire programme duration.
     */
    injectFakeEdit: () => {
      const s = get();
      const gen = buildFakeEdit({
        tracks: s.tracks,
        clips: s.clips,
        assets: s.assets,
        outPoint: s.outPoint,
        projectName: s.projectName,
      });
      if (!gen) {
        toast("Session cache already synced — 160 tracks online", "info");
        return;
      }
      commit(() => ({
        tracks: gen.tracks,
        clips: gen.clips,
        assets: [...s.assets, ...gen.assets],
        projectName: gen.projectName,
        inPoint: 0,
        outPoint: gen.duration,
        selectedClipId: null,
      }));
      toast(
        `Session cache restored — ${gen.tracks.length} tracks · ${gen.clips.length} clips · ${gen.addedAssets} nearline assets`,
        "success"
      );
    },

    setTrackFlag: (id, patch) => {
      set((s) => ({ tracks: s.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
      queueSave();
    },

    setTrackVolume: (id, v) => {
      set((s) => ({ tracks: s.tracks.map((t) => (t.id === id ? { ...t, volume: clamp(v, 0, 1) } : t)) }));
      queueSave();
    },

    renameTrack: (id, name) => {
      set((s) => ({ tracks: s.tracks.map((t) => (t.id === id ? { ...t, name } : t)) }));
      queueSave();
    },

    setEffect: (key, value) => {
      set((s) => ({ effects: { ...s.effects, [key]: value } }));
      queueSave();
    },

    setEffects: (patch) => {
      set((s) => ({ effects: { ...s.effects, ...patch } }));
      queueSave();
    },

    resetEffects: () => {
      set({ effects: DEFAULT_EFFECTS });
      queueSave();
      toast("Grade reset", "info");
    },

    applyLook: (look) => {
      const preset = LOOKS[look];
      if (!preset) return;
      set({ effects: { ...preset } });
      queueSave();
      toast(`Look applied: ${look}`, "success");
    },

    setTransform: (patch) => {
      set((s) => ({ transform: { ...s.transform, ...patch } }));
      queueSave();
    },

    resetTransform: () => {
      set({ transform: DEFAULT_TRANSFORM });
      queueSave();
    },

    setMasterVolume: (v) => {
      set({ masterVolume: clamp(v, 0, 1) });
      queueSave();
    },

    setInPoint: (t) => {
      const s = get();
      if (t === null) {
        set({ inPoint: null });
      } else {
        set({ inPoint: t, outPoint: s.outPoint !== null && s.outPoint <= t ? null : s.outPoint });
      }
      queueSave();
    },

    setOutPoint: (t) => {
      const s = get();
      if (t === null) {
        set({ outPoint: null });
      } else {
        set({ outPoint: t, inPoint: s.inPoint !== null && s.inPoint >= t ? null : s.inPoint });
      }
      queueSave();
    },

    clearPoints: () => {
      set({ inPoint: null, outPoint: null });
      queueSave();
    },

    selectClip: (id) => set({ selectedClipId: id }),
    setTool: (tool) => set({ tool }),
    setPxps: (v) => set({ pxps: clamp(v, 6, 900) }),
    setTimelineTab: (tab) => set({ timelineTab: tab }),
    setEffectsTab: (tab) => set({ effectsTab: tab }),
    toggleSafeFrame: () => set((s) => ({ showSafeFrame: !s.showSafeFrame })),
    toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
    toggleLoop: () => set((s) => ({ loopPlayback: !s.loopPlayback })),
    toggleLeft: () => set((s) => ({ leftCollapsed: !s.leftCollapsed })),
    toggleRight: () => set((s) => ({ rightCollapsed: !s.rightCollapsed })),
    setRenderOpen: (open) => set({ renderOpen: open }),
    setSettingsOpen: (open) => set({ settingsOpen: open }),
    setAboutOpen: (open) => set({ aboutOpen: open }),
    setConfirmNew: (open) => set({ confirmNew: open }),

    addRenderJob: (job) => set((s) => ({ renderJobs: [job, ...s.renderJobs] })),
    patchRenderJob: (id, patch) =>
      set((s) => ({ renderJobs: s.renderJobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) })),
    removeRenderJob: (id) => {
      const job = get().renderJobs.find((j) => j.id === id);
      if (job?.url) URL.revokeObjectURL(job.url);
      set((s) => ({ renderJobs: s.renderJobs.filter((j) => j.id !== id) }));
    },

    toast,
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    undo: () => {
      const entry = past.pop();
      if (!entry) {
        toast("Nothing to undo", "info");
        return;
      }
      future.push(snapshot());
      set({
        tracks: entry.tracks,
        clips: entry.clips,
        selectedClipId: entry.selectedClipId,
        undoCount: past.length,
        redoCount: future.length,
      });
      queueSave();
    },

    redo: () => {
      const entry = future.pop();
      if (!entry) {
        toast("Nothing to redo", "info");
        return;
      }
      past.push(snapshot());
      set({
        tracks: entry.tracks,
        clips: entry.clips,
        selectedClipId: entry.selectedClipId,
        undoCount: past.length,
        redoCount: future.length,
      });
      queueSave();
    },
  };
});
