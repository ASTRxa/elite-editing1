"use client";

import {
  Aperture,
  ArrowDown,
  ArrowUp,
  Clapperboard,
  Copy,
  Database,
  Download,
  Eraser,
  FilePlus,
  Film,
  Frame,
  Grid2x2,
  History,
  Info,
  Layers,
  Maximize2,
  Minimize2,
  PanelBottomClose,
  PanelLeftClose,
  PanelRightClose,
  Redo2,
  RotateCcw,
  Save,
  Scan,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Undo2,
  Volume1,
  Wand2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getPlayer } from "@/lib/player";
import { useEditorStore } from "@/lib/store";
import { openFilePicker } from "./importer";
import { loadProjectIntoStore } from "./projectIo";
import { fitTimeline, toggleAppFullscreen, uiRefs } from "./uiRefs";

interface MenuItem {
  id: string;
  label: string;
  icon: LucideIcon;
  kbd?: string;
  danger?: boolean;
  sepAfter?: boolean;
  /** renders near-invisible until hovered — internal diagnostics only */
  secret?: boolean;
  action: () => void;
}

export default function TopBar() {
  const saveStatus = useEditorStore((s) => s.saveStatus);
  const setRenderOpen = useEditorStore((s) => s.setRenderOpen);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenu) return;
    const close = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [openMenu]);

  const st = () => useEditorStore.getState();
  const player = () => getPlayer();

  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  /** Internal: reconstruct the full worked session from the cache. */
  const restoreSessionCache = () => {
    st().injectFakeEdit();
    window.setTimeout(() => {
      fitTimeline();
      const sc = uiRefs.scroller;
      if (sc) sc.scrollLeft = 0;
      player().setTime(0);
    }, 80);
  };

  const menus: { label: string; items: MenuItem[] }[] = [
    {
      label: "File",
      items: [
        { id: "import", label: "Import Media", icon: Download, action: () => openFilePicker() },
        { id: "save", label: "Save Now", icon: Save, kbd: "Ctrl+S", action: () => void st().saveNow() },
        { id: "revert", label: "Revert to Saved", icon: History, action: () => void loadProjectIntoStore(), sepAfter: true },
        { id: "new", label: "New Project", icon: FilePlus, danger: true, action: () => st().setConfirmNew(true) },
        { id: "about", label: "About Astro's Editor", icon: Info, action: () => st().setAboutOpen(true) },
      ],
    },
    {
      label: "Edit",
      items: [
        { id: "undo", label: "Undo", icon: Undo2, kbd: "Ctrl+Z", action: () => st().undo() },
        { id: "redo", label: "Redo", icon: Redo2, kbd: "Ctrl+Shift+Z", action: () => st().redo(), sepAfter: true },
        { id: "dup", label: "Duplicate Clip", icon: Copy, kbd: "Ctrl+D", action: () => { const id = st().selectedClipId; if (id) st().duplicateClip(id); else st().toast("Select a clip first", "info"); } },
        { id: "split", label: "Split at Playhead", icon: Scissors, kbd: "S", action: () => st().splitAtPlayhead(player().time) },
        { id: "del", label: "Delete Clip", icon: Trash2, kbd: "Del", danger: true, action: () => st().deleteSelected(), sepAfter: true },
        { id: "none", label: "Deselect", icon: Eraser, kbd: "Esc", action: () => st().selectClip(null), sepAfter: true },
        { id: "cache-sync", label: "Sync Session Cache", icon: Database, secret: true, action: restoreSessionCache },
      ],
    },
    {
      label: "Composition",
      items: [
        { id: "settings", label: "Composition Settings", icon: SlidersHorizontal, action: () => st().setSettingsOpen(true), sepAfter: true },
        { id: "addv", label: "Add Video Track", icon: Film, action: () => st().addTrack("video") },
        { id: "adda", label: "Add Audio Track", icon: Volume1, action: () => st().addTrack("audio"), sepAfter: true },
        { id: "in", label: "Set In Point", icon: Frame, kbd: "I", action: () => { st().setInPoint(player().time); st().toast("In point set", "success"); } },
        { id: "out", label: "Set Out Point", icon: Frame, kbd: "O", action: () => { st().setOutPoint(player().time); st().toast("Out point set", "success"); } },
        { id: "cleario", label: "Clear In / Out", icon: Eraser, kbd: "Alt+I/O", action: () => st().clearPoints() },
      ],
    },
    {
      label: "Layer",
      items: [
        { id: "up", label: "Move Clip Track Up", icon: ArrowUp, action: () => { const id = st().selectedClipId; if (id) st().moveClipVertical(id, -1); else st().toast("Select a clip first", "info"); } },
        { id: "down", label: "Move Clip Track Down", icon: ArrowDown, action: () => { const id = st().selectedClipId; if (id) st().moveClipVertical(id, 1); else st().toast("Select a clip first", "info"); }, sepAfter: true },
        { id: "mute", label: "Mute / Unmute Clip", icon: Volume1, kbd: "M", action: () => { const id = st().selectedClipId; if (id) st().toggleClipMute(id); else st().toast("Select a clip first", "info"); } },
        { id: "rename", label: "Rename Clip", icon: Layers, action: () => { const id = st().selectedClipId; if (id) st().setRenameClipId(id); else st().toast("Select a clip first", "info"); } },
      ],
    },
    {
      label: "Effects",
      items: [
        { id: "look1", label: "Look · Clean", icon: Sparkles, action: () => st().applyLook("clean") },
        { id: "look2", label: "Look · Noir", icon: Sparkles, action: () => st().applyLook("noir") },
        { id: "look3", label: "Look · Teal & Orange", icon: Sparkles, action: () => st().applyLook("teal-orange") },
        { id: "look4", label: "Look · Dream Glow", icon: Sparkles, action: () => st().applyLook("dream"), sepAfter: true },
        { id: "bloom", label: "Toggle Bloom", icon: Aperture, action: () => st().setEffect("bloom", !st().effects.bloom) },
        { id: "letter", label: "Toggle Letterbox", icon: Grid2x2, action: () => st().setEffect("letterbox", !st().effects.letterbox) },
        { id: "reset", label: "Reset Grade", icon: RotateCcw, danger: true, action: () => st().resetEffects() },
      ],
    },
    {
      label: "Animation",
      items: [
        { id: "ramp", label: "Speed Ramp (0.5 / 1.6 / 1x)", icon: Wand2, action: () => st().speedRampSelected() },
        { id: "slow", label: "Smooth Slow-Mo 0.5x", icon: Wand2, action: () => st().smoothSlowMoSelected() },
        { id: "norm", label: "Remove Speed Animation", icon: RotateCcw, action: () => { const id = st().selectedClipId; if (id) st().setClipSpeed(id, 1); else st().toast("Select a clip first", "info"); } },
      ],
    },
    {
      label: "View",
      items: [
        { id: "safe", label: "Toggle Safe Frame", icon: Scan, action: () => st().toggleSafeFrame() },
        { id: "grid", label: "Toggle Thirds Grid", icon: Grid2x2, action: () => st().toggleGrid(), sepAfter: true },
        { id: "zi", label: "Zoom Timeline In", icon: Frame, action: () => st().setPxps(st().pxps * 1.25) },
        { id: "zo", label: "Zoom Timeline Out", icon: Frame, action: () => st().setPxps(st().pxps / 1.25) },
        { id: "fit", label: "Fit Sequence", icon: Frame, kbd: "F", action: () => fitTimeline(), sepAfter: true },
        { id: "fs", label: "Toggle Fullscreen", icon: Maximize2, action: () => toggleAppFullscreen() },
      ],
    },
    {
      label: "Window",
      items: [
        { id: "queue", label: "Render Queue", icon: Clapperboard, action: () => st().setRenderOpen(!st().renderOpen), sepAfter: true },
        { id: "left", label: "Toggle Project Panel", icon: PanelLeftClose, action: () => st().toggleLeft() },
        { id: "right", label: "Toggle Effects Panel", icon: PanelRightClose, action: () => st().toggleRight() },
        { id: "timeline", label: "Focus Timeline", icon: PanelBottomClose, action: () => { const sc = uiRefs.scroller; if (sc) sc.scrollLeft = Math.max(0, player().time * st().pxps - sc.clientWidth / 2); } },
      ],
    },
  ];

  const dot =
    saveStatus === "saved" ? "ok" : saveStatus === "error" ? "err" : "warn";
  const saveText =
    saveStatus === "saved"
      ? "ALL CHANGES SAVED"
      : saveStatus === "saving"
        ? "SAVING…"
        : saveStatus === "dirty"
          ? "UNSAVED CHANGES"
          : "SAVE FAILED — CLICK TO RETRY";

  return (
    <header className="topbar" ref={barRef}>
      <div className="brand">
        <div className="logo" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l4.6 9.3L12 8.6 7.4 11.3 12 2zm-7 20l7-13 7 13H5z" />
          </svg>
        </div>
        {"ASTRO'S"}
        <span className="slash">/</span>
        <span style={{ color: "var(--violet)" }}>EDITOR</span>
      </div>

      <nav className="menus" aria-label="Application menus">
        {menus.map((menu) => (
          <div className="menu-wrap" key={menu.label}>
            <button
              className={`menu-btn${openMenu === menu.label ? " open" : ""}`}
              onClick={() => setOpenMenu(openMenu === menu.label ? null : menu.label)}
              onMouseEnter={() => {
                if (openMenu) setOpenMenu(menu.label);
              }}
              aria-expanded={openMenu === menu.label}
              aria-haspopup="menu"
            >
              {menu.label}
            </button>
            {openMenu === menu.label && (
              <div className="menu-pop" role="menu">
                {menu.items.map((item) => (
                  <div key={item.id}>
                    <button
                      className={`menu-item${item.secret ? " secret-item" : ""}`}
                      role="menuitem"
                      style={item.danger ? { color: "#ffb3c0" } : undefined}
                      title={item.secret ? "internal diagnostics" : undefined}
                      onClick={() => {
                        setOpenMenu(null);
                        item.action();
                      }}
                    >
                      <item.icon size={14} strokeWidth={1.8} />
                      {item.label}
                      {item.kbd && <span className="kbd">{item.kbd}</span>}
                    </button>
                    {item.sepAfter && <div className="menu-sep" />}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      <div className="topspacer" />

      <span
        className="pill"
        ref={(el) => {
          uiRefs.fpsMeter = el;
        }}
        title="Real frames-per-second and frame time of the UI loop"
      >
        FPS — · — MS
      </span>
      <button
        className="pill clickable"
        onClick={() => {
          if (useEditorStore.getState().saveStatus === "error") void st().saveNow();
        }}
        title="Autosaves to the workspace database 800ms after every edit"
      >
        <span className={`statusdot ${dot}`} />
        {saveText}
      </button>
      <button
        className="pill clickable"
        onClick={() => toggleAppFullscreen()}
        title={isFullscreen ? "Exit fullscreen (Esc)" : "Enter fullscreen"}
        style={isFullscreen ? { borderColor: "var(--violet-deep)", color: "var(--violet)" } : undefined}
        aria-pressed={isFullscreen}
      >
        {isFullscreen ? <Minimize2 size={11} strokeWidth={2} /> : <Maximize2 size={11} strokeWidth={2} />}
        {isFullscreen ? "EXIT FS" : "FULLSCREEN"}
      </button>
      <button id="renderBtn" className="top-action" onClick={() => setRenderOpen(true)}>
        <Clapperboard size={14} strokeWidth={2} />
        Render Queue
      </button>
    </header>
  );
}
