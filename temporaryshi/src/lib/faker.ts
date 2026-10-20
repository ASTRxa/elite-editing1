"use client";

import { uid, clamp } from "./format";
import { timelineEnd } from "./timelineMath";
import type { AssetMeta, Clip, Track } from "./types";

/**
 * Session-cache reconstructor.
 *
 * Rebuilds a fully-worked editorial session — dense multi-role video
 * departments (titles, b-roll, adjustment layers, whip pans…) and a deep
 * audio stack (score, dialog, foley, hits, risers) — spread across the
 * *entire* programme duration. If the source video is 8 minutes long the
 * elements reach 8 minutes; nothing is padded or cut short.
 *
 * Where a live (online) video asset exists in the bin, generated picture
 * clips borrow its asset id so the program monitor keeps playing real
 * footage. Everything else references procedural "nearline" assets that
 * behave exactly like restored-session media (offline, relinkable).
 */

export interface FakeEditResult {
  tracks: Track[];
  clips: Clip[];
  assets: AssetMeta[];
  duration: number;
  projectName: string;
  addedTracks: number;
  addedClips: number;
  addedAssets: number;
}

export const TARGET_TRACKS = 160;

/* ------------------------------------------------------------------ */
/* deterministic-ish PRNG                                              */
/* ------------------------------------------------------------------ */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const pick = <T,>(r: Rng, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];
const range = (r: Rng, min: number, max: number) => min + r() * (max - min);
const irange = (r: Rng, min: number, max: number) => Math.floor(range(r, min, max + 1));
const chance = (r: Rng, p: number) => r() < p;

/* ------------------------------------------------------------------ */
/* procedural media-bin dressing                                       */
/* ------------------------------------------------------------------ */
const THUMB_PALETTES: [string, string, string][] = [
  ["#1b2a4a", "#7b6cf0", "#0a0c11"],
  ["#3a1f3d", "#ff6fae", "#0a0c11"],
  ["#123332", "#57d6a0", "#0a0c11"],
  ["#3d2c14", "#ffb86b", "#0a0c11"],
  ["#241a4a", "#55d6e8", "#0a0c11"],
  ["#402030", "#ff647d", "#0a0c11"],
];

let thumbCache: string[] | null = null;

