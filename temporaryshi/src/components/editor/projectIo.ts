"use client";

import { useEditorStore } from "@/lib/store";

export const PROJECT_ID = "astro";
export const STORAGE_KEY = "astro-editor:project:v1";

/** Always boot a fresh, empty workspace — nothing is ever restored. */
export async function loadProjectIntoStore(): Promise<void> {
  const st = useEditorStore.getState();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode — nothing to clear */
  }
  st.hydrate(PROJECT_ID, null);
}
