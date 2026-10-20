"use client";

import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { useEditorStore } from "@/lib/store";

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warn: AlertTriangle,
  error: XCircle,
} as const;

export default function Toasts() {
  const toasts = useEditorStore((s) => s.toasts);
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => {
        const Icon = ICONS[t.tone];
        return (
          <div className={`toast ${t.tone}`} key={t.id}>
            <Icon size={14} strokeWidth={2} />
            {t.message}
          </div>
        );
      })}
    </div>
  );
}
