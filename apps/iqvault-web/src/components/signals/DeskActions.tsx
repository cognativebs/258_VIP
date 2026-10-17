"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { vipSend } from "@/lib/signalsDesk";

/** Operator-only thesis status buttons. Orchestr8 writes drafts; only these move a thesis on. */
export function ThesisActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = status === "draft" ? (["active", "retired", "invalidated"] as const) : status === "active" ? (["retired", "invalidated"] as const) : [];
  if (!next.length) return null;
  const label = { active: "Activate", retired: "Retire", invalidated: "Invalidate" } as const;

  async function go(s: (typeof next)[number]) {
    const note = s === "active" ? undefined : (window.prompt(`Why ${label[s].toLowerCase()} this thesis? (optional)`) ?? undefined);
    setBusy(true);
    setError(null);
    const r = await vipSend(`/api/theses/${id}`, "PATCH", { status: s, ...(note ? { note } : {}) });
    setBusy(false);
    if (!r.ok) setError(r.error ?? "failed");
    else router.refresh();
  }

  return (
    <div className="desk-actions">
      {next.map((s) => (
        <button key={s} type="button" disabled={busy} onClick={() => go(s)} className={s === "active" ? "btn-primary" : undefined}>
          {label[s]}
        </button>
      ))}
      {error ? <span className="error-inline">{error}</span> : null}
    </div>
  );
}

/** Score one due prediction measurement: did the claim hold at this date? */
export function MeasureButtons({ measurementId }: { measurementId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go(directionCorrect: boolean) {
    setBusy(true);
    setError(null);
    const r = await vipSend(`/api/signals/predictions/measurements/${measurementId}`, "PATCH", { directionCorrect });
    setBusy(false);
    if (!r.ok) setError(r.error ?? "failed");
    else router.refresh();
  }

  return (
    <span className="desk-actions">
      <button type="button" disabled={busy} onClick={() => go(true)}>
        Held
      </button>
      <button type="button" disabled={busy} onClick={() => go(false)}>
        Did not hold
      </button>
      {error ? <span className="error-inline">{error}</span> : null}
    </span>
  );
}
