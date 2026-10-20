"use client";

import {
  AudioWaveform,
  ChevronDown,
  Clapperboard,
  Download,
  FolderClosed,
  Layers,
  Link2,
  MonitorPlay,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { clockTime, formatBytes } from "@/lib/format";
import { getPlayer } from "@/lib/player";
import { useEditorStore } from "@/lib/store";
import type { AssetMeta } from "@/lib/types";
import { openFilePicker, relinkAssetFlow } from "./importer";

function AssetCard({ asset }: { asset: AssetMeta }) {
  const addClipFromAsset = useEditorStore((s) => s.addClipFromAsset);
  const removeAsset = useEditorStore((s) => s.removeAsset);
  const openInSource = useEditorStore((s) => s.openInSource);
  const offline = asset.status === "offline";

  const addToTimeline = () => {
    if (offline) {
      useEditorStore.getState().toast("Asset is offline — relink it first", "warn");
      return;
    }
    addClipFromAsset(asset.id, getPlayer().time);
  };

  return (
    <div
      className="asset-card"
      onDoubleClick={addToTimeline}
      title={
        offline
          ? `${asset.name} — offline, relink to use`
          : `${asset.name} — double-click to place at playhead`
      }
    >
      <div className="asset-thumb">
        {asset.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.thumb} alt="" draggable={false} />
        ) : (
          <span className="wave-fallback">
            <AudioWaveform size={22} strokeWidth={1.5} />
          </span>
        )}
        {offline && <span className="asset-offline-flag">OFFLINE</span>}
        {asset.duration > 0 && <span className="asset-dur">{clockTime(asset.duration)}</span>}
      </div>
      <div className="asset-meta">
        <strong>{asset.name}</strong>
        <span>
          {asset.mediaType === "video"
            ? asset.width > 0
              ? `${asset.width}×${asset.height} · ${formatBytes(asset.size)}`
              : `VIDEO · ${formatBytes(asset.size)}`
            : `AUDIO · ${formatBytes(asset.size)}`}
        </span>
      </div>
      <div className="asset-actions">
        {offline ? (
          <button
            title="Relink media file"
            onClick={(e) => {
              e.stopPropagation();
              relinkAssetFlow(asset);
            }}
          >
            <Link2 size={11} />
          </button>
        ) : (
          <>
            <button
              title="Add to timeline at playhead"
              onClick={(e) => {
                e.stopPropagation();
                addToTimeline();
              }}
            >
              <Plus size={11} />
            </button>
            <button
              title="Open in source monitor"
              onClick={(e) => {
                e.stopPropagation();
                openInSource(asset.id);
              }}
            >
              <MonitorPlay size={11} />
            </button>
          </>
        )}
        <button
          title="Remove from bin"
          onClick={(e) => {
            e.stopPropagation();
            removeAsset(asset.id);
          }}
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
}

export default function ProjectPanel() {
  const assets = useEditorStore((s) => s.assets);
  const renderJobs = useEditorStore((s) => s.renderJobs);
  const setRenderOpen = useEditorStore((s) => s.setRenderOpen);
  const setSettingsOpen = useEditorStore((s) => s.setSettingsOpen);
  const [query, setQuery] = useState("");
  const [mediaOpen, setMediaOpen] = useState(true);
  const [compsOpen, setCompsOpen] = useState(true);

  const q = query.trim().toLowerCase();
  const filtered = q ? assets.filter((a) => a.name.toLowerCase().includes(q)) : assets;
  const doneJobs = renderJobs.filter((j) => j.state === "done").length;

  return (
    <aside className="panel" aria-label="Project panel">
      <div className="panel-head">
        <span>PROJECT</span>
        <div className="head-actions">
          <button className="head-btn" title="Import media" onClick={() => openFilePicker()}>
            <Plus size={13} />
          </button>
        </div>
      </div>

      <div className="bin-toolbar">
        <div className="bin-search">
          <Search size={12} />
          <input
            type="text"
            placeholder="Search assets…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search assets"
          />
        </div>
        <button className="tool" title="Import media" onClick={() => openFilePicker()}>
          <Download size={13} strokeWidth={1.8} />
        </button>
      </div>
      <div className="bin-note">LOCAL MEDIA · DOUBLE-CLICK A CARD TO PLACE AT PLAYHEAD</div>

      <div className="bin-scroll">
        <button className="folder-row" onClick={() => setMediaOpen(!mediaOpen)}>
          <ChevronDown
            size={12}
            style={{ transform: mediaOpen ? "none" : "rotate(-90deg)", transition: "transform .15s" }}
          />
          <FolderClosed size={13} />
          <b>Media</b>
          <span className="count">{assets.length}</span>
        </button>

        {mediaOpen &&
          (filtered.length === 0 ? (
            <div className="bin-empty">
              <Clapperboard size={26} strokeWidth={1.4} />
              <div style={{ fontWeight: 650 }}>{assets.length === 0 ? "No media yet" : "No matches"}</div>
              <div className="hint">
                {assets.length === 0
                  ? "Drag MP4/MOV/WEBM/MP3 files anywhere, or use the import button. Files never leave your machine."
                  : `Nothing matches “${query}”.`}
              </div>
              {assets.length === 0 && (
                <button
                  style={{ marginTop: 12 }}
                  className="btn-primary"
                  onClick={() => openFilePicker()}
                >
                  <Plus size={13} />
                  Import media
                </button>
              )}
            </div>
          ) : (
            <div className="asset-grid">
              {filtered.map((a) => (
                <AssetCard key={a.id} asset={a} />
              ))}
            </div>
          ))}

        <button className="folder-row" onClick={() => setCompsOpen(!compsOpen)}>
          <ChevronDown
            size={12}
            style={{ transform: compsOpen ? "none" : "rotate(-90deg)", transition: "transform .15s" }}
          />
          <FolderClosed size={13} />
          <b>Compositions</b>
          <span className="count">1</span>
        </button>
        {compsOpen && (
          <div className="comp-list">
            <button className="comp-row active" onClick={() => setSettingsOpen(true)}>
              <Layers size={13} />
              main_comp
              <span className="mins">ACTIVE</span>
            </button>
            <button className="comp-row" onClick={() => setRenderOpen(true)}>
              <Clapperboard size={13} />
              render_outputs
              <span className="mins">{doneJobs > 0 ? `${doneJobs} DONE` : "EMPTY"}</span>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
