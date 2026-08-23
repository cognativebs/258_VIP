"use client";

import { useRef } from "react";
import {
  ALLOWED_SUFFIXES,
  capAttachments,
  type OperatorAttachment,
  readLocalFiles,
} from "@/lib/operatorAttachments";

export function OperatorAttach({
  attachments,
  onAttachments,
  refPaths,
  onRefPaths,
  errors,
  onErrors,
  disabled,
}: {
  attachments: OperatorAttachment[];
  onAttachments: (next: OperatorAttachment[]) => void;
  refPaths: string;
  onRefPaths: (next: string) => void;
  errors: string[];
  onErrors: (next: string[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const { attachments: added, errors: nextErrors } = await readLocalFiles(list);
    onAttachments(capAttachments([...attachments, ...added]));
    onErrors(nextErrors);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="attach-block">
      <span className="field-label">Reference files</span>
      <p className="dim attach-help">
        Upload or paste text the council should read. In-repo paths are read by the gateway
        (architect sandbox). Not a live tool loop — attach before Run.
      </p>
      <div className="attach-row">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ALLOWED_SUFFIXES.join(",")}
          disabled={disabled}
          onChange={(e) => void addFiles(e.target.files)}
        />
        <span className="dim">{ALLOWED_SUFFIXES.join(" ")}</span>
      </div>
      {attachments.length > 0 && (
        <ul className="attach-list">
          {attachments.map((a, i) => (
            <li key={`${a.name}-${i}`}>
              <code>{a.name}</code>
              <span className="dim"> · {a.text.length} chars · {a.source}</span>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={disabled}
                onClick={() => onAttachments(attachments.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="field">
        <span>Repo paths (one per line)</span>
        <textarea
          value={refPaths}
          disabled={disabled}
          placeholder={"docs/prompts/2026-08-23_orchestr8_viture_luma_ultra_v1_master.md\nAGENTS.md"}
          onChange={(e) => onRefPaths(e.target.value)}
          rows={3}
        />
      </label>
      {errors.length > 0 && (
        <div className="banner warn">
          {errors.map((err) => (
            <div key={err}>{err}</div>
          ))}
        </div>
      )}
    </div>
  );
}
