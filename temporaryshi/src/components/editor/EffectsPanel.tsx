"use client";

import {
  AudioWaveform,
  Contrast,
  Gauge,
  Move3d,
  Palette,
  RotateCcw,
  Sparkles,
  Sun,
  Wand2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useEditorStore } from "@/lib/store";

interface FxRowProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  resetValue?: number;
}

function FxRow({ label, min, max, step, value, format, onChange, resetValue }: FxRowProps) {
  return (
    <div className="fx-row">
      <div className="fx-row-head">
        <span className="fx-label">{label}</span>
        <span
          className="fx-value"
          title="Double-click to reset"
          onDoubleClick={() => resetValue !== undefined && onChange(resetValue)}
          style={{ cursor: resetValue !== undefined ? "pointer" : undefined }}
        >
          {format(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => resetValue !== undefined && onChange(resetValue)}
        aria-label={label}
      />
    </div>
  );
}

/** Speed control that previews live but commits to undo history on release. */
function SpeedRow() {
  const selected = useEditorStore((s) => s.clips.find((c) => c.id === s.selectedClipId) ?? null);
  const setClipSpeed = useEditorStore((s) => s.setClipSpeed);
  const [draft, setDraft] = useState<number | null>(null);

  useEffect(() => {
    setDraft(null);
  }, [selected?.id, selected?.speed]);

  if (!selected) {
    return <div className="fx-note">Select a clip to retime it. Speed changes preserve the clip’s on-screen duration.</div>;
  }
  const shown = draft ?? selected.speed;
  return (
    <div className="fx-row">
      <div className="fx-row-head">
        <span className="fx-label">Speed · {selected.name}</span>
        <span className="fx-value">{shown.toFixed(2)}x</span>
      </div>
      <input
        type="range"
        min={0.25}
        max={4}
        step={0.05}
        value={shown}
        aria-label="Clip speed"
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={() => {
          if (draft !== null) setClipSpeed(selected.id, draft);
          setDraft(null);
        }}
        onKeyUp={() => {
          if (draft !== null) setClipSpeed(selected.id, draft);
          setDraft(null);
        }}
        onDoubleClick={() => setClipSpeed(selected.id, 1)}
      />
      <div className="keyline">
        <span>0.25x</span>
        <span>DBL-CLICK RESETS · COMMITS ON RELEASE</span>
        <span>4.00x</span>
      </div>
    </div>
  );
}

export default function EffectsPanel() {
  const tab = useEditorStore((s) => s.effectsTab);
  const setTab = useEditorStore((s) => s.setEffectsTab);
  const effects = useEditorStore((s) => s.effects);
  const setEffect = useEditorStore((s) => s.setEffect);
  const transform = useEditorStore((s) => s.transform);
  const setTransform = useEditorStore((s) => s.setTransform);
  const resetTransform = useEditorStore((s) => s.resetTransform);
  const resetEffects = useEditorStore((s) => s.resetEffects);
  const applyLook = useEditorStore((s) => s.applyLook);

  return (
    <aside className="panel" aria-label="Effect controls">
      <div className="panel-head">
        <span>EFFECT CONTROLS</span>
        <button className="head-btn" title="Reset grade" onClick={resetEffects}>
          <RotateCcw size={12} />
        </button>
      </div>
      <div className="fx-tabs" role="tablist">
        <button
          className={`fx-tab${tab === "effects" ? " active" : ""}`}
          role="tab"
          aria-selected={tab === "effects"}
          onClick={() => setTab("effects")}
        >
          GRADE
        </button>
        <button
          className={`fx-tab${tab === "transform" ? " active" : ""}`}
          role="tab"
          aria-selected={tab === "transform"}
          onClick={() => setTab("transform")}
        >
          TRANSFORM
        </button>
      </div>

      <div className="fx-scroll">
        {tab === "effects" ? (
          <>
            <div className="fx-group">
              <div className="fx-title">
                <span className="fx-icon">
                  <Sparkles size={12} />
                </span>
                Creative Looks
              </div>
              <div className="look-chips">
                <button className="look-chip" onClick={() => applyLook("clean")}>Clean</button>
                <button className="look-chip" onClick={() => applyLook("noir")}>Noir</button>
                <button className="look-chip" onClick={() => applyLook("teal-orange")}>Teal &amp; Orange</button>
                <button className="look-chip" onClick={() => applyLook("vivid")}>Vivid</button>
                <button className="look-chip" onClick={() => applyLook("dream")}>Dream Glow</button>
              </div>
              <div className="fx-note">Looks apply to the master grade and are burned into exports.</div>
            </div>

            <div className="fx-group">
              <div className="fx-title">
                <span className="fx-icon orange">
                  <Palette size={12} />
                </span>
                Color Grade
              </div>
              <FxRow label="Exposure" min={0.25} max={2.5} step={0.01} value={effects.exposure}
                format={(v) => v.toFixed(2)} onChange={(v) => setEffect("exposure", v)} resetValue={1} />
              <FxRow label="Contrast" min={0.25} max={2.5} step={0.01} value={effects.contrast}
                format={(v) => v.toFixed(2)} onChange={(v) => setEffect("contrast", v)} resetValue={1} />
              <FxRow label="Saturation" min={0} max={3} step={0.01} value={effects.saturation}
                format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setEffect("saturation", v)} resetValue={1} />
              <FxRow label="Warmth" min={-1} max={1} step={0.01} value={effects.warmth}
                format={(v) => (v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2))} onChange={(v) => setEffect("warmth", v)} resetValue={0} />
              <FxRow label="Hue shift" min={-60} max={60} step={0.5} value={effects.hue}
                format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}°`} onChange={(v) => setEffect("hue", v)} resetValue={0} />
            </div>

            <div className="fx-group">
              <div className="fx-title">
                <span className="fx-icon cyan">
                  <Sun size={12} />
                </span>
                Bloom &amp; Optics
                <button
                  className={`toggle${effects.bloom ? " on" : ""}`}
                  role="switch"
                  aria-checked={effects.bloom}
                  aria-label="Toggle bloom"
                  onClick={() => setEffect("bloom", !effects.bloom)}
                  title="Real-time bloom via backdrop compositing"
                />
              </div>
              <FxRow label="Bloom radius" min={4} max={60} step={1} value={effects.bloomRadius}
                format={(v) => `${v.toFixed(0)} px`} onChange={(v) => setEffect("bloomRadius", v)} resetValue={26} />
              <FxRow label="Bloom intensity" min={0} max={1} step={0.01} value={effects.bloomIntensity}
                format={(v) => v.toFixed(2)} onChange={(v) => setEffect("bloomIntensity", v)} resetValue={0.32} />
              <FxRow label="Blur" min={0} max={20} step={0.1} value={effects.blur}
                format={(v) => `${v.toFixed(1)} px`} onChange={(v) => setEffect("blur", v)} resetValue={0} />
            </div>

            <div className="fx-group">
              <div className="fx-title">
                <span className="fx-icon green">
                  <Contrast size={12} />
                </span>
                Texture
              </div>
              <FxRow label="Vignette" min={0} max={1} step={0.01} value={effects.vignette}
                format={(v) => v.toFixed(2)} onChange={(v) => setEffect("vignette", v)} resetValue={0} />
              <FxRow label="Film grain" min={0} max={1} step={0.01} value={effects.grain}
                format={(v) => v.toFixed(2)} onChange={(v) => setEffect("grain", v)} resetValue={0} />
              <div className="fx-row">
                <div className="fx-row-head">
                  <span className="fx-label">Letterbox 2.35:1</span>
                  <button
                    className={`toggle${effects.letterbox ? " on" : ""}`}
                    role="switch"
                    aria-checked={effects.letterbox}
                    onClick={() => setEffect("letterbox", !effects.letterbox)}
                  />
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="fx-group">
              <div className="fx-title">
                <span className="fx-icon">
                  <Move3d size={12} />
                </span>
                Stage Transform
                <button className="head-btn" title="Reset transform" onClick={resetTransform} style={{ marginLeft: "auto" }}>
                  <RotateCcw size={12} />
                </button>
              </div>
              <FxRow label="Scale" min={0.2} max={3} step={0.01} value={transform.scale}
                format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setTransform({ scale: v })} resetValue={1} />
              <FxRow label="Rotation" min={-180} max={180} step={1} value={transform.rotate}
                format={(v) => `${v.toFixed(0)}°`} onChange={(v) => setTransform({ rotate: v })} resetValue={0} />
              <FxRow label="Position X" min={-50} max={50} step={0.5} value={transform.x}
                format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`} onChange={(v) => setTransform({ x: v })} resetValue={0} />
              <FxRow label="Position Y" min={-50} max={50} step={0.5} value={transform.y}
                format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`} onChange={(v) => setTransform({ y: v })} resetValue={0} />
              <FxRow label="Opacity" min={0} max={1} step={0.01} value={transform.opacity}
                format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setTransform({ opacity: v })} resetValue={1} />
              <div className="fx-note">Applied live to the program stage and burned into WebM exports.</div>
            </div>

            <div className="fx-group">
              <div className="fx-title">
                <span className="fx-icon cyan">
                  <Gauge size={12} />
                </span>
                Time Remapping
              </div>
              <SpeedRow />
              <div className="mini-graph" aria-hidden="true">
                <SpeedSparkline />
              </div>
              <div className="keyline">
                <span>SLOW</span>
                <span>SPEED MAP · SELECTED TRACK</span>
                <span>FAST</span>
              </div>
            </div>

            <div className="fx-group">
              <div className="fx-title">
                <span className="fx-icon green">
                  <AudioWaveform size={12} />
                </span>
                Clip Gain
              </div>
              <ClipGainRow />
            </div>

            <div className="fx-group">
              <div className="fx-title">
                <span className="fx-icon">
                  <Wand2 size={12} />
                </span>
                Speed Presets
              </div>
              <div className="look-chips">
                <PresetChips />
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

function SpeedSparkline() {
  const selected = useEditorStore((s) => s.clips.find((c) => c.id === s.selectedClipId) ?? null);
  const clips = useEditorStore((s) => s.clips);
  if (!selected) {
    return (
      <svg viewBox="0 0 220 58" preserveAspectRatio="none" role="img" aria-label="No clip selected">
        <path d="M0 29H220" stroke="#3a4157" strokeWidth="1" strokeDasharray="4 4" fill="none" />
      </svg>
    );
  }
  const trackClips = clips
    .filter((c) => c.trackId === selected.trackId)
    .sort((a, b) => a.start - b.start);
  const span = Math.max(0.5, trackClips.reduce((m, c) => Math.max(m, c.start + c.duration), 0));
  const pts: string[] = [];
  for (const c of trackClips) {
    const x1 = (c.start / span) * 220;
    const x2 = ((c.start + c.duration) / span) * 220;
    const y = 54 - (Math.min(4, c.speed) / 4) * 48;
    pts.push(`${x1.toFixed(1)} ${y.toFixed(1)}`, `${x2.toFixed(1)} ${y.toFixed(1)}`);
  }
  const d = pts.length ? `M${pts.join(" L")}` : "M0 54";
  return (
    <svg viewBox="0 0 220 58" preserveAspectRatio="none" role="img" aria-label="Speed map">
      <path d="M0 42H220" stroke="#2f374a" strokeWidth="0.7" fill="none" />
      <path d="M0 54H220" stroke="#242b3c" strokeWidth="0.7" fill="none" />
      <path d={d} stroke="#a78bfa" strokeWidth="1.8" fill="none" />
    </svg>
  );
}

function ClipGainRow() {
  const selected = useEditorStore((s) => s.clips.find((c) => c.id === s.selectedClipId) ?? null);
  const setClipVolume = useEditorStore((s) => s.setClipVolume);
  const toggleClipMute = useEditorStore((s) => s.toggleClipMute);
  if (!selected) return <div className="fx-note">Select a clip to set its gain.</div>;
  return (
    <>
      <div className="fx-row">
        <div className="fx-row-head">
          <span className="fx-label">Gain · {selected.name}</span>
          <span className="fx-value">{selected.muted ? "MUTED" : `${Math.round(selected.volume * 100)}%`}</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={selected.muted ? 0 : selected.volume}
          onChange={(e) => setClipVolume(selected.id, Number(e.target.value))}
          aria-label="Clip gain"
        />
      </div>
      <button onClick={() => toggleClipMute(selected.id)}>
        {selected.muted ? "Unmute clip" : "Mute clip"}
      </button>
    </>
  );
}

function PresetChips() {
  const selected = useEditorStore((s) => s.clips.find((c) => c.id === s.selectedClipId) ?? null);
  const setClipSpeed = useEditorStore((s) => s.setClipSpeed);
  const speedRampSelected = useEditorStore((s) => s.speedRampSelected);
  const toast = useEditorStore((s) => s.toast);
  const apply = (fn: () => void) => {
    if (!selected) {
      toast("Select a clip first", "info");
      return;
    }
    fn();
  };
  return (
    <>
      <button className="look-chip" onClick={() => apply(() => setClipSpeed(selected!.id, 0.5))}>0.5x</button>
      <button className="look-chip" onClick={() => apply(() => setClipSpeed(selected!.id, 1))}>1x</button>
      <button className="look-chip" onClick={() => apply(() => setClipSpeed(selected!.id, 2))}>2x</button>
      <button className="look-chip" onClick={() => apply(speedRampSelected)}>Ramp 0.5/1.6/1</button>
    </>
  );
}
