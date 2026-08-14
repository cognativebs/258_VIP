"use client";

import { useCallback, useRef, useState, type DragEvent, type ReactNode } from "react";
import { isAcceptedDropFile } from "@/lib/sourceDrop";

export type SourceDropZoneProps = {
  acceptExt?: string;
  acceptHint: string;
  enabled?: boolean;
  disabledReason?: string;
  busy?: boolean;
  message?: string | null;
  error?: string | null;
  onFile: (file: File) => void;
  toolbar?: ReactNode;
  children?: ReactNode;
};

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

/** Full-surface drop target with a visible strip. Same component on every collection terminal. */
export function SourceDropZone({
  acceptExt = ".xml",
  acceptHint,
  enabled = true,
  disabledReason,
  busy = false,
  message,
  error,
  onFile,
  toolbar,
  children,
}: SourceDropZoneProps) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const canDrop = enabled && !busy;

  const takeFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      if (!isAcceptedDropFile(file, acceptExt)) return;
      onFile(file);
    },
    [acceptExt, onFile],
  );

  const onDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth.current += 1;
    setOver(true);
  };

  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = canDrop ? "copy" : "none";
  };

  const onDragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setOver(false);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    depth.current = 0;
    setOver(false);
    if (!canDrop) return;
    takeFile(e.dataTransfer.files?.[0]);
  };

  return (
    <div
      className={`src-drop-root${over ? " is-over" : ""}${canDrop ? "" : " is-disabled"}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="src-bar">
        {toolbar}
        <div className="src-drop-strip">
          <input
            ref={inputRef}
            type="file"
            accept={acceptExt}
            className="src-drop-input"
            disabled={!canDrop}
            onChange={(e) => {
              takeFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="src-drop-hit"
            disabled={!canDrop}
            onClick={() => inputRef.current?.click()}
          >
            {busy
              ? "Saving to inbox…"
              : enabled
                ? acceptHint
                : (disabledReason ?? "Drop zone not available yet")}
          </button>
          {message ? <span className="src-drop-msg">{message}</span> : null}
          {error ? <span className="src-drop-err">{error}</span> : null}
        </div>
      </div>
      {children}
      {over ? (
        <div className="src-drop-overlay" aria-hidden="true">
          {canDrop ? acceptHint : (disabledReason ?? "Drop disabled")}
        </div>
      ) : null}
    </div>
  );
}
