"use client";

import { ingestFile, isSupportedFile, relinkFile } from "@/lib/media";
import { useEditorStore } from "@/lib/store";
import type { AssetMeta } from "@/lib/types";

const MAX_BATCH = 16;

/** Ingest a dropped/picked batch of files into the media bin. */
export async function importFileList(list: Iterable<File>): Promise<void> {
  const files = Array.from(list).filter(isSupportedFile).slice(0, MAX_BATCH);
  const st = useEditorStore.getState();
  if (files.length === 0) {
    st.toast("No video or audio files in that selection", "warn");
    return;
  }
  for (const file of files) {
    try {
      const { meta, enhance } = await ingestFile(file);
      useEditorStore.getState().addAssetMeta(meta);
      // waveform decode happens after the card is already visible
      void enhance().then(({ peaks }) => {
        if (peaks) useEditorStore.getState().patchAsset(meta.id, { peaks });
      });
    } catch {
      useEditorStore.getState().toast(`Could not read ${file.name}`, "error");
    }
  }
}

/** Spawn an ephemeral file input — no hidden inputs rotting in the DOM. */
export function openFilePicker(onPicked?: (files: FileList) => void): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "video/*,audio/*";
  input.multiple = true;
  input.onchange = () => {
    if (input.files?.length) {
      if (onPicked) onPicked(input.files);
      else void importFileList(input.files);
    }
    input.remove();
  };
  input.click();
}

/** Relink an offline asset to a real file chosen by the user. */
export function relinkAssetFlow(asset: AssetMeta): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "video/*,audio/*";
  input.onchange = async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    try {
      const { patch, enhance } = await relinkFile(asset, file);
      const st = useEditorStore.getState();
      st.patchAsset(asset.id, { ...patch, name: asset.name });
      st.toast(`Relinked ${asset.name}`, "success");
      void enhance().then(({ peaks }) => {
        if (peaks) useEditorStore.getState().patchAsset(asset.id, { peaks });
      });
    } catch {
      useEditorStore.getState().toast(`Failed to relink ${asset.name}`, "error");
    }
  };
  input.click();
}
