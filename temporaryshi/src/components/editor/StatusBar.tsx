"use client";

import { useEditorStore } from "@/lib/store";
import { uiRefs } from "./uiRefs";

export default function StatusBar() {
  const assets = useEditorStore((s) => s.assets);
  const clips = useEditorStore((s) => s.clips);
  const tracks = useEditorStore((s) => s.tracks);
  const online = assets.filter((a) => a.status === "online").length;

  return (
    <footer className="statusbar">
      <span className="green">● LIVE COMPOSITOR</span>
      <span
        ref={(el) => {
          uiRefs.memMeter = el;
        }}
      >
        MEM · —
      </span>
      <span>
        {online}/{assets.length} MEDIA ONLINE
      </span>
      <span>
        {clips.length} CLIPS · {tracks.length} TRACKS
      </span>
      <div className="spacer" style={{ flex: 1 }} />
      <span className="blue">PREVIEW: FULL RES · GPU COMPOSITE</span>
      <span>ASTRO ENGINE 5.0.0</span>
    </footer>
  );
}
