"use client";

import {
  Crosshair,
  Download,
  Eye,
  EyeOff,
  Film,
  Lock,
  Magnet,
  Music,
  Plus,
  Scissors,
  Trash2,
  Unlock,
  VolumeX,
} from "lucide-react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { clipLabelStyle } from "@/lib/clipColor";
import { clamp, timecode } from "@/lib/format";
import { getPlayer } from "@/lib/player";
import { useEditorStore } from "@/lib/store";
import {
  clampTrimLeft,
  clampTrimRight,
  clipsOnTrack,
  snapPoints,
  snapValue,
  timelineEnd,
} from "@/lib/timelineMath";
import type { AssetMeta, Clip, Track } from "@/lib/types";
import { uiRefs } from "./uiRefs";

const RULER_H = 30;
const ROW_H = 30;

interface DragState {
  mode: "move" | "trim-l" | "trim-r";
  clipId: string;
  startClientX: number;
  orig: { start: number; duration: number; offset: number; trackId: string };
  candidates: number[];
  moved: boolean;
}

interface Preview {
  start: number;
  duration: number;
  offset: number;
  trackId: string;
}

/** cached peak→path conversions so waveforms render for free */
const wavePathCache = new Map<string, string>();
function wavePath(assetId: string, peaks: number[]): string {
  const cached = wavePathCache.get(assetId);
  if (cached) return cached;
  const N = peaks.length;
  const mid = 20;
  const top: string[] = [];
  for (let i = 0; i < N; i++) top.push(`L${((i / (N - 1)) * 160).toFixed(1)} ${(mid - peaks[i] * 17).toFixed(1)}`);
  let d = `M0 ${mid} ${top.join(" ")}`;
  for (let i = N - 1; i >= 0; i--) d += ` L${((i / (N - 1)) * 160).toFixed(1)} ${(mid + peaks[i] * 17).toFixed(1)}`;
  d += " Z";
  if (wavePathCache.size > 64) wavePathCache.clear();
  wavePathCache.set(assetId, d);
  return d;
}

interface ClipViewProps {
  clip: Clip;
  asset: AssetMeta | undefined;
  selected: boolean;
  renaming: boolean;
  preview: Preview | null;
  onPress: (e: ReactPointerEvent, clip: Clip) => void;
  onMenu: (e: React.MouseEvent, clip: Clip) => void;
}

const ClipView = memo(function ClipView({
  clip,
  asset,
  selected,
  renaming,
  preview,
  onPress,
  onMenu,
}: ClipViewProps) {
  const g = preview ?? clip;
  const setRenameClipId = useEditorStore((s) => s.setRenameClipId);
  const renameClip = useEditorStore((s) => s.renameClip);
  const [draft, setDraft] = useState(clip.name);

  useEffect(() => {
    if (renaming) setDraft(clip.name);
  }, [renaming, clip.name]);

  const commitRename = () => {
    const name = draft.trim();
    if (name && name !== clip.name) renameClip(clip.id, name);
    setRenameClipId(null);
  };

  const isAudio = clip.kind === "audio";
  const wave = isAudio && asset?.peaks ? wavePath(asset.id, asset.peaks) : null;
  const labelStyle = clipLabelStyle(clip.name, clip.kind);

  return (
    <div
      className={`clip ${isAudio ? "audio-clip" : "video-clip"}${selected ? " selected" : ""}${preview ? " dragging" : ""}${clip.muted ? " muted-clip" : ""}`}
      style={{ "--start": g.start, "--dur": g.duration, ...labelStyle } as CSSProperties}
      role="button"
      tabIndex={0}
      aria-label={`${clip.name} clip, starts at ${clip.start.toFixed(2)} seconds`}
      onFocus={() => useEditorStore.getState().selectClip(clip.id)}
      onPointerDown={(e) => onPress(e, clip)}
      onContextMenu={(e) => onMenu(e, clip)}
      onDoubleClick={() => setRenameClipId(clip.id)}
      title={clip.name}
    >
      {!isAudio && asset?.thumb && (
        <div className="clip-thumb-strip" style={{ backgroundImage: `url(${asset.thumb})` }} />
      )}
      {wave && (
        <svg className="wave-svg" viewBox="0 0 160 40" preserveAspectRatio="none" aria-hidden="true">
          <path d={wave} fill="rgba(162, 242, 216, 0.4)" />
        </svg>
      )}
      <div className="clipname">
        {renaming ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenameClipId(null);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              font: "10px var(--font-ui)",
              background: "rgba(0,0,0,.55)",
              border: "1px solid rgba(255,255,255,.35)",
              borderRadius: 3,
              color: "#fff",
              padding: "1px 4px",
              width: 120,
              pointerEvents: "auto",
            }}
            aria-label="Rename clip"
          />
        ) : (
          <>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{clip.name}</span>
            {clip.speed !== 1 && <span className="badge">{clip.speed.toFixed(2)}x</span>}
            {clip.muted && <VolumeX size={9} />}
          </>
        )}
      </div>
      <div className="handle l" data-handle="trim-l" aria-hidden="true" />
      <div className="handle r" data-handle="trim-r" aria-hidden="true" />
    </div>
  );
});

