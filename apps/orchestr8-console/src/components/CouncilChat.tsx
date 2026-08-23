"use client";

import { useMemo, useState } from "react";
import type { JobResult, JobStep } from "@/lib/orchestr8Api";
import { buildCouncilTranscript, type CouncilChatMessage } from "@/lib/councilTranscript";

export function CouncilChat({
  question,
  attachmentNames,
  progressMessage,
  loading,
  steps,
  result,
  error,
  products,
  onInsertQuestions,
}: {
  question: string;
  attachmentNames?: string[];
  progressMessage?: string | null;
  loading?: boolean;
  steps: JobStep[];
  result: JobResult | null;
  error?: string | null;
  products?: { markdown: string; json: string; cursorPrompt: string };
  onInsertQuestions?: (questions: string[]) => void;
}) {
  const messages = useMemo(
    () =>
      buildCouncilTranscript({
        question,
        attachmentNames,
        progressMessage,
        loading,
        steps,
        result,
        error,
      }),
    [question, attachmentNames, progressMessage, loading, steps, result, error]
  );
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);

  if (!messages.length && !products) return null;

  const expandAll = () => {
    const next: Record<string, boolean> = {};
    for (const m of messages) next[m.id] = true;
    setOpenIds(next);
  };
  const collapseAll = () => setOpenIds({});
  const toggle = (id: string) => setOpenIds((prev) => ({ ...prev, [id]: !prev[id] }));

  const copy = async (label: string, text: string) => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1600);
  };

  const questions = messages.filter((m) => m.kind === "question").map((m) => m.body);

  return (
    <section className="council-chat" aria-label="Council conversation">
      <div className="council-chat-head">
        <strong>Council chat</strong>
        <span className="dim"> · {loading ? "running" : "idle"}</span>
        <div className="council-chat-actions">
          <button type="button" className="btn btn-ghost" onClick={expandAll}>
            Expand all
          </button>
          <button type="button" className="btn btn-ghost" onClick={collapseAll}>
            Collapse
          </button>
        </div>
      </div>
      <p className="dim">
        One-shot council (no mid-run Q&amp;A). Questions appear after Critic. Final spec copies
        below when emit succeeds.
      </p>
      <div className="council-chat-thread">
        {messages.map((m) => (
          <ChatBubble key={m.id} message={m} open={Boolean(openIds[m.id])} onToggle={() => toggle(m.id)} />
        ))}
      </div>
      {questions.length > 0 && onInsertQuestions && (
        <button type="button" className="btn" onClick={() => onInsertQuestions(questions)}>
          Insert council questions into goal
        </button>
      )}
      <div className="council-products">
        <strong>Final product</strong>
        <div className="council-chat-actions">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!products?.markdown}
            onClick={() => void copy("md", products?.markdown || "")}
          >
            Copy .md
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!products?.json}
            onClick={() => void copy("json", products?.json || "")}
          >
            Copy JSON
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!products?.cursorPrompt}
            onClick={() => void copy("prompt", products?.cursorPrompt || "")}
          >
            Copy Cursor prompt
          </button>
        </div>
        {copied ? <span className="dim">Copied {copied}</span> : null}
        {!products?.markdown && !products?.json && (
          <p className="dim">Copies unlock after a spec emit (or open Specs).</p>
        )}
      </div>
    </section>
  );
}

function ChatBubble({
  message,
  open,
  onToggle,
}: {
  message: CouncilChatMessage;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <article className={`cc-msg cc-${message.kind}`}>
      <button type="button" className="cc-msg-head" onClick={onToggle}>
        <span className="cc-who">{message.title}</span>
        {message.meta ? <span className="dim"> · {message.meta}</span> : null}
        <span className="cc-toggle">{open ? "▾" : "▸"}</span>
      </button>
      <div className="cc-msg-body">{open ? message.body : message.preview}</div>
    </article>
  );
}
