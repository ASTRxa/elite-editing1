"use client";

import { clamp } from "./format";
import { getAssetUrl } from "./media";
import { useEditorStore } from "./store";
import {
  activeAudioItems,
  activeVideoClip,
  clipEnd,
  isTrackAudible,
  timelineEnd,
  visibleVideoTracks,
  EPS,
} from "./timelineMath";

export type StageStatus = "ok" | "empty" | "offline";

/**
 * Frame-accurate playback engine.
 *
 * A virtual clock drives the timeline (never the media element's own time),
 * so the playhead never stutters when sources swap. Two stacked <video>
 * elements act as a double buffer: the next clip is prepared and seeked on
 * the hidden element, then flipped on. Audio-track clips run through a pool
 * of <audio> elements with wall-clock drift correction.
 */
class PlayerEngine {
  time = 0;
  playing = false;

  private anchorClock = 0;
  private anchorTime = 0;
  private elA: HTMLVideoElement | null = null;
  private elB: HTMLVideoElement | null = null;
  private activeEl: HTMLVideoElement | null = null;
  private currentClipId: string | null = null;
  private audioEls = new Map<string, HTMLAudioElement>();
  private audioDriftStamp = new WeakMap<HTMLAudioElement, number>();
  private lastDrift = 0;
  private lastScrubSeek = 0;
  private status: StageStatus = "empty";
  private statusCb: ((s: StageStatus) => void) | null = null;

  attach(container: HTMLElement, cb: (s: StageStatus) => void): void {
    this.statusCb = cb;
    if (!this.elA) {
      for (const key of ["elA", "elB"] as const) {
        const el = document.createElement("video");
        el.className = "stage-media";
        el.muted = true;
        el.playsInline = true;
        el.preload = "auto";
        this[key] = el;
        container.appendChild(el);
      }
    } else {
      container.appendChild(this.elA);
      if (this.elB) container.appendChild(this.elB);
    }
  }

  detach(): void {
    this.pause();
    for (const el of [this.elA, this.elB]) {
      if (!el) continue;
      el.removeAttribute("src");
      el.load();
      el.remove();
    }
    this.elA = null;
    this.elB = null;
    this.activeEl = null;
    this.currentClipId = null;
    for (const [, el] of this.audioEls) {
      el.pause();
      el.removeAttribute("src");
    }
    this.audioEls.clear();
    this.statusCb = null;
  }

  private contentRange(): { start: number; end: number } {
    const st = useEditorStore.getState();
    const end = st.outPoint ?? timelineEnd(st.clips);
    return { start: st.inPoint ?? 0, end };
  }

  hasContent(): boolean {
    return this.contentRange().end > 0.05;
  }

  play(): void {
    if (this.playing || !this.hasContent()) return;
    const range = this.contentRange();
    if (this.time >= range.end - 0.03) this.time = range.start;
    this.anchorTime = this.time;
    this.anchorClock = performance.now();
    this.playing = true;
    this.syncElements(true, performance.now());
  }

  pause(): void {
    this.playing = false;
    this.activeEl?.pause();
    for (const [, el] of this.audioEls) el.pause();
  }

