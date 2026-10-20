"use client";

/**
 * Imperative DOM handles for the per-frame writes (playhead, timecode,
 * meters). Keeping these OUT of React state means the 60fps rAF loop never
 * triggers a re-render — it mutates style/textContent directly.
 */
import { useEditorStore } from "@/lib/store";
import { timelineEnd } from "@/lib/timelineMath";

export const uiRefs = {
  playhead: null as HTMLElement | null,
  scroller: null as HTMLElement | null,
  timecode: null as HTMLElement | null,
  frameStat: null as HTMLElement | null,
  fpsMeter: null as HTMLElement | null,
  memMeter: null as HTMLElement | null,
};

/** Fit the whole sequence into the visible timeline viewport. */
export function fitTimeline(): void {
  const st = useEditorStore.getState();
  const sc = uiRefs.scroller;
  const dur = Math.max(timelineEnd(st.clips), st.outPoint ?? 0, 10) + 2;
  const width = sc ? sc.clientWidth - 32 : 900;
  st.setPxps(Math.max(6, Math.min(900, width / dur)));
}

/** Toggle whole-workspace fullscreen (chromeless editor surface). */
export function toggleAppFullscreen(): void {
  if (typeof document === "undefined") return;
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => undefined);
  } else {
    void document.documentElement.requestFullscreen().catch(() => undefined);
  }
}
