"use client";

import { Ban, Clapperboard, Download, Play, Trash2, X } from "lucide-react";
import { useRef } from "react";
import { exportWebM } from "@/lib/exporter";
import { clockTime, formatBytes, uid } from "@/lib/format";
import { getPlayer } from "@/lib/player";
import { useEditorStore } from "@/lib/store";
import { timelineEnd } from "@/lib/timelineMath";
import type { RenderJob } from "@/lib/types";

export default function RenderQueue() {
  const open = useEditorStore((s) => s.renderOpen);
  const jobs = useEditorStore((s) => s.renderJobs);
  const setRenderOpen = useEditorStore((s) => s.setRenderOpen);
  const patchRenderJob = useEditorStore((s) => s.patchRenderJob);
  const removeRenderJob = useEditorStore((s) => s.removeRenderJob);
  const cancelTokens = useRef(new Map<string, { canceled: boolean }>());

  const addCurrentTimeline = () => {
    const st = useEditorStore.getState();
    const end = st.outPoint ?? timelineEnd(st.clips);
    if (end < 0.1) {
      st.toast("Timeline is empty — nothing to render", "warn");
      return;
    }
    const ar = st.meta.width / Math.max(1, st.meta.height);
    let w = 1280;
    let h = Math.round(1280 / ar / 2) * 2;
    if (ar < 1) {
      h = 1280;
      w = Math.round(1280 * ar / 2) * 2;
    }
    const job: RenderJob = {
      id: uid(),
      name: `${st.projectName.replace(/[^\w-]+/g, "_")}_${String(st.renderJobs.length + 1).padStart(2, "0")}`,
      width: w,
      height: h,
      fps: st.meta.fps,
      state: "queued",
      progress: 0,
      url: null,
      size: null,
      note: "awaiting render",
    };
    st.addRenderJob(job);
    st.toast("Added to render queue", "success");
  };

  const runJob = async (job: RenderJob) => {
    const st = useEditorStore.getState();
    const end = st.outPoint ?? timelineEnd(st.clips);
    if (end < 0.1) {
      st.toast("Nothing on the timeline", "warn");
      return;
    }
    getPlayer().pause();
    const token = { canceled: false };
    cancelTokens.current.set(job.id, token);
    patchRenderJob(job.id, { state: "rendering", progress: 0, note: "rendering frames…" });
    try {
      const start = st.inPoint ?? 0;
      const blob = await exportWebM({
        tracks: st.tracks,
        clips: st.clips,
        effects: st.effects,
        transform: st.transform,
        start,
        end,
        width: job.width,
        height: job.height,
        fps: job.fps,
        onProgress: (p) =>
          patchRenderJob(job.id, {
            progress: p,
            note: `rendering ${clockTime(start + (end - start) * p)} / ${clockTime(end)}`,
          }),
        token,
      });
      const url = URL.createObjectURL(blob);
      patchRenderJob(job.id, {
        state: "done",
        progress: 1,
        url,
        size: blob.size,
        note: `${formatBytes(blob.size)} · graded master`,
      });
      useEditorStore.getState().toast(`Rendered ${job.name}`, "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "render failed";
      if (msg === "canceled") {
        patchRenderJob(job.id, { state: "canceled", note: "canceled by user" });
      } else {
        patchRenderJob(job.id, { state: "error", note: msg });
        useEditorStore.getState().toast(msg, "error");
      }
    } finally {
      cancelTokens.current.delete(job.id);
    }
  };

  const cancelJob = (job: RenderJob) => {
    const token = cancelTokens.current.get(job.id);
    if (token) {
      token.canceled = true;
      patchRenderJob(job.id, { note: "canceling…" });
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="drawer-backdrop" onClick={() => setRenderOpen(false)} />
      <aside className="render-drawer" role="dialog" aria-modal="true" aria-label="Render queue">
        <div className="panel-head">
          <span>RENDER QUEUE</span>
          <div className="head-actions">
            <button className="head-btn" title="Close" onClick={() => setRenderOpen(false)}>
              <X size={14} />
            </button>
          </div>
        </div>
        <div className="render-body">
          <button className="btn-primary" style={{ width: "100%", marginBottom: 12 }} onClick={addCurrentTimeline}>
            <Clapperboard size={14} />
            Queue current timeline
          </button>
          <div
            style={{
              font: "9.5px var(--font-mono)",
              color: "#67718a",
              marginBottom: 12,
              lineHeight: 1.7,
              letterSpacing: 0.4,
            }}
          >
            EXPORTS GRADE + TRANSFORM + GRAIN TO A REAL WEBM (VIDEO TRACK ONLY,
            SILENT) VIA CANVAS RENDER. HONORS THE IN→OUT RANGE.
          </div>
          {jobs.length === 0 ? (
            <div className="render-empty">
              No jobs queued.
              <br />
              Queue the current timeline to render a downloadable WebM with the
              full effect stack burned in.
            </div>
          ) : (
            jobs.map((job) => (
              <div className="job-card" key={job.id}>
                <div className="job-head">
                  <span className="job-name" title={job.name}>
                    {job.name}.webm
                  </span>
                  <span className={`job-state ${job.state}`}>{job.state.toUpperCase()}</span>
                </div>
                <div className="job-meta">
                  {job.width}×{job.height} · {job.fps} FPS
                  {job.note ? ` · ${job.note}` : ""}
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${Math.round(job.progress * 100)}%` }} />
                </div>
                <div className="job-actions">
                  {job.state === "queued" && (
                    <button className="btn-primary" onClick={() => void runJob(job)}>
                      <Play size={11} />
                      Render
                    </button>
                  )}
                  {job.state === "rendering" && (
                    <button className="btn-danger" onClick={() => cancelJob(job)}>
                      <Ban size={11} />
                      Cancel
                    </button>
                  )}
                  {(job.state === "error" || job.state === "canceled") && (
                    <button onClick={() => void runJob(job)}>
                      <Play size={11} />
                      Retry
                    </button>
                  )}
                  {job.state === "done" && (
                    <button onClick={() => void runJob(job)}>Re-render</button>
                  )}
                  {job.url && (
                    <a
                      href={job.url}
                      download={`${job.name}.webm`}
                      style={{ display: "inline-flex" }}
                    >
                      <button className="btn-primary" style={{ pointerEvents: "none" }}>
                        <Download size={11} />
                        Download
                      </button>
                    </a>
                  )}
                  <span style={{ flex: 1 }} />
                  <button title="Remove job" onClick={() => removeRenderJob(job.id)}>
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
    </>
  );
}