  togglePlay(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  setTime(t: number): void {
    this.time = Math.max(0, t);
    this.anchorTime = this.time;
    this.anchorClock = performance.now();
    this.syncElements(true, performance.now());
  }

  stepFrames(n: number, fps: number): void {
    this.pause();
    this.setTime(this.time + n / Math.max(1, fps));
  }

  /** Called once per rAF by the editor shell. */
  tick(now: number): void {
    if (this.playing) {
      this.time = this.anchorTime + (now - this.anchorClock) / 1000;
      const range = this.contentRange();
      const span = range.end - range.start;
      if (range.end > 0.05 && this.time >= range.end - EPS) {
        const st = useEditorStore.getState();
        if (st.loopPlayback && span > 0.1) {
          this.time = range.start + ((this.time - range.start) % span);
          this.anchorTime = this.time;
          this.anchorClock = now;
        } else {
          this.time = range.end;
          this.pause();
        }
      }
    }
    this.syncElements(false, now);
  }

  private setStatus(s: StageStatus): void {
    if (this.status !== s) {
      this.status = s;
      this.statusCb?.(s);
    }
  }

  private hideStage(): void {
    this.elA?.classList.remove("on");
    this.elB?.classList.remove("on");
    this.elA?.pause();
    this.elB?.pause();
    this.activeEl = null;
    this.currentClipId = null;
  }

  private syncElements(force: boolean, now: number): void {
    if (!this.elA || !this.elB) return;
    const st = useEditorStore.getState();
    const t = this.time;

    // ---- video path ------------------------------------------------------
    const av = activeVideoClip(st.tracks, st.clips, t);
    if (!av) {
      // distinguish "media offline" from "nothing here"
      let offline = false;
      for (const track of visibleVideoTracks(st.tracks)) {
        const c = st.clips.find(
          (x) => x.trackId === track.id && x.start - EPS <= t && t < clipEnd(x)
        );
        if (c && !getAssetUrl(c.assetId)) offline = true;
      }
      this.setStatus(offline ? "offline" : "empty");
      if (this.currentClipId !== null || force) this.hideStage();
    } else {
      const { clip, track } = av;
      const url = getAssetUrl(clip.assetId);
      if (!url) {
        this.setStatus("offline");
        this.hideStage();
      } else {
        this.setStatus("ok");
        const srcT = clip.offset + (t - clip.start) * clip.speed;
        const vol = clamp(
          st.masterVolume * track.volume * (clip.muted ? 0 : clip.volume),
          0, 1
        );
        const audible = isTrackAudible(track, st.tracks) && !clip.muted && vol > 0.001;

        /** Clamp any seek target inside the real media — seeking past the end
         *  then calling play() makes an ended element restart from 0. */
        const clampSrc = (el: HTMLVideoElement): number => {
          const d = el.duration;
          return Number.isFinite(d) && d > 0
            ? Math.min(srcT, Math.max(0, d - 0.05))
            : srcT;
        };
        const isExhausted = (el: HTMLVideoElement): boolean => {
          const d = el.duration;
          return Number.isFinite(d) && d > 0 && srcT >= d - 0.045;
        };

        if (this.activeEl && this.currentClipId === clip.id && this.activeEl.dataset.url === url) {
          const el = this.activeEl;
          el.muted = !audible;
          el.volume = vol;
          const exhausted = isExhausted(el);
          if (!exhausted && Math.abs(el.playbackRate - clip.speed) > 0.001) el.playbackRate = clip.speed;
          const drift = Math.abs(el.currentTime - srcT);
          if (this.playing) {
            if (!exhausted && el.paused) void el.play().catch(() => undefined);
            if (exhausted && !el.paused) el.pause(); // hold the last frame
            if (!exhausted && drift > 0.14 && now - this.lastDrift > 240) {
              el.currentTime = clampSrc(el);
              this.lastDrift = now;
            }
          } else if (drift > 0.035 && (force || now - this.lastScrubSeek > 34)) {
            el.currentTime = clampSrc(el);
            this.lastScrubSeek = now;
          }
        } else {
          const next = this.activeEl === this.elA ? this.elB : this.elA;
          if (next.dataset.url !== url) {
            next.src = url;
            next.dataset.url = url;
          }
          next.playbackRate = clip.speed;
          next.muted = !audible;
          next.volume = vol;
          const seekTarget = clampSrc(next);
          try {
            next.currentTime = Math.max(0, seekTarget);
          } catch {
            /* not seekable yet — handled by seeked fallback */
          }
          let flipped = false;
          const flip = () => {
            if (flipped) return;
            flipped = true;
            next.classList.add("on");
            if (this.activeEl && this.activeEl !== next) {
              this.activeEl.classList.remove("on");
              this.activeEl.pause();
            }
            this.activeEl = next;
            this.currentClipId = clip.id;
            // never call play() on an element whose media is past its end —
            // HTMLMediaElement.play() restarts ended media from 0s.
            if (this.playing && !isExhausted(next)) void next.play().catch(() => undefined);
          };
          next.addEventListener("seeked", flip, { once: true });
          window.setTimeout(flip, 450);
        }
      }
    }

    // ---- audio path ------------------------------------------------------
    const items = activeAudioItems(st.tracks, st.clips, t);
    const liveIds = new Set(items.map((i) => i.clip.id));
    for (const { clip, track } of items) {
      const url = getAssetUrl(clip.assetId);
      if (!url) continue;
      let el = this.audioEls.get(clip.id);
      if (!el) {
        el = document.createElement("audio");
        el.preload = "auto";
        this.audioEls.set(clip.id, el);
      }
      if (el.dataset.url !== url) {
        el.src = url;
        el.dataset.url = url;
      }
      const srcT = clip.offset + (t - clip.start) * clip.speed;
      el.volume = clamp(st.masterVolume * track.volume * clip.volume, 0, 1);
      if (Math.abs(el.playbackRate - clip.speed) > 0.001) el.playbackRate = clip.speed;
      const drift = Math.abs(el.currentTime - srcT);
      if (this.playing) {
        if (el.paused) void el.play().catch(() => undefined);
        const stamp = this.audioDriftStamp.get(el) ?? 0;
        if (drift > 0.16 && now - stamp > 260) {
          el.currentTime = srcT;
          this.audioDriftStamp.set(el, now);
        }
      } else if (drift > 0.05) {
        el.currentTime = srcT;
      }
    }
    const clipIds = new Set(st.clips.map((c) => c.id));
    for (const [id, el] of this.audioEls) {
      if (!clipIds.has(id)) {
        el.pause();
        el.removeAttribute("src");
        this.audioEls.delete(id);
        continue;
      }
      if (!liveIds.has(id) && !el.paused) el.pause();
    }
  }
}

let engine: PlayerEngine | null = null;

export function getPlayer(): PlayerEngine {
  if (!engine) engine = new PlayerEngine();
  return engine;
}
