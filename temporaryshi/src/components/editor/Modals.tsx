"use client";

import { useEffect, useState } from "react";
import { useEditorStore } from "@/lib/store";

const RES_PRESETS = [
  { label: "1080p", w: 1920, h: 1080 },
  { label: "4K", w: 3840, h: 2160 },
  { label: "Vertical", w: 1080, h: 1920 },
  { label: "Square", w: 1080, h: 1080 },
];

function SettingsModal() {
  const meta = useEditorStore((s) => s.meta);
  const setMeta = useEditorStore((s) => s.setMeta);
  const setSettingsOpen = useEditorStore((s) => s.setSettingsOpen);
  const toast = useEditorStore((s) => s.toast);
  const [w, setW] = useState(meta.width);
  const [h, setH] = useState(meta.height);
  const [fps, setFps] = useState(meta.fps);

  useEffect(() => {
    setW(meta.width);
    setH(meta.height);
    setFps(meta.fps);
    // sync when reopened
  }, [meta.width, meta.height, meta.fps]);

  const apply = () => {
    const width = Math.max(16, Math.min(7680, Math.round(w)));
    const height = Math.max(16, Math.min(7680, Math.round(h)));
    const rate = Math.max(12, Math.min(120, Math.round(fps)));
    setMeta({ width, height, fps: rate });
    setSettingsOpen(false);
    toast(`Composition: ${width}×${height} @ ${rate}fps`, "success");
  };

  return (
    <div className="modal-center" role="dialog" aria-modal="true" aria-label="Composition settings">
      <div className="modal">
        <h3>Composition Settings</h3>
        <div className="modal-sub">Stage aspect, frame rate and export defaults.</div>
        <div className="modal-row">
          <label htmlFor="comp-w">Width (px)</label>
          <input id="comp-w" type="number" value={w} onChange={(e) => setW(Number(e.target.value))} />
        </div>
        <div className="modal-row">
          <label htmlFor="comp-h">Height (px)</label>
          <input id="comp-h" type="number" value={h} onChange={(e) => setH(Number(e.target.value))} />
        </div>
        <div className="modal-row">
          <label htmlFor="comp-fps">Frame rate</label>
          <input id="comp-fps" type="number" value={fps} onChange={(e) => setFps(Number(e.target.value))} />
        </div>
        <div className="look-chips" style={{ marginTop: 10 }}>
          {RES_PRESETS.map((p) => (
            <button
              key={p.label}
              className="look-chip"
              onClick={() => {
                setW(p.w);
                setH(p.h);
              }}
            >
              {p.label}
            </button>
          ))}
          {[24, 30, 60].map((f) => (
            <button key={f} className="look-chip" onClick={() => setFps(f)}>
              {f} fps
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button onClick={() => setSettingsOpen(false)}>Cancel</button>
          <button className="btn-primary" onClick={apply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

function AboutModal() {
  const setAboutOpen = useEditorStore((s) => s.setAboutOpen);
  return (
    <div className="modal-center" role="dialog" aria-modal="true" aria-label="About">
      <div className="modal">
        <h3>{"ASTRO'S EDITOR"}</h3>
        <div className="modal-sub">Local-first motion workspace · Engine 5.0.0</div>
        <div className="about-list">
          <div>
            <b>Media</b> — files open via object URLs; nothing is uploaded
          </div>
          <div>
            <b>Timeline</b> — drag · trim · razor split · snap · undo (64 steps)
          </div>
          <div>
            <b>Grade</b> — GPU-composited CSS filters + backdrop bloom
          </div>
          <div>
            <b>Export</b> — frame-accurate canvas render to WebM
          </div>
          <div>
            <b>Keys</b> — Space · S split · B razor · V select · H hand · I/O
            in-out · F fit · L loop · ←/→ frame
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn-primary" onClick={() => setAboutOpen(false)}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmNewModal() {
  const setConfirmNew = useEditorStore((s) => s.setConfirmNew);
  const newProject = useEditorStore((s) => s.newProject);
  return (
    <div className="modal-center" role="alertdialog" aria-modal="true" aria-label="New project">
      <div className="modal">
        <h3>Start a new project?</h3>
        <div className="modal-sub">
          This clears the current timeline, media bin and grade. The change is saved over your
          workspace immediately.
        </div>
        <div className="modal-actions">
          <button onClick={() => setConfirmNew(false)}>Cancel</button>
          <button
            className="btn-danger"
            onClick={() => {
              newProject();
              setConfirmNew(false);
            }}
          >
            New project
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Modals() {
  const settingsOpen = useEditorStore((s) => s.settingsOpen);
  const aboutOpen = useEditorStore((s) => s.aboutOpen);
  const confirmNew = useEditorStore((s) => s.confirmNew);
  const anyOpen = settingsOpen || aboutOpen || confirmNew;
  if (!anyOpen) return null;
  return (
    <>
      <div
        className="drawer-backdrop"
        onClick={() => {
          const st = useEditorStore.getState();
          st.setSettingsOpen(false);
          st.setAboutOpen(false);
          st.setConfirmNew(false);
        }}
      />
      {settingsOpen && <SettingsModal />}
      {aboutOpen && <AboutModal />}
      {confirmNew && <ConfirmNewModal />}
    </>
  );
}
