"use client";

import { Frame, Hand, MousePointer2, Scissors, SlidersHorizontal } from "lucide-react";
import { useEditorStore } from "@/lib/store";
import type { ToolId } from "@/lib/types";
import { fitTimeline } from "./uiRefs";

const TOOLS: { id: ToolId; icon: typeof MousePointer2; label: string; kbd: string }[] = [
  { id: "select", icon: MousePointer2, label: "Selection tool", kbd: "V" },
  { id: "razor", icon: Scissors, label: "Razor — click a clip to split", kbd: "B" },
  { id: "hand", icon: Hand, label: "Hand — drag to pan the timeline", kbd: "H" },
];

export default function SubBar() {
  const projectName = useEditorStore((s) => s.projectName);
  const setProjectName = useEditorStore((s) => s.setProjectName);
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const meta = useEditorStore((s) => s.meta);
  const setSettingsOpen = useEditorStore((s) => s.setSettingsOpen);

  return (
    <div className="subbar">
      <input
        className="project-name-input"
        value={projectName}
        onChange={(e) => setProjectName(e.target.value)}
        aria-label="Project name"
        spellCheck={false}
      />
      <span className="crumb">/</span>
      <span className="crumb">Motion workspace</span>
      <div className="spacer" />
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`tool${tool === t.id ? " active" : ""}`}
          title={`${t.label} (${t.kbd})`}
          aria-pressed={tool === t.id}
          onClick={() => setTool(t.id)}
        >
          <t.icon size={14} strokeWidth={1.8} />
        </button>
      ))}
      <span className="sep-v" />
      <button
        className="pill clickable"
        onClick={() => setSettingsOpen(true)}
        title="Composition settings"
      >
        {meta.fps} FPS
      </button>
      <button
        className="pill clickable"
        onClick={() => setSettingsOpen(true)}
        title="Composition settings"
      >
        {meta.width} × {meta.height}
      </button>
      <button className="tool" onClick={() => fitTimeline()} title="Fit sequence to timeline (F)">
        <Frame size={14} strokeWidth={1.8} />
      </button>
      <button className="tool" onClick={() => setSettingsOpen(true)} title="Composition settings">
        <SlidersHorizontal size={14} strokeWidth={1.8} />
      </button>
    </div>
  );
}
