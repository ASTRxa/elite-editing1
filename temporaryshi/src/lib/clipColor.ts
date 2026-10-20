import type { CSSProperties } from "react";
import type { TrackKind } from "./types";

/**
 * Label colors, NLE-style. Department prefixes baked into clip names map to
 * distinct track hues so a dense timeline reads as departments at a glance
 * (titles ≠ b-roll ≠ whooshes ≠ score). Clips with unrecognized names (e.g.
 * the user's own imports) keep the stock editor palette.
 */

const VIDEO_LABELS: [RegExp, number][] = [
  [/^TTL_|^SUB_EN/i, 314], // titles & subtitles — magenta
  [/^LR_/i, 288], // lower thirds — purple
  [/^ADJ_|^LUT_|^CC_/i, 258], // grade / adjustment — violet
  [/^BROLL_/i, 213], // b-roll — steel blue
  [/^FX_LIGHTLEAK|^FX_BURN/i, 30], // light leaks — warm orange
  [/^FX_/i, 20], // overlays — amber-orange
  [/^PIP_/i, 172], // picture-in-picture — teal
  [/^RAMP_/i, 44], // speed ramps — gold
  [/^TRN_|^STAB_/i, 348], // transitions — crimson
  [/^MATTE_/i, 276], // mattes — deep purple
  [/^VFX_/i, 194], // vfx plates — cyan
  [/^STILL_/i, 106], // stills — lime
  [/^SELECTS_/i, 204], // selects — sky blue
  [/^CUT_/i, 228], // assembly cuts — indigo
  [/^BU_/i, 88], // backups — olive
];

const AUDIO_LABELS: [RegExp, number][] = [
  [/^SCORE_|^BED_/i, 152], // score — emerald
  [/^DIAL_/i, 188], // dialogue — cyan
  [/^VO_/i, 210], // voiceover — azure
  [/^WHOOSH_/i, 62], // whooshes — yellow
  [/^HIT_/i, 2], // hits — red
  [/^RISER_/i, 28], // risers — orange
  [/^SUB_/i, 340], // sub drops — raspberry
  [/^GLTX_/i, 322], // glitch — hot pink
  [/^SFX_/i, 42], // sfx — amber
  [/^FLY_/i, 96], // foley — lime
  [/^AMB_/i, 130], // ambience — green
];

/** Deterministic hue for a clip name — null if it isn't a known department. */
export function clipLabelHue(name: string, kind: TrackKind): number | null {
  const table = kind === "audio" ? AUDIO_LABELS : VIDEO_LABELS;
  for (const [re, hue] of table) if (re.test(name)) return hue;
  return null;
}

/**
 * Inline background/border vars in the clip's department hue.
 * Returns null for unrecognized clips so the stock theme survives.
 */
export function clipLabelStyle(name: string, kind: TrackKind): CSSProperties | null {
  const hue = clipLabelHue(name, kind);
  if (hue === null) return null;
  const [s1, l1, s2, l2] = kind === "audio" ? [40, 37, 46, 23] : [44, 41, 48, 26];
  return {
    background: `linear-gradient(180deg, hsl(${hue} ${s1}% ${l1}%), hsl(${hue} ${s2}% ${l2}%))`,
    borderColor: `hsl(${hue} 70% 62% / 0.5)`,
  };
}