/** Six reusable "film burn" thumbnails, painted once per session. */
function getThumbs(): string[] {
  if (thumbCache) return thumbCache;
  if (typeof document === "undefined") return [];
  const out: string[] = [];
  THUMB_PALETTES.forEach((pal, pi) => {
    try {
      const c = document.createElement("canvas");
      c.width = 208;
      c.height = 117;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      const r = mulberry32(0xa57 + pi * 977);
      const g = ctx.createLinearGradient(0, 0, 208, 117);
      g.addColorStop(0, pal[0]);
      g.addColorStop(0.55, pal[2]);
      g.addColorStop(1, pal[0]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 208, 117);
      // light blobs
      for (let i = 0; i < 5; i++) {
        const x = range(r, -30, 220);
        const y = range(r, -20, 130);
        const rad = range(r, 14, 52);
        const rg = ctx.createRadialGradient(x, y, 0, x, y, rad);
        rg.addColorStop(0, `${pal[1]}cc`);
        rg.addColorStop(1, "transparent");
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
      // silhouette band (fake subject)
      ctx.fillStyle = "rgba(4,6,10,0.55)";
      ctx.fillRect(0, 82, 208, 35);
      // scanlines
      ctx.fillStyle = "rgba(255,255,255,0.045)";
      for (let y = 0; y < 117; y += 3) ctx.fillRect(0, y, 208, 1);
      // letterbox hint
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(0, 0, 208, 9);
      ctx.fillRect(0, 108, 208, 9);
      // timecode stamp
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.font = "9px monospace";
      ctx.fillText(`00:${String(12 + pi * 7).padStart(2, "0")}:${String(3 + pi * 9).padStart(2, "0")}:18`, 8, 21);
      out.push(c.toDataURL("image/jpeg", 0.55));
    } catch {
      /* canvas unavailable — fall back to icon */
    }
  });
  thumbCache = out;
  return out;
}

/** Synthetic waveform peaks (normalized random walk) for fake audio. */
function makePeaks(r: Rng, buckets = 140): number[] {
  const peaks: number[] = [];
  let v = 0.4;
  for (let i = 0; i < buckets; i++) {
    v = clamp(v + range(r, -0.22, 0.22), 0.06, 1);
    // periodic quiet bars so it reads like real dialogue/music dynamics
    const env = 0.65 + 0.35 * Math.sin(i / 9 + r() * 0.6);
    peaks.push(Number((v * env).toFixed(3)));
  }
  return peaks;
}

interface FakeAssetSpec {
  name: string;
  mediaType: "video" | "audio";
  dur: [number, number];
  sizeMb: [number, number];
  res?: [number, number];
  cat: string;
}

const FAKE_VIDEO_ASSETS: FakeAssetSpec[] = [
  { name: "ASTRA_MASTER_A-CAM_0908.MP4", mediaType: "video", dur: [240, 900], sizeMb: [1400, 2600], res: [3840, 2160], cat: "main" },
  { name: "ASTRA_B-CAM_0913.MP4", mediaType: "video", dur: [180, 700], sizeMb: [900, 2100], res: [3840, 2160], cat: "main" },
  { name: "BROLL_CITY_DRONE_0412.MP4", mediaType: "video", dur: [40, 180], sizeMb: [300, 1200], res: [3840, 2160], cat: "broll" },
  { name: "BROLL_NEON_NIGHT_0207.MP4", mediaType: "video", dur: [30, 150], sizeMb: [260, 980], res: [1920, 1080], cat: "broll" },
  { name: "BROLL_HANDS_MACRO_0331.MP4", mediaType: "video", dur: [20, 90], sizeMb: [180, 640], res: [1920, 1080], cat: "broll" },
  { name: "BROLL_ROOFTOP_GOLDEN_0519.MP4", mediaType: "video", dur: [25, 120], sizeMb: [220, 800], res: [3840, 2160], cat: "broll" },
  { name: "FX_DUST_4K_PARTICLES_01.MP4", mediaType: "video", dur: [10, 60], sizeMb: [80, 420], res: [3840, 2160], cat: "fx" },
  { name: "FX_LIGHTLEAK_PACK_06.MP4", mediaType: "video", dur: [8, 45], sizeMb: [70, 380], res: [1920, 1080], cat: "fx" },
  { name: "FX_CHROMA_FLARE_02.MP4", mediaType: "video", dur: [6, 40], sizeMb: [60, 300], res: [1920, 1080], cat: "fx" },
  { name: "TEMPLATE_TTL_KINETIC_1080.MP4", mediaType: "video", dur: [3, 12], sizeMb: [20, 90], res: [1920, 1080], cat: "gfx" },
  { name: "PIP_REACTION-CAM_SYNC.MP4", mediaType: "video", dur: [60, 420], sizeMb: [400, 1600], res: [1920, 1080], cat: "pip" },
  { name: "STILL_REF-BOARD_001.PNG", mediaType: "video", dur: [5, 30], sizeMb: [2, 14], res: [1920, 1080], cat: "gfx" },
];

const FAKE_AUDIO_ASSETS: FakeAssetSpec[] = [
  { name: "SCORE_PULSE_v3_MASTER.WAV", mediaType: "audio", dur: [120, 480], sizeMb: [40, 220], cat: "score" },
  { name: "SCORE_EMBER_v1.WAV", mediaType: "audio", dur: [90, 360], sizeMb: [30, 160], cat: "score" },
  { name: "SCORE_NIGHTDRIVE_v2.WAV", mediaType: "audio", dur: [100, 400], sizeMb: [36, 180], cat: "score" },
  { name: "DIAL_MASTER_LAV_CH1.WAV", mediaType: "audio", dur: [180, 720], sizeMb: [30, 140], cat: "dial" },
  { name: "DIAL_MASTER_BOOM_CH2.WAV", mediaType: "audio", dur: [180, 720], sizeMb: [30, 140], cat: "dial" },
  { name: "VO_NARRATION_TAKE-04.WAV", mediaType: "audio", dur: [60, 300], sizeMb: [12, 60], cat: "vo" },
  { name: "WHOOSH_PACK_DEEP_07.WAV", mediaType: "audio", dur: [4, 30], sizeMb: [2, 18], cat: "sfx" },
  { name: "SFX_IMPACT_SUB_PACK.WAV", mediaType: "audio", dur: [3, 24], sizeMb: [2, 16], cat: "sfx" },
  { name: "RISER_TONAL_BUILD_8BAR.WAV", mediaType: "audio", dur: [6, 40], sizeMb: [3, 22], cat: "sfx" },
  { name: "FLY_CLOTH_STEPS_WALK.WAV", mediaType: "audio", dur: [20, 120], sizeMb: [6, 36], cat: "foley" },
  { name: "AMB_CITY-NIGHT_LOOP.WAV", mediaType: "audio", dur: [60, 300], sizeMb: [12, 70], cat: "amb" },
  { name: "AMB_ROOM-TONE_01.WAV", mediaType: "audio", dur: [60, 240], sizeMb: [10, 60], cat: "amb" },
  { name: "GLTX_STUTTER_ELEMENTS.WAV", mediaType: "audio", dur: [3, 20], sizeMb: [2, 12], cat: "sfx" },
  { name: "BED_LOFI-TEXTURE_v5.WAV", mediaType: "audio", dur: [90, 300], sizeMb: [30, 130], cat: "score" },
];

function buildFakeAssets(r: Rng): { assets: AssetMeta[]; byCat: Map<string, AssetMeta[]> } {
  const thumbs = getThumbs();
  const assets: AssetMeta[] = [];
  const byCat = new Map<string, AssetMeta[]>();
  const push = (spec: FakeAssetSpec) => {
    const duration = Math.round(range(r, spec.dur[0], spec.dur[1]) * 10) / 10;
    const size = Math.round(range(r, spec.sizeMb[0], spec.sizeMb[1]) * 1024 * 1024);
    const meta: AssetMeta = {
      id: uid(),
      name: spec.name,
      mediaType: spec.mediaType,
      mime: spec.mediaType === "video" ? "video/mp4" : "audio/wav",
      size,
      duration,
      width: spec.res?.[0] ?? 0,
      height: spec.res?.[1] ?? 0,
      thumb:
        spec.mediaType === "video" && thumbs.length
          ? thumbs[Math.floor(r() * thumbs.length)]
          : null,
      peaks: spec.mediaType === "audio" ? makePeaks(r) : null,
      status: "offline",
    };
    assets.push(meta);
    const list = byCat.get(spec.cat) ?? [];
    list.push(meta);
    byCat.set(spec.cat, list);
  };
  FAKE_VIDEO_ASSETS.forEach(push);
  FAKE_AUDIO_ASSETS.forEach(push);
  return { assets, byCat };
}

/* ------------------------------------------------------------------ */
/* clip name banks                                                     */
/* ------------------------------------------------------------------ */
const NB = {
  adj: ["ADJ_teal-orange_v", "ADJ_film-grain-35mm_v", "ADJ_letterbox-2.35_v", "LUT_kodak-2383_v", "ADJ_sharpen+NR_v", "ADJ_glow-pass_v", "CC_exposure-fix_v", "ADJ_bleach-bypass_v"],
  ttl: ["TTL_open-title_v", "TTL_chapter-", "TTL_kinetic-intro_v", "TTL_end-card_v", "SUB_EN_burn-in_", "TTL_locator-card_v"],
  lr: ["LR_name-card_", "LR_locator_", "LR_quote-card_", "LR_topic-tag_"],
  broll: ["BROLL_city-drone_", "BROLL_neon-night_", "BROLL_hands-macro_", "BROLL_rooftop-golden_", "BROLL_crowd-slowmo_", "BROLL_rain-window_", "BROLL_skyline-tl_", "BROLL_market-walk_", "BROLL_forest-fog_", "BROLL_studio-top_"],
  ovl: ["FX_dust-4k_", "FX_bokeh-pass_", "FX_film-scratches_", "FX_vhs-noise_", "FX_ember-drift_", "FX_anamorphic-streak_"],
  ll: ["FX_lightleak_", "FX_burn-in_"],
  pip: ["PIP_reaction-cam_", "PIP_hands-top_", "PIP_side-angle_"],
  ramp: ["RAMP_hero-shot_", "RAMP_whip-in_", "RAMP_slowmo-reveal_"],
  whip: ["TRN_whip_", "TRN_glitch-cut_", "TRN_smash-cut_", "STAB_reframe_"],
  matte: ["MATTE_radial-wipe_", "MATTE_diagonal_", "MATTE_iris_"],
  vfx: ["VFX_cleanplate_", "VFX_screen-repl_", "VFX_roto-pass_"],
  still: ["STILL_frame-hold_", "STILL_ref-board_", "STILL_tableau_"],
  sel: ["SELECTS_A-cam_", "SELECTS_B-cam_", "SELECTS_alt-take_"],
  cut: ["CUT_scene-", "CUT_alt-take_sc-", "CUT_pickup_sc-"],
  bu: ["BU_selects-roll_", "BU_safety_"],
  score: ["SCORE_pulse_v", "SCORE_ember_v", "SCORE_nightdrive_v", "SCORE_glasshouse_v", "SCORE_aurora_v", "BED_lofi-texture_v"],
  dial: ["DIAL_take-", "DIAL_pickup_", "DIAL_wild-line_"],
  vo: ["VO_narration_take-", "VO_alt-read_"],
  sfx: ["SFX_impact-sub_", "SFX_metal-hit_", "SFX_glitch-tick_", "SFX_ui-blip_", "SFX_shutter_", "SFX_crowd-swell_", "SFX_deep-boom_", "SFX_spark-zap_"],
  whoosh: ["WHOOSH_air-deep_", "WHOOSH_speed_", "WHOOSH_bass-suck_"],
  hits: ["HIT_braam_", "HIT_sub-drop_", "HIT_drum-slam_"],
  riser: ["RISER_build-8bar_", "RISER_tonal-lift_", "RISER_noise-sweep_"],
  foley: ["FLY_cloth_", "FLY_steps-concrete_", "FLY_keys-jingle_", "FLY_door-creak_"],
  amb: ["AMB_city-night_loop_", "AMB_room-tone_", "AMB_rain-window_loop_", "AMB_forest-dawn_loop_"],
  sub: ["SUB_drop_", "SUB_rumble-bed_"],
  glx: ["GLTX_stutter_", "GLTX_datamosh_"],
};

function clipName(r: Rng, bank: string[], pad = 2): string {
  const base = pick(r, bank);
  const n =
    base.endsWith("chapter-") || base.endsWith("scene-") || base.endsWith("take-")
      ? String(irange(r, 1, 24)).padStart(2, "0")
      : String(irange(r, 1, 99)).padStart(pad, "0");
  return `${base}${n}`;
}

/* ------------------------------------------------------------------ */
/* track role system                                                   */
/* ------------------------------------------------------------------ */
type RoleId =
  | "adj" | "ttl" | "lr" | "broll" | "ovl" | "ll" | "pip" | "ramp" | "whip"
  | "matte" | "vfx" | "still" | "sel" | "cut" | "bu"
  | "score" | "dial" | "vo" | "sfx" | "whoosh" | "hits" | "riser" | "foley" | "amb" | "sub" | "glx";

interface RoleSpec {
  label: string;
  weight: number;
  kind: "video" | "audio";
  count: [number, number];
  dur: [number, number];
  gap: [number, number];
  speedSet?: number[];
  assetCat: string;
  bank: string[];
  realBias: number; // probability of borrowing the live online video asset
}

const VIDEO_ROLES: (RoleSpec & { id: RoleId })[] = [
  { id: "adj", label: "ADJ LYR", kind: "video", weight: 7, count: [1, 3], dur: [30, 120], gap: [20, 80], assetCat: "gfx", bank: NB.adj, realBias: 0.45 },
  { id: "ttl", label: "TITLES", kind: "video", weight: 8, count: [2, 5], dur: [2.5, 8], gap: [20, 70], assetCat: "gfx", bank: NB.ttl, realBias: 0.65 },
  { id: "lr", label: "LOWER 3RD", kind: "video", weight: 6, count: [2, 6], dur: [3, 9], gap: [18, 60], assetCat: "gfx", bank: NB.lr, realBias: 0.7 },
  { id: "broll", label: "B-ROLL", kind: "video", weight: 17, count: [3, 8], dur: [6, 26], gap: [4, 26], assetCat: "broll", bank: NB.broll, realBias: 0.85 },
  { id: "ovl", label: "OVERLAYS", kind: "video", weight: 8, count: [2, 6], dur: [3, 16], gap: [10, 44], assetCat: "fx", bank: NB.ovl, realBias: 0.85 },
  { id: "ll", label: "LIGHT LEAKS", kind: "video", weight: 4, count: [2, 5], dur: [2, 9], gap: [26, 80], assetCat: "fx", bank: NB.ll, realBias: 0.8 },
  { id: "pip", label: "PIP", kind: "video", weight: 5, count: [2, 5], dur: [6, 20], gap: [16, 55], assetCat: "pip", bank: NB.pip, realBias: 0.8 },
  { id: "ramp", label: "SPEEDRAMP", kind: "video", weight: 7, count: [2, 5], dur: [3, 11], gap: [14, 46], speedSet: [0.35, 0.5, 0.6, 1.5, 1.8, 2.5], assetCat: "broll", bank: NB.ramp, realBias: 0.85 },
  { id: "whip", label: "WHIP PAN", kind: "video", weight: 5, count: [5, 12], dur: [0.25, 1.4], gap: [6, 40], assetCat: "fx", bank: NB.whip, realBias: 0.92 },
  { id: "matte", label: "MATTES", kind: "video", weight: 4, count: [2, 5], dur: [1, 5], gap: [24, 70], assetCat: "gfx", bank: NB.matte, realBias: 0.5 },
  { id: "vfx", label: "VFX PLATES", kind: "video", weight: 4, count: [2, 4], dur: [4, 14], gap: [24, 70], assetCat: "gfx", bank: NB.vfx, realBias: 0.7 },
  { id: "still", label: "STILLS", kind: "video", weight: 3, count: [1, 4], dur: [2, 7], gap: [30, 90], assetCat: "gfx", bank: NB.still, realBias: 0.5 },
  { id: "sel", label: "SELECTS", kind: "video", weight: 7, count: [4, 9], dur: [10, 40], gap: [2, 14], assetCat: "main", bank: NB.sel, realBias: 0.9 },
  { id: "cut", label: "ASSEMBLY", kind: "video", weight: 5, count: [1, 1], dur: [8, 45], gap: [0, 0.2], assetCat: "main", bank: NB.cut, realBias: 0.9 },
  { id: "bu", label: "BACKUP", kind: "video", weight: 3, count: [2, 6], dur: [8, 30], gap: [6, 24], assetCat: "main", bank: NB.bu, realBias: 0.5 },
];

const AUDIO_ROLES: (RoleSpec & { id: RoleId })[] = [
  { id: "score", label: "SCORE", kind: "audio", weight: 8, count: [1, 3], dur: [60, 240], gap: [6, 40], assetCat: "score", bank: NB.score, realBias: 0 },
  { id: "dial", label: "DIALOG", kind: "audio", weight: 10, count: [4, 9], dur: [4, 22], gap: [2, 10], assetCat: "dial", bank: NB.dial, realBias: 0 },
  { id: "vo", label: "VOICEOVER", kind: "audio", weight: 5, count: [2, 6], dur: [5, 24], gap: [8, 34], assetCat: "vo", bank: NB.vo, realBias: 0 },
  { id: "sfx", label: "SFX", kind: "audio", weight: 19, count: [4, 10], dur: [0.3, 2.8], gap: [3, 22], assetCat: "sfx", bank: NB.sfx, realBias: 0 },
  { id: "whoosh", label: "WHOOSH", kind: "audio", weight: 9, count: [4, 11], dur: [0.25, 1.6], gap: [4, 26], assetCat: "sfx", bank: NB.whoosh, realBias: 0 },
  { id: "hits", label: "HITS", kind: "audio", weight: 7, count: [4, 9], dur: [0.4, 2.2], gap: [5, 28], assetCat: "sfx", bank: NB.hits, realBias: 0 },
  { id: "riser", label: "RISERS", kind: "audio", weight: 6, count: [3, 7], dur: [2, 9], gap: [14, 46], assetCat: "sfx", bank: NB.riser, realBias: 0 },
  { id: "foley", label: "FOLEY", kind: "audio", weight: 9, count: [3, 8], dur: [3, 18], gap: [4, 20], assetCat: "foley", bank: NB.foley, realBias: 0 },
  { id: "amb", label: "AMBIENCE", kind: "audio", weight: 7, count: [1, 4], dur: [30, 140], gap: [8, 44], assetCat: "amb", bank: NB.amb, realBias: 0 },
  { id: "sub", label: "SUB DROPS", kind: "audio", weight: 5, count: [3, 8], dur: [0.5, 3], gap: [8, 36], assetCat: "sfx", bank: NB.sub, realBias: 0 },
  { id: "glx", label: "GLITCH", kind: "audio", weight: 5, count: [4, 10], dur: [0.2, 1.1], gap: [5, 30], assetCat: "sfx", bank: NB.glx, realBias: 0 },
];

const SPEED_TASTE = [0.5, 0.5, 0.6, 1.25, 1.5, 2];

function weightedPick<T extends { weight: number }>(r: Rng, specs: T[]): T {
  const total = specs.reduce((m, s) => m + s.weight, 0);
  let roll = r() * total;
  for (const s of specs) {
    roll -= s.weight;
    if (roll <= 0) return s;
  }
  return specs[specs.length - 1];
}

/* ------------------------------------------------------------------ */
/* main builder                                                        */
/* ------------------------------------------------------------------ */
export interface BuildContext {
  tracks: Track[];
  clips: Clip[];
  assets: AssetMeta[];
  outPoint: number | null;
  projectName: string;
}

export function buildFakeEdit(ctx: BuildContext): FakeEditResult | null {
  const existing = ctx.tracks;
  if (existing.length >= TARGET_TRACKS) return null;

  const seed = (Date.now() ^ (ctx.clips.length << 4)) >>> 0;
  const r = mulberry32(seed || 0xC0FFEE);

  // ---- programme duration: strictly the actual media length ---------
  // Elements never spawn past the end of the source video — an 8-minute
  // master yields 8 minutes of elements, a 60-second cut yields 60.
  // With no media at all we fall back to a full 8-minute showreel.
  const longestAsset = ctx.assets.reduce((m, a) => Math.max(m, a.duration || 0), 0);
  const storyEnd = Math.max(timelineEnd(ctx.clips), ctx.outPoint ?? 0, longestAsset);
  const duration = storyEnd > 0.5 ? clamp(storyEnd, 5, 3600) : 480;

  // ---- media pools ----------------------------------------------------
  const { assets: newAssets, byCat } = buildFakeAssets(r);
  const realVideoPool = ctx.assets.filter((a) => a.mediaType === "video" && a.status === "online");
  const findAsset = (cat: string): AssetMeta | null => {
    const pool = byCat.get(cat);
    return pool && pool.length ? pick(r, pool) : null;
  };

  // ---- how many tracks to add ----------------------------------------
  const toAdd = TARGET_TRACKS - existing.length;
  const videoAdd = Math.max(4, Math.round(toAdd * 0.58));
  const audioAdd = toAdd - videoAdd;

  const existVideo = existing.filter((t) => t.kind === "video");
  const existAudio = existing.filter((t) => t.kind === "audio");

  const mkTrack = (kind: "video" | "audio", idx: number, label: string): Track => ({
    id: uid(),
    kind,
    name: `${kind === "video" ? "V" : "A"}${String(idx).padStart(2, "0")} · ${label}`,
    muted: kind === "audio" && chance(r, 0.07),
    solo: false,
    locked: chance(r, 0.035),
    hidden: kind === "video" && chance(r, 0.05),
    volume: kind === "audio" ? Number(range(r, 0.55, 1).toFixed(2)) : 1,
  });

  // ---- clip generator for one role/track ------------------------------
  const clips: Clip[] = [];
  const usedNames = new Set<string>();

  const uniqueName = (bank: string[]): string => {
    for (let i = 0; i < 14; i++) {
      const n = clipName(r, bank);
      if (!usedNames.has(n)) {
        usedNames.add(n);
        return n;
      }
    }
    return clipName(r, bank, 3);
  };

  const genForTrack = (track: Track, role: RoleSpec & { id: RoleId }) => {
    const isVideo = role.kind === "video";
    const realOk = isVideo && realVideoPool.length > 0;
    const nClips = irange(r, role.count[0], role.count[1]);
    const tile = role.id === "cut"; // assembly tracks tile the whole programme

    let cursor = tile ? 0 : range(r, 0, Math.min(30, duration * 0.08));
    for (let i = 0; i < (tile ? 999 : nClips); i++) {
      let cdur = range(r, role.dur[0], role.dur[1]);
      if (cursor >= duration - 0.5) break;
      if (cursor + cdur > duration) cdur = duration - cursor;
      if (cdur < 0.2) break;

      // asset: borrow live footage per role bias, else the nearline pool
      let asset: AssetMeta | null = null;
      if (realOk && chance(r, role.realBias)) asset = pick(r, realVideoPool);
      if (!asset) asset = findAsset(role.assetCat);
      if (!asset) {
        const anyPool = byCat.get(isVideo ? "broll" : "sfx");
        asset = anyPool?.[0] ?? null;
      }
      if (!asset) break;

      const start = Number(cursor.toFixed(3));
      const d = Number(cdur.toFixed(3));
      const speed = role.speedSet
        ? pick(r, role.speedSet)
        : isVideo && chance(r, 0.09)
          ? pick(r, SPEED_TASTE)
          : 1;
      const srcDur = asset.duration > 0 ? asset.duration : d * speed;
      const maxOff = Math.max(0, srcDur - d * speed - 0.05);

      // Clips borrowing the live footage are frame-locked to the timeline
      // (source in-point == timeline position), so wherever one of them sits
      // on top, the program monitor keeps rolling the real video as if it
      // were the only clip there. Junk layers never scramble the picture.
      const borrowed = isVideo && realVideoPool.includes(asset);
      const offset = Number((borrowed ? Math.min(start, maxOff) : range(r, 0, maxOff)).toFixed(3));

      const name = uniqueName(role.bank);

      clips.push({
        id: uid(),
        trackId: track.id,
        assetId: asset.id,
        name: name.endsWith(".MP4") || name.endsWith(".WAV") ? name : `${name}${isVideo ? ".MP4" : ".WAV"}`,
        kind: role.kind,
        start,
        duration: d,
        offset,
        speed,
        volume: isVideo ? 1 : Number(range(r, 0.45, 1).toFixed(2)),
        muted: chance(r, isVideo ? 0.06 : 0.05),
      });

      if (tile) {
        cursor += cdur + range(r, role.gap[0], role.gap[1]);
      } else {
        cursor += cdur + range(r, role.gap[0], role.gap[1]) * range(r, 0.4, 1.6);
      }
    }
  };

  // ---- assign roles to new video tracks -------------------------------
  type WithId = RoleSpec & { id: RoleId };
  const genVideo: Track[] = [];
  const forcedVideoRoles: WithId[] = [
    VIDEO_ROLES.find((x) => x.id === "ttl")!,
    VIDEO_ROLES.find((x) => x.id === "adj")!,
    VIDEO_ROLES.find((x) => x.id === "cut")!,
    VIDEO_ROLES.find((x) => x.id === "broll")!,
  ];
  const vIdx = existVideo.length + 1;
  for (let i = 0; i < videoAdd; i++) {
    const role = i < forcedVideoRoles.length ? forcedVideoRoles[i] : weightedPick(r, VIDEO_ROLES);
    const tr = mkTrack("video", vIdx + i, role.label);
    (tr as Track & { __role?: WithId }).__role = role;
    genVideo.push(tr);
  }

  const genAudio: Track[] = [];
  const forcedAudioRoles: WithId[] = [
    AUDIO_ROLES.find((x) => x.id === "score")!,
    AUDIO_ROLES.find((x) => x.id === "dial")!,
    AUDIO_ROLES.find((x) => x.id === "sfx")!,
  ];
  const aIdx = existAudio.length + 1;
  for (let i = 0; i < audioAdd; i++) {
    const role = i < forcedAudioRoles.length ? forcedAudioRoles[i] : weightedPick(r, AUDIO_ROLES);
    const tr = mkTrack("audio", aIdx + i, role.label);
    (tr as Track & { __role?: WithId }).__role = role;
    genAudio.push(tr);
  }

  for (const tr of [...genVideo, ...genAudio]) {
    const role = (tr as Track & { __role?: WithId }).__role;
    if (role) {
      genForTrack(tr, role);
      delete (tr as Track & { __role?: WithId }).__role;
    }
  }
  void vIdx;
  void aIdx;

  // ---- final order: the imported storyline stays on TOP of the video
  // stack, so active-video resolution always finds the real clip first and
  // playback rolls the actual footage. Every generated layer is scenery
  // parked below it — pure window dressing for the timeline.
  const tracks: Track[] = [
    ...existVideo,
    ...genVideo,
    ...existAudio,
    ...genAudio,
  ];

  // ---- project name: sell the "we're deep in the cut" story -----------
  let projectName = ctx.projectName;
  if (!/_v\d+/i.test(projectName)) {
    projectName = `${projectName.replace(/\.[^.]+$/, "")}_final_v${irange(r, 9, 16)}`;
  }

  return {
    tracks,
    clips: [...ctx.clips, ...clips],
    assets: newAssets,
    duration,
    projectName,
    addedTracks: genVideo.length + genAudio.length,
    addedClips: clips.length,
    addedAssets: newAssets.length,
  };
}
