"use client";

import {
  Clapperboard,
  Expand,
  LayoutGrid,
  Link2,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Repeat,
  Scan,
  Shrink,
  SkipBack,
  SkipForward,
  StepBack,
  StepForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { filterString } from "@/lib/format";
import { getAssetUrl } from "@/lib/media";
import type { StageStatus } from "@/lib/player";
import { getPlayer } from "@/lib/player";
import { useEditorStore } from "@/lib/store";
import { timelineEnd } from "@/lib/timelineMath";
import { toggleAppFullscreen, uiRefs } from "./uiRefs";

export default function Viewer() {
  const effects = useEditorStore((s) => s.effects);
  const transform = useEditorStore((s) => s.transform);
  const meta = useEditorStore((s) => s.meta);
  const masterVolume = useEditorStore((s) => s.masterVolume);
  const setMasterVolume = useEditorStore((s) => s.setMasterVolume);
  const loopPlayback = useEditorStore((s) => s.loopPlayback);
  const toggleLoop = useEditorStore((s) => s.toggleLoop);
  const showSafeFrame = useEditorStore((s) => s.showSafeFrame);
  const showGrid = useEditorStore((s) => s.showGrid);
  const toggleSafeFrame = useEditorStore((s) => s.toggleSafeFrame);
  const toggleGrid = useEditorStore((s) => s.toggleGrid);
  const monitor = useEditorStore((s) => s.monitor);
  const setMonitor = useEditorStore((s) => s.setMonitor);
  const sourceAsset = useEditorStore((s) =>
    s.assets.find((a) => a.id === s.sourceAssetId) ?? null
  );
  const hasClips = useEditorStore((s) => s.clips.length > 0);

  const mediaHostRef = useRef<HTMLDivElement>(null);
  const monitorWrapRef = useRef<HTMLDivElement>(null);
  const [stageStatus, setStageStatus] = useState<StageStatus>("empty");
  const [isPlaying, setIsPlaying] = useState(false);
  const lastVol = useRef(1);

  // attach player engines to the stage
  useEffect(() => {
    const host = mediaHostRef.current;
    if (!host) return;
    const player = getPlayer();
    player.attach(host, setStageStatus);
    return () => player.detach();
  }, []);

  // cheap playing-state mirror (bails out when unchanged)
  useEffect(() => {
    const id = setInterval(() => {
      const v = getPlayer().playing;
      setIsPlaying((prev) => (prev === v ? prev : v));
    }, 160);
    return () => clearInterval(id);
  }, []);

  // fullscreen state mirror
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
      setIsPreviewFs(document.fullscreenElement === monitorWrapRef.current);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // cinema mode: fullscreen the monitor and roll the programme
  const [isPreviewFs, setIsPreviewFs] = useState(false);
  const togglePreviewFs = () => {
    const el = monitorWrapRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void el.requestFullscreen()
        .then(() => getPlayer().play())
        .catch(() => undefined);
    }
  };

  const player = getPlayer();
  const sourceUrl = sourceAsset ? getAssetUrl(sourceAsset.id) : null;
  const aspect = meta.width > 0 && meta.height > 0 ? meta.width / meta.height : 16 / 9;
  const barPct = effects.letterbox ? Math.max(0, ((1 - aspect / 2.35) / 2) * 100) : 0;

  const grainSvg =
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.9'/%3E%3C/svg%3E\")";

  const toggleMasterMute = () => {
    if (masterVolume > 0) {
      lastVol.current = masterVolume;
      setMasterVolume(0);
    } else {
      setMasterVolume(lastVol.current || 1);
    }
  };

  const end = () => {
    const st = useEditorStore.getState();
    return st.outPoint ?? timelineEnd(st.clips);
  };

  return (
    <main className="panel" aria-label="Viewer">
      <div className="viewerbar">
        <button
          className={`vtab${monitor === "program" ? " selected" : ""}`}
          onClick={() => setMonitor("program")}
        >
          Program
        </button>
        <button
          className={`vtab${monitor === "source" ? " selected" : ""}`}
          onClick={() => setMonitor("source")}
          title={sourceAsset ? `Source: ${sourceAsset.name}` : "Pick an asset's monitor button in the bin"}
        >
          Source
        </button>
        <div className="spacer" style={{ flex: 1 }} />
        <button
          className={`head-btn${showSafeFrame ? " on" : ""}`}
          style={showSafeFrame ? { color: "var(--violet)" } : undefined}
          title="Toggle safe frame"
          onClick={toggleSafeFrame}
        >
          <Scan size={13} />
        </button>
        <button
          className="head-btn"
          style={showGrid ? { color: "var(--violet)" } : undefined}
          title="Toggle thirds grid"
          onClick={toggleGrid}
        >
          <LayoutGrid size={13} />
        </button>
        <button
          className="head-btn"
          style={isPreviewFs ? { color: "var(--violet)" } : undefined}
          title={isPreviewFs ? "Exit preview fullscreen (Esc)" : "Fullscreen preview — cinema mode"}
          onClick={togglePreviewFs}
          aria-pressed={isPreviewFs}
        >
          {isPreviewFs ? <Shrink size={13} /> : <Expand size={13} />}
        </button>
      </div>

      <div className="monitor-wrap" ref={monitorWrapRef}>
        <div
          className="monitor checker"
          style={{ ["--stage-aspect" as never]: `${meta.width} / ${meta.height}` }}
        >
          {monitor === "program" ? (
            <>
              <div
                className="stage-transform"
                style={{
                  transform: `translate(${transform.x}%, ${transform.y}%) rotate(${transform.rotate}deg) scale(${transform.scale})`,
                  opacity: transform.opacity,
                }}
              >
                <div className="stage-filter" style={{ filter: filterString(effects) }}>
                  <div ref={mediaHostRef} style={{ position: "absolute", inset: 0 }} />
                </div>
                {effects.bloom && (
                  <div
                    className="stage-bloom"
                    aria-hidden="true"
                    style={{
                      backdropFilter: `blur(${effects.bloomRadius}px) saturate(1.6) brightness(1.45)`,
                      WebkitBackdropFilter: `blur(${effects.bloomRadius}px) saturate(1.6) brightness(1.45)`,
                      opacity: effects.bloomIntensity,
                    }}
                  />
                )}
                {effects.vignette > 0.01 && (
                  <div className="stage-vignette" aria-hidden="true" style={{ opacity: effects.vignette }} />
                )}
                {effects.letterbox && (
                  <>
                    <div className="stage-letterbar" style={{ top: 0, height: `${barPct}%` }} aria-hidden="true" />
                    <div className="stage-letterbar" style={{ bottom: 0, height: `${barPct}%` }} aria-hidden="true" />
                  </>
                )}
              </div>
              {effects.grain > 0.01 && (
                <div
                  className="stage-grain"
                  aria-hidden="true"
                  style={{ backgroundImage: grainSvg, opacity: effects.grain * 0.7 }}
                />
              )}
              {showSafeFrame && <div className="stage-safe" aria-hidden="true" />}
              {showGrid && <div className="stage-grid" aria-hidden="true" />}
              <div className="stage-crosshair" aria-hidden="true" />
              <div className="stage-label">COMP 01 &nbsp;/&nbsp; PROGRAM</div>
              {stageStatus === "empty" && (
                <div className="stage-slate">
                  <Clapperboard size={30} strokeWidth={1.3} />
                  <div className="title">
                    {hasClips ? "NO CLIP UNDER PLAYHEAD" : "TIMELINE IS EMPTY"}
                  </div>
                  <div className="sub">
                    {hasClips
                      ? "PLAY THROUGH A CLIP OR SCRUB THE RULER"
                      : "IMPORT MEDIA, THEN DOUBLE-CLICK A THUMBNAIL"}
                  </div>
                </div>
              )}
              {stageStatus === "offline" && (
                <div className="stage-slate" style={{ color: "#ff9fae" }}>
                  <Link2 size={30} strokeWidth={1.3} />
                  <div className="title">MEDIA OFFLINE</div>
                  <div className="sub">RELINK THE FILE FROM THE PROJECT PANEL</div>
                </div>
              )}
            </>
          ) : (
            <>
              {sourceAsset && sourceUrl ? (
                <>
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <video
                    key={sourceAsset.id}
                    src={sourceUrl}
                    className="stage-media on"
                    autoPlay
                    loop
                    muted
                    playsInline
                  />
                  <div className="stage-label">SOURCE &nbsp;/&nbsp; {sourceAsset.name.toUpperCase()}</div>
                </>
              ) : (
                <div className="stage-slate">
                  <Clapperboard size={30} strokeWidth={1.3} />
                  <div className="title">NO SOURCE SELECTED</div>
                  <div className="sub">
                    {sourceAsset?.status === "offline"
                      ? "THIS ASSET IS OFFLINE — RELINK IT FIRST"
                      : "USE THE MONITOR BUTTON ON ANY ASSET CARD"}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="view-controls">
        <button
          className="transport-tool"
          title="Jump to start (Home)"
          onClick={() => player.setTime(useEditorStore.getState().inPoint ?? 0)}
        >
          <SkipBack size={14} strokeWidth={1.8} />
        </button>
        <button
          className="transport-tool"
          title="Previous frame (Left)"
          onClick={() => player.stepFrames(-1, meta.fps || 24)}
        >
          <StepBack size={14} strokeWidth={1.8} />
        </button>
        <button
          className="play-button"
          title="Play / pause (Space)"
          aria-label={isPlaying ? "Pause" : "Play"}
          onClick={() => player.togglePlay()}
        >
          {isPlaying ? <Pause size={15} strokeWidth={2} /> : <Play size={15} strokeWidth={2} />}
        </button>
        <button
          className="transport-tool"
          title="Next frame (Right)"
          onClick={() => player.stepFrames(1, meta.fps || 24)}
        >
          <StepForward size={14} strokeWidth={1.8} />
        </button>
        <button
          className="transport-tool"
          title="Jump to end (End)"
          onClick={() => player.setTime(end())}
        >
          <SkipForward size={14} strokeWidth={1.8} />
        </button>
        <button
          className={`transport-tool${loopPlayback ? " active" : ""}`}
          title="Loop in→out range (L)"
          aria-pressed={loopPlayback}
          onClick={toggleLoop}
        >
          <Repeat size={13} strokeWidth={1.8} />
        </button>
        <span className="sep-v" />
        <button className="transport-tool" title="Master mute" onClick={toggleMasterMute}>
          {masterVolume > 0.001 ? (
            <Volume2 size={14} strokeWidth={1.8} />
          ) : (
            <VolumeX size={14} strokeWidth={1.8} />
          )}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={masterVolume}
          onChange={(e) => setMasterVolume(Number(e.target.value))}
          style={{ width: 64 }}
          aria-label="Master volume"
          title="Master volume"
        />
        <span
          className="timecode"
          ref={(el) => {
            uiRefs.timecode = el;
          }}
        >
          00:00:00:00
        </span>
        <span className="view-right">
          <button
            className={`transport-tool${isFullscreen ? " active" : ""}`}
            title={isFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen — entire workspace"}
            onClick={() => toggleAppFullscreen()}
            aria-pressed={isFullscreen}
          >
            {isFullscreen ? <Minimize2 size={13} strokeWidth={1.8} /> : <Maximize2 size={13} strokeWidth={1.8} />}
          </button>
          FULL · {meta.fps} FPS
        </span>
      </div>
    </main>
  );
}