function trackColor(kind: Track["kind"], index: number): string {
  if (kind === "audio") return index % 2 ? "#3f8f76" : "#57d6a0";
  return index % 2 ? "#7b6cf0" : "#658cff";
}

export default function Timeline() {
  const tracks = useEditorStore((s) => s.tracks);
  const clips = useEditorStore((s) => s.clips);
  const assets = useEditorStore((s) => s.assets);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const tool = useEditorStore((s) => s.tool);
  const pxps = useEditorStore((s) => s.pxps);
  const setPxps = useEditorStore((s) => s.setPxps);
  const tab = useEditorStore((s) => s.timelineTab);
  const setTab = useEditorStore((s) => s.setTimelineTab);
  const meta = useEditorStore((s) => s.meta);
  const inPoint = useEditorStore((s) => s.inPoint);
  const outPoint = useEditorStore((s) => s.outPoint);
  const renameClipId = useEditorStore((s) => s.renameClipId);
  const addTrack = useEditorStore((s) => s.addTrack);

  const [snapping, setSnapping] = useState(true);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [preview, setPreview] = useState<(Preview & { clipId: string }) | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; clipId: string } | null>(null);
  const [viewportW, setViewportW] = useState(900);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const labelRowsRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLCanvasElement>(null);
  const pxpsRef = useRef(pxps);
  const snappingRef = useRef(snapping);
  pxpsRef.current = pxps;
  snappingRef.current = snapping;

  const dur = Math.max(timelineEnd(clips), outPoint ?? 0, 30) + 6;
  const contentWidth = Math.max(dur * pxps, viewportW);

  // viewport size tracking for ruler/content min width
  useEffect(() => {
    const el = scrollerRef.current;
    uiRefs.scroller = el;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportW(el.clientWidth));
    ro.observe(el);
    setViewportW(el.clientWidth);
    return () => {
      ro.disconnect();
      uiRefs.scroller = null;
    };
  }, []);

  // sync the label column with vertical scroll
  const onScroll = useCallback(() => {
    if (labelRowsRef.current && scrollerRef.current) {
      labelRowsRef.current.style.transform = `translateY(${-scrollerRef.current.scrollTop}px)`;
    }
  }, []);

  // ---- ruler --------------------------------------------------------------
  useLayoutEffect(() => {
    const canvas = rulerRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = contentWidth;
    canvas.width = Math.round(w * dpr);
    canvas.height = RULER_H * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${RULER_H}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, RULER_H);
    const steps = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const step = steps.find((s) => s * pxps >= 56) ?? 600;
    ctx.font = "9px JetBrains Mono, ui-monospace, monospace";
    ctx.textBaseline = "top";

    // sub-ticks
    ctx.strokeStyle = "#333b4d";
    ctx.beginPath();
    const sub = step / 4;
    for (let t = 0; t <= dur; t += sub) {
      const x = Math.round(t * pxps) + 0.5;
      ctx.moveTo(x, 24);
      ctx.lineTo(x, RULER_H);
    }
    ctx.stroke();

    // main ticks
    ctx.strokeStyle = "#4a5470";
    ctx.fillStyle = "#8d99b5";
    ctx.beginPath();
    for (let t = 0; t <= dur; t += step) {
      const x = Math.round(t * pxps) + 0.5;
      ctx.moveTo(x, 16);
      ctx.lineTo(x, RULER_H);
      const mm = Math.floor(t / 60);
      const ss = Math.floor(t % 60);
      ctx.fillText(`${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`, x + 4, 5);
    }
    ctx.stroke();

    // in/out flags
    const flag = (t: number, label: string, color: string) => {
      const x = t * pxps;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, 2);
      ctx.lineTo(x + 8, 2);
      ctx.lineTo(x + 4, 10);
      ctx.lineTo(x, 10);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(x - 0.5, 2, 1, RULER_H - 2);
      ctx.fillText(label, x + 11, 4);
    };
    if (inPoint !== null) flag(inPoint, "IN", "#a78bfa");
    if (outPoint !== null) flag(outPoint, "OUT", "#a78bfa");
  }, [contentWidth, pxps, dur, inPoint, outPoint]);

  const clientToTime = useCallback((clientX: number): number => {
    const el = contentRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left) / pxpsRef.current);
  }, []);

  // ---- ruler scrub + in/out dragging ---------------------------------------
  const onRulerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const t = clientToTime(e.clientX);
    const flagGrab = 8 / pxpsRef.current;
    let mode: "scrub" | "in" | "out" = "scrub";
    if (inPoint !== null && Math.abs(t - inPoint) < flagGrab) mode = "in";
    else if (outPoint !== null && Math.abs(t - outPoint) < flagGrab) mode = "out";

    const st = useEditorStore.getState();
    if (mode === "scrub") getPlayer().setTime(t);
    else if (mode === "in") st.setInPoint(t);
    else st.setOutPoint(t);

    const move = (ev: globalThis.PointerEvent) => {
      const tt = clientToTime(ev.clientX);
      if (mode === "scrub") getPlayer().setTime(tt);
      else if (mode === "in") useEditorStore.getState().setInPoint(tt);
      else useEditorStore.getState().setOutPoint(tt);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  // ---- clip drag / trim with snapping --------------------------------------
  const onClipPress = useCallback(
    (e: ReactPointerEvent, clip: Clip) => {
      if (e.button === 2) return;
      const st = useEditorStore.getState();
      if (st.tool === "hand") return; // let the pan handler take it
      e.stopPropagation();
      st.selectClip(clip.id);

      if (st.tool === "razor") {
        const t = clientToTime(e.clientX);
        st.splitClipAt(clip.id, t);
        return;
      }
      const track = st.tracks.find((x) => x.id === clip.trackId);
      if (track?.locked) {
        st.toast("Track is locked", "warn");
        return;
      }

      const handle = (e.target as HTMLElement).dataset.handle as "trim-l" | "trim-r" | undefined;
      const extra = [getPlayer().time];
      if (st.inPoint !== null) extra.push(st.inPoint);
      if (st.outPoint !== null) extra.push(st.outPoint);
      const asset = st.assets.find((a) => a.id === clip.assetId);
      const srcDur = asset && asset.duration > 0 ? asset.duration : clip.offset + clip.duration * clip.speed;

      const ds: DragState = {
        mode: handle ?? "move",
        clipId: clip.id,
        startClientX: e.clientX,
        orig: { start: clip.start, duration: clip.duration, offset: clip.offset, trackId: clip.trackId },
        candidates: snapPoints(st.clips, clip.id, extra),
        moved: false,
      };
      setDrag(ds);

      const move = (ev: globalThis.PointerEvent) => {
        const dx = ev.clientX - ds.startClientX;
        if (!ds.moved && Math.abs(dx) < 3) return;
        ds.moved = true;
        const pxNow = pxpsRef.current;
        const dtSec = dx / pxNow;
        const thr = snappingRef.current ? 9 / pxNow : 0;
        const cur = useEditorStore.getState();

        if (ds.mode === "move") {
          let start = ds.orig.start + dtSec;
          const snappedStart = snapValue(start, ds.candidates, thr);
          if (snappedStart !== start) {
            start = snappedStart;
          } else {
            const endS = snapValue(start + ds.orig.duration, ds.candidates, thr);
            if (endS !== start + ds.orig.duration) start = endS - ds.orig.duration;
          }
          // vertical: which row is the pointer over?
          let trackId = ds.orig.trackId;
          const el = contentRef.current;
          if (el) {
            const rect = el.getBoundingClientRect();
            const row = Math.floor((ev.clientY - rect.top - RULER_H) / ROW_H);
            const target = cur.tracks[row];
            if (target && target.kind === clip.kind) trackId = target.id;
          }
          const clamped = clamp(start, 0, Number.POSITIVE_INFINITY);
          setPreview({ clipId: clip.id, start: Math.max(0, clamped), duration: ds.orig.duration, offset: ds.orig.offset, trackId });
        } else if (ds.mode === "trim-l") {
          const desired = snapValue(ds.orig.start + dtSec, ds.candidates, thr);
          const sorted = clipsOnTrack(cur.clips, ds.orig.trackId);
          const origClip: Clip = { ...clip, start: ds.orig.start, duration: ds.orig.duration, offset: ds.orig.offset, trackId: ds.orig.trackId };
          const patch = clampTrimLeft(sorted, origClip, desired);
          setPreview({ clipId: clip.id, ...patch, trackId: ds.orig.trackId });
        } else {
          const desiredEnd = snapValue(ds.orig.start + ds.orig.duration + dtSec, ds.candidates, thr);
          const sorted = clipsOnTrack(cur.clips, ds.orig.trackId);
          const origClip: Clip = { ...clip, start: ds.orig.start, duration: ds.orig.duration, offset: ds.orig.offset, trackId: ds.orig.trackId };
          const duration = clampTrimRight(sorted, origClip, srcDur, desiredEnd - ds.orig.start);
          setPreview({ clipId: clip.id, start: ds.orig.start, duration, offset: ds.orig.offset, trackId: ds.orig.trackId });
        }
      };

      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        const st2 = useEditorStore.getState();
        const currentPreview = ds.moved ? previewRef.current : null;
        if (currentPreview) {
          if (ds.mode === "move") st2.commitMove(clip.id, currentPreview.start, currentPreview.trackId);
          else if (ds.mode === "trim-l") st2.commitTrimLeft(clip.id, currentPreview.start);
          else st2.commitTrimRight(clip.id, currentPreview.duration);
        }
        setDrag(null);
        setPreview(null);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [clientToTime]
  );

  // preview ref so the pointerup closure sees the latest value
  const previewRef = useRef<typeof preview>(null);
  previewRef.current = preview;

  // ---- hand-tool panning -----------------------------------------------------
  const onContentDown = (e: ReactPointerEvent) => {
    const st = useEditorStore.getState();
    if (st.tool !== "hand") {
      if (!(e.target as HTMLElement).closest(".clip")) st.selectClip(null);
      return;
    }
    const el = scrollerRef.current;
    if (!el) return;
    e.preventDefault();
    el.classList.add("panning");
    const sx = e.clientX;
    const sy = e.clientY;
    const sl = el.scrollLeft;
    const stTop = el.scrollTop;
    const move = (ev: globalThis.PointerEvent) => {
      el.scrollLeft = sl - (ev.clientX - sx);
      el.scrollTop = stTop - (ev.clientY - sy);
    };
    const up = () => {
      el.classList.remove("panning");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ---- context menu ----------------------------------------------------------
  const onClipMenu = useCallback((e: React.MouseEvent, clip: Clip) => {
    e.preventDefault();
    useEditorStore.getState().selectClip(clip.id);
    setCtxMenu({ x: e.clientX, y: e.clientY, clipId: clip.id });
  }, []);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [ctxMenu]);

  const ctxClip = ctxMenu ? clips.find((c) => c.id === ctxMenu.clipId) : null;

  // ---- zoom ------------------------------------------------------------------
  const zoomSliderVal = (Math.log(pxps / 6) / Math.log(150)) * 100;
  const setZoomFromSlider = (v: number) => setPxps(6 * Math.pow(150, v / 100));

  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);

  return (
    <section className="timeline" aria-label="Timeline">
      <div className="timeline-head">
        <button className={`tl-tab${tab === "timeline" ? " active" : ""}`} onClick={() => setTab("timeline")}>
          Timeline
        </button>
        <button className={`tl-tab${tab === "graph" ? " active" : ""}`} onClick={() => setTab("graph")}>
          Graph Editor
        </button>
        <button className={`tl-tab${tab === "mixer" ? " active" : ""}`} onClick={() => setTab("mixer")}>
          Audio Mixer
        </button>
        <span className="spacer" style={{ flex: 1 }} />
        <span className="timeline-stat">
          {tracks.length} TRACKS · {clips.length} CLIPS · {assets.length} ASSETS
        </span>
        <button className="tool" title="Add video track" onClick={() => addTrack("video")}>
          <Film size={13} />
          <Plus size={9} style={{ marginLeft: -3 }} />
        </button>
        <button className="tool" title="Add audio track" onClick={() => addTrack("audio")}>
          <Music size={13} />
          <Plus size={9} style={{ marginLeft: -3 }} />
        </button>
        <button
          className="tool"
          title="Center playhead"
          onClick={() => {
            const sc = scrollerRef.current;
            if (sc) sc.scrollLeft = Math.max(0, getPlayer().time * pxps - sc.clientWidth / 2);
          }}
        >
          <Crosshair size={13} />
        </button>
        <span style={{ color: "#77839b", fontSize: 10 }}>−</span>
        <input
          className="zoom-slider"
          type="range"
          min={0}
          max={100}
          step={1}
          value={zoomSliderVal}
          onChange={(e) => setZoomFromSlider(Number(e.target.value))}
          aria-label="Timeline zoom"
          title={`Zoom: ${pxps.toFixed(0)} px/sec`}
        />
        <span style={{ color: "#77839b", fontSize: 10 }}>＋</span>
      </div>

      {tab === "timeline" ? (
        <div className="timeline-main">
          <div className="tracklabels" aria-hidden="false">
            <div className="ruler-label">LAYER / SOURCE</div>
            <div className="tracklabel-rows" ref={labelRowsRef}>
              {tracks.map((track, i) => (
                <TrackLabel key={track.id} track={track} index={i} />
              ))}
            </div>
          </div>

          <div
            className={`timeline-scroll${tool === "hand" ? " tool-hand" : ""}`}
            ref={scrollerRef}
            onScroll={onScroll}
          >
            <div
              className="timeline-content"
              ref={contentRef}
              style={{ width: contentWidth, "--pxps": `${pxps}px` } as CSSProperties}
              onPointerDown={onContentDown}
            >
              <div className="ruler" onPointerDown={onRulerDown}>
                <canvas ref={rulerRef} />
              </div>
              {inPoint !== null && outPoint !== null && (
                <div
                  className="inout-region"
                  style={{ left: inPoint * pxps, width: Math.max(2, (outPoint - inPoint) * pxps), top: RULER_H }}
                  aria-hidden="true"
                />
              )}
              <div id="tracks">
                {tracks.map((track) => (
                  <div
                    key={track.id}
                    className={`track${track.muted ? " track-muted" : ""}`}
                    data-track={track.id}
                  >
                    {clips
                      .filter((c) => c.trackId === track.id)
                      .map((clip) => (
                        <ClipView
                          key={clip.id}
                          clip={clip}
                          asset={assetById.get(clip.assetId)}
                          selected={clip.id === selectedClipId}
                          renaming={clip.id === renameClipId}
                          preview={preview && preview.clipId === clip.id ? preview : null}
                          onPress={onClipPress}
                          onMenu={onClipMenu}
                        />
                      ))}
                  </div>
                ))}
              </div>

              <div
                className="playhead"
                ref={(el) => {
                  uiRefs.playhead = el;
                }}
                aria-hidden="true"
              >
                <div className="ph-head" />
                <div className="ph-line" />
                <div className="ph-glow" />
              </div>

              {clips.length === 0 && (
                <div className="drop-hint">
                  <Download size={20} strokeWidth={1.5} />
                  <span>
                    Timeline is empty — drop MP4/MOV/WEBM files anywhere, then double-click a
                    thumbnail to place it at the playhead.
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : tab === "graph" ? (
        <GraphView clips={clips} tracks={tracks} selectedClipId={selectedClipId} pxps={pxps} dur={dur} />
      ) : (
        <MixerView tracks={tracks} clips={clips} />
      )}

      <div className="timeline-foot">
        <button
          className={`transport-tool${snapping ? " active" : ""}`}
          style={{ width: "auto", padding: "0 8px", gap: 5, height: 18, fontSize: 9, fontFamily: "var(--font-mono)" }}
          onClick={() => setSnapping(!snapping)}
          aria-pressed={snapping}
          title="Magnetic snapping to clip edges, playhead and markers"
        >
          <Magnet size={10} />
          SNAP {snapping ? "ON" : "OFF"}
        </button>
        <span
          className="frame-status"
          ref={(el) => {
            uiRefs.frameStat = el;
          }}
        >
          FRAME 0000 / 0000
        </span>
        <span>
          {inPoint !== null || outPoint !== null
            ? `RANGE ${inPoint !== null ? timecode(inPoint, meta.fps) : "--:--:--"} — ${
                outPoint !== null ? timecode(outPoint, meta.fps) : "--:--:--"
              }`
            : "NO RANGE SET — I / O TO MARK"}
        </span>
        <span style={{ color: "#5b657c" }}>{drag ? "DRAGGING" : `${tool.toUpperCase()} TOOL`}</span>
      </div>

      {ctxMenu && ctxClip && (
        <div
          className="ctx-menu"
          style={{ left: Math.min(ctxMenu.x, window.innerWidth - 224), top: Math.min(ctxMenu.y, window.innerHeight - 300) }}
          role="menu"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <CtxItem
            label="Split at playhead"
            kbd="S"
            onClick={() => {
              useEditorStore.getState().splitClipAt(ctxClip.id, getPlayer().time);
              setCtxMenu(null);
            }}
          />
          <CtxItem
            label="Duplicate"
            kbd="Ctrl+D"
            onClick={() => {
              useEditorStore.getState().duplicateClip(ctxClip.id);
              setCtxMenu(null);
            }}
          />
          <CtxItem
            label="Rename"
            onClick={() => {
              useEditorStore.getState().setRenameClipId(ctxClip.id);
              setCtxMenu(null);
            }}
          />
          <CtxItem
            label={ctxClip.muted ? "Unmute" : "Mute"}
            kbd="M"
            onClick={() => {
              useEditorStore.getState().toggleClipMute(ctxClip.id);
              setCtxMenu(null);
            }}
          />
          <div className="menu-sep" />
          <div style={{ padding: "4px 8px 6px", font: "9px var(--font-mono)", color: "#67718a", letterSpacing: 0.6 }}>
            SPEED
          </div>
          <div style={{ display: "flex", gap: 4, padding: "0 6px 6px", flexWrap: "wrap" }}>
            {[0.25, 0.5, 1, 1.5, 2, 4].map((sp) => (
              <button
                key={sp}
                className="look-chip"
                style={ctxClip.speed === sp ? { borderColor: "#6652ac", color: "#cdbfff" } : undefined}
                onClick={() => {
                  useEditorStore.getState().setClipSpeed(ctxClip.id, sp);
                  setCtxMenu(null);
                }}
              >
                {sp}x
              </button>
            ))}
          </div>
          <div className="menu-sep" />
          <CtxItem
            label="Delete clip"
            kbd="Del"
            danger
            onClick={() => {
              useEditorStore.getState().deleteClip(ctxClip.id);
              setCtxMenu(null);
            }}
          />
        </div>
      )}
    </section>
  );
}

function CtxItem({ label, kbd, danger, onClick }: { label: string; kbd?: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      className="menu-item"
      role="menuitem"
      style={danger ? { color: "#ffb3c0" } : undefined}
      onClick={onClick}
    >
      <Scissors size={13} style={{ opacity: 0 }} aria-hidden="true" />
      {label}
      {kbd && <span className="kbd">{kbd}</span>}
    </button>
  );
}

function TrackLabel({ track, index }: { track: Track; index: number }) {
  const setTrackFlag = useEditorStore((s) => s.setTrackFlag);
  const removeTrack = useEditorStore((s) => s.removeTrack);
  const renameTrack = useEditorStore((s) => s.renameTrack);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(track.name);

  const commit = () => {
    const name = draft.trim();
    if (name && name !== track.name) renameTrack(track.id, name);
    setEditing(false);
  };

  return (
    <div className="tracklabel">
      <span className="colorline" style={{ background: trackColor(track.kind, index) }} />
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          style={{
            font: "600 10px var(--font-ui)",
            background: "#0b0e15",
            border: "1px solid var(--line2)",
            borderRadius: 3,
            color: "var(--text)",
            padding: "2px 4px",
            width: 70,
          }}
          aria-label="Rename track"
        />
      ) : (
        <button className="lname" onDoubleClick={() => { setDraft(track.name); setEditing(true); }} title={`${track.name} — double-click to rename`}>
          {track.name}
        </button>
      )}
      {track.kind === "video" ? (
        <button
          className={`tl-flag${track.hidden ? " on danger" : " on"}`}
          title={track.hidden ? "Show track" : "Hide track"}
          onClick={() => setTrackFlag(track.id, { hidden: !track.hidden })}
        >
          {track.hidden ? <EyeOff size={10} /> : <Eye size={10} />}
        </button>
      ) : (
        <button
          className={`tl-flag${track.muted ? " on danger" : ""}`}
          title={track.muted ? "Unmute track" : "Mute track"}
          onClick={() => setTrackFlag(track.id, { muted: !track.muted })}
        >
          <VolumeX size={10} />
        </button>
      )}
      <button
        className={`tl-flag${track.solo ? " on" : ""}`}
        title="Solo track"
        aria-pressed={track.solo}
        onClick={() => setTrackFlag(track.id, { solo: !track.solo })}
        style={{ font: "700 8.5px var(--font-mono)" }}
      >
        S
      </button>
      <button
        className={`tl-flag${track.locked ? " on warn" : ""}`}
        title={track.locked ? "Unlock track" : "Lock track"}
        onClick={() => setTrackFlag(track.id, { locked: !track.locked })}
      >
        {track.locked ? <Lock size={10} /> : <Unlock size={10} />}
      </button>
      <button
        className="tl-flag"
        title="Delete track"
        onClick={() => removeTrack(track.id)}
      >
        <Trash2 size={10} />
      </button>
    </div>
  );
}

function GraphView({ clips, tracks, selectedClipId, pxps, dur }: { clips: Clip[]; tracks: Track[]; selectedClipId: string | null; pxps: number; dur: number }) {
  const selected = clips.find((c) => c.id === selectedClipId) ?? null;
  if (!selected) {
    return <div className="graph-empty">Select a clip on the Timeline tab to inspect its speed graph — speed ramps appear as steps.</div>;
  }
  const trackClips = clips
    .filter((c) => c.trackId === selected.trackId)
    .sort((a, b) => a.start - b.start);
  const track = tracks.find((t) => t.id === selected.trackId);
  const W = Math.max(600, dur * pxps);
  const H = 150;
  const spans = trackClips.map((c) => ({
    x: (c.start / dur) * W,
    w: (c.duration / dur) * W,
    speed: c.speed,
    id: c.id,
  }));
  return (
    <div className="graph-wrap">
      <div style={{ font: "10px var(--font-mono)", color: "#7f8aa0", marginBottom: 8, letterSpacing: 0.5 }}>
        SPEED MAP · {track?.name ?? ""} · {trackClips.length} SEGMENTS
      </div>
      <svg width={W} height={H} style={{ display: "block", background: "#0d1017", border: "1px solid #232937", borderRadius: 6 }}>
        {[0.5, 1, 1.5, 2, 3, 4].map((v) => {
          const y = H - 14 - (v / 4) * (H - 30);
          return (
            <g key={v}>
              <line x1={0} x2={W} y1={y} y2={y} stroke={v === 1 ? "#39415a" : "#242b3c"} strokeWidth={v === 1 ? 1 : 0.6} strokeDasharray={v === 1 ? "" : "3 5"} />
              <text x={6} y={y - 3} fill="#5b657c" fontSize={8} fontFamily="JetBrains Mono, monospace">{v}x</text>
            </g>
          );
        })}
        {spans.map((s) => {
          const y = H - 14 - (Math.min(4, s.speed) / 4) * (H - 30);
          const selectedSeg = s.id === selected.id;
          return (
            <g key={s.id}>
              <line x1={s.x} x2={s.x + s.w} y1={y} y2={y} stroke={selectedSeg ? "#cdbfff" : "#a78bfa"} strokeWidth={selectedSeg ? 3 : 1.8} />
              <line x1={s.x} x2={s.x} y1={y} y2={H - 14} stroke="#3a4157" strokeWidth={0.8} />
              {s.w > 34 && (
                <text x={s.x + 5} y={y - 5} fill={selectedSeg ? "#e8e2ff" : "#8d99b5"} fontSize={9} fontFamily="JetBrains Mono, monospace">
                  {s.speed.toFixed(2)}x
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function MixerView({ tracks, clips }: { tracks: Track[]; clips: Clip[] }) {
  const masterVolume = useEditorStore((s) => s.masterVolume);
  const setMasterVolume = useEditorStore((s) => s.setMasterVolume);
  const setTrackVolume = useEditorStore((s) => s.setTrackVolume);
  const setTrackFlag = useEditorStore((s) => s.setTrackFlag);

  const channels = tracks;
  return (
    <div className="mixer-wrap">
      <div className="mixer-channel" style={{ borderColor: "#4b4078" }}>
        <span className="ch-name">MASTER</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={masterVolume}
          onChange={(e) => setMasterVolume(Number(e.target.value))}
          aria-label="Master volume"
        />
        <span className="ch-val">{Math.round(masterVolume * 100)}%</span>
        <span className={`mixer-lamp${masterVolume > 0.01 ? " on" : ""}`} />
      </div>
      {channels.map((track) => {
        const active = clips.some((c) => c.trackId === track.id);
        return (
          <div className="mixer-channel" key={track.id}>
            <span className="ch-name" title={track.name}>
              {track.name.split("·")[0].trim()}
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={track.muted ? 0 : track.volume}
              onChange={(e) => setTrackVolume(track.id, Number(e.target.value))}
              aria-label={`${track.name} volume`}
            />
            <span className="ch-val">{track.muted ? "MUTE" : `${Math.round(track.volume * 100)}%`}</span>
            <button
              className={`tl-flag${track.muted ? " on danger" : ""}`}
              onClick={() => setTrackFlag(track.id, { muted: !track.muted })}
              title={track.muted ? "Unmute" : "Mute"}
            >
              <VolumeX size={11} />
            </button>
            <span className={`mixer-lamp${active && !track.muted && track.volume > 0.01 && masterVolume > 0.01 ? " on" : ""}`} />
          </div>
        );
      })}
      <div style={{ alignSelf: "center", color: "#67718a", font: "10px var(--font-mono)", marginLeft: 8, lineHeight: 1.8 }}>
        TRACK BUSES ARE LIVE —<br />
        LEVELS APPLY DURING PLAYBACK.
      </div>
    </div>
  );
}
