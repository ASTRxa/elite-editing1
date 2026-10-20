"use client";

import { CloudUpload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatMemory, timecode } from "@/lib/format";
import { getPlayer } from "@/lib/player";
import { useEditorStore } from "@/lib/store";
import { timelineEnd } from "@/lib/timelineMath";
import EffectsPanel from "./EffectsPanel";
import { importFileList } from "./importer";
import Modals from "./Modals";
import { loadProjectIntoStore } from "./projectIo";
import ProjectPanel from "./ProjectPanel";
import RenderQueue from "./RenderQueue";
import StatusBar from "./StatusBar";
import SubBar from "./SubBar";
import Timeline from "./Timeline";
import Toasts from "./Toasts";
import TopBar from "./TopBar";
import { uiRefs } from "./uiRefs";
import Viewer from "./Viewer";

export default function Editor() {
  const hydrated = useEditorStore((s) => s.hydrated);
  const leftCollapsed = useEditorStore((s) => s.leftCollapsed);
  const rightCollapsed = useEditorStore((s) => s.rightCollapsed);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  // ---- one-time hydration -------------------------------------------------
  useEffect(() => {
    void loadProjectIntoStore();
  }, []);

  // ---- master rAF loop: player, playhead, timecode, live meters -----------
  useEffect(() => {
    const player = getPlayer();
    let raf = 0;
    let lastFrame = -1;
    let lastDt = performance.now();
    let frameMs = 16.7;
    let fpsFrames = 0;
    let fpsStamp = performance.now();
    let memStamp = 0;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      frameMs = frameMs * 0.92 + (now - lastDt) * 0.08;
      lastDt = now;

      player.tick(now);

      const st = useEditorStore.getState();
      const t = player.time;
      const x = t * st.pxps;
      if (uiRefs.playhead) uiRefs.playhead.style.transform = `translate3d(${x}px,0,0)`;

      const fps = st.meta.fps || 24;
      const frame = Math.floor(t * fps);
      if (frame !== lastFrame) {
        lastFrame = frame;
        if (uiRefs.timecode) uiRefs.timecode.textContent = timecode(t, fps);
        if (uiRefs.frameStat) {
          const total = Math.floor(Math.max(timelineEnd(st.clips), st.outPoint ?? 0) * fps);
          uiRefs.frameStat.textContent = `FRAME ${String(frame).padStart(4, "0")} / ${String(total).padStart(4, "0")}`;
        }
      }

      // buttery playhead chase — the timeline glides to keep the red line
      // riding ~36% from the left edge of the viewport while rolling
      if (player.playing && uiRefs.scroller) {
        const sc = uiRefs.scroller;
        const target = Math.max(0, x - sc.clientWidth * 0.36);
        const dx = target - sc.scrollLeft;
        if (Math.abs(dx) > 0.5) sc.scrollLeft += dx * 0.085;
      }

      fpsFrames++;
      if (now - fpsStamp > 500) {
        const fpsNow = Math.round((fpsFrames * 1000) / (now - fpsStamp));
        fpsFrames = 0;
        fpsStamp = now;
        if (uiRefs.fpsMeter) {
          uiRefs.fpsMeter.textContent = `FPS ${fpsNow} · ${frameMs.toFixed(1)} MS`;
        }
      }
      if (now - memStamp > 1000) {
        memStamp = now;
        if (uiRefs.memMeter) {
          const mem = (
            performance as unknown as {
              memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
            }
          ).memory;
          uiRefs.memMeter.textContent = mem
            ? `MEM ${formatMemory(mem.usedJSHeapSize)} / ${formatMemory(mem.jsHeapSizeLimit)}`
            : "MEM · BROWSER MANAGED";
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---- keyboard shortcuts ---------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      const st = useEditorStore.getState();
      const player = getPlayer();
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.code === "KeyZ") {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (mod && e.code === "KeyY") { e.preventDefault(); st.redo(); return; }
      if (mod && e.code === "KeyS") { e.preventDefault(); void st.saveNow(); return; }
      if (mod && e.code === "KeyD") {
        e.preventDefault();
        if (st.selectedClipId) st.duplicateClip(st.selectedClipId);
        return;
      }

      switch (e.code) {
        case "Space": e.preventDefault(); player.togglePlay(); break;
        case "ArrowLeft": e.preventDefault(); player.stepFrames(e.shiftKey ? -10 : -1, st.meta.fps || 24); break;
        case "ArrowRight": e.preventDefault(); player.stepFrames(e.shiftKey ? 10 : 1, st.meta.fps || 24); break;
        case "Home": e.preventDefault(); player.setTime(st.inPoint ?? 0); break;
        case "End": e.preventDefault(); player.setTime(st.outPoint ?? timelineEnd(st.clips)); break;
        case "KeyS": st.splitAtPlayhead(player.time); break;
        case "Delete": case "Backspace": st.deleteSelected(); break;
        case "KeyM": if (st.selectedClipId) st.toggleClipMute(st.selectedClipId); break;
        case "KeyI": if (e.altKey) st.setInPoint(null); else st.setInPoint(player.time); break;
        case "KeyO": if (e.altKey) st.setOutPoint(null); else st.setOutPoint(player.time); break;
        case "KeyL": st.toggleLoop(); break;
        case "KeyF": {
          const sc = uiRefs.scroller;
          const dur = Math.max(timelineEnd(st.clips), st.outPoint ?? 0, 10) + 2;
          const w = sc ? sc.clientWidth - 32 : 900;
          st.setPxps(Math.max(6, Math.min(900, w / dur)));
          break;
        }
        case "KeyV": st.setTool("select"); break;
        case "KeyB": st.setTool("razor"); break;
        case "KeyH": st.setTool("hand"); break;
        case "Escape":
          st.selectClip(null);
          st.setRenameClipId(null);
          st.setRenderOpen(false);
          st.setSettingsOpen(false);
          st.setAboutOpen(false);
          st.setConfirmNew(false);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- drag & drop import -----------------------------------------------------
  useEffect(() => {
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (e.dataTransfer?.files?.length) {
        void importFileList(Array.from(e.dataTransfer.files));
      }
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  return (
    <div className="app">
      <TopBar />
      <SubBar />
      <div className="layout">
        <section
          className={`upper${leftCollapsed ? " hide-left" : ""}${rightCollapsed ? " hide-right" : ""}`}
        >
          {!leftCollapsed && <ProjectPanel />}
          <Viewer />
          {!rightCollapsed && <EffectsPanel />}
        </section>
        <Timeline />
      </div>
      <StatusBar />
      <Toasts />
      <RenderQueue />
      <Modals />
      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-box">
            <CloudUpload size={42} strokeWidth={1.5} />
            <div className="big">Drop footage to import</div>
            <div className="small">MP4 · MOV · WEBM · MP3 · WAV — FILES STAY ON YOUR MACHINE</div>
          </div>
        </div>
      )}
      {!hydrated && (
        <div
          className="drop-overlay"
          style={{ background: "var(--bg)", backdropFilter: "none" }}
          aria-hidden="true"
        >
          <div style={{ textAlign: "center", color: "#8f88b8" }}>
            <div
              style={{
                width: 46, height: 46, margin: "0 auto 14px", borderRadius: 12,
                background: "linear-gradient(135deg,#a78bfa,#55d6e8)",
                display: "grid", placeItems: "center", color: "#10131c",
                fontSize: 24, fontWeight: 800,
              }}
            >
              A
            </div>
            <div style={{ font: "600 13px var(--font-ui)", color: "#d6ccff", letterSpacing: 1.4 }}>
              {"ASTRO'S EDITOR"}
            </div>
            <div style={{ font: "10px var(--font-mono)", marginTop: 8, letterSpacing: 1 }}>
              LOADING WORKSPACE…
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
