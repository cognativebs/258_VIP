"use client";

import { useEffect, useState } from "react";
import { buildEffective, useCouncilSession } from "@/lib/councilSession";
import { fetchSpec } from "@/lib/orchestr8Api";
import { specCopyPayload } from "@/lib/councilTranscript";
import {
  capAttachments,
  parseRefPaths,
  type OperatorAttachment,
} from "@/lib/operatorAttachments";
import { CouncilChat } from "@/components/CouncilChat";
import { OperatorAttach } from "@/components/OperatorAttach";
import {
  VETO_REVISION_MAX,
  buildVetoRevisionPrompt,
  extractCriticNotes,
  isVetoRevisionPrompt,
} from "@/lib/reviseFromVeto";

export function BuildSpecPanel() {
  const { team, runJob, sessions, liveKind, setTab } = useCouncilSession();
  const session = sessions.build;
  const [goal, setGoal] = useState(
    "Sources registry API + IQVault Sources editor with active toggle and contribution stats."
  );
  const [attachments, setAttachments] = useState<OperatorAttachment[]>([]);
  const [refPaths, setRefPaths] = useState("");
  const [attachErrors, setAttachErrors] = useState<string[]>([]);
  const [products, setProducts] = useState<{
    markdown: string;
    json: string;
    cursorPrompt: string;
  } | null>(null);
  /** Source run ids that already consumed the 1× revise (draft loaded or revision executed). */
  const [revisionConsumedRunIds, setRevisionConsumedRunIds] = useState<Record<string, true>>({});

  const loading = session.loading;
  const busy = Boolean(liveKind);
  const vetoed = Boolean(session.result?.vote?.vetoed);
  const status = session.result?.buildSpecStatus;
  const cost = session.result?.usage?.costUsd;
  const runId = session.result?.runId || null;
  const specId = session.result?.buildSpecId || null;

  const canRevise =
    vetoed &&
    Boolean(runId) &&
    !loading &&
    !busy &&
    !isVetoRevisionPrompt(session.question) &&
    !revisionConsumedRunIds[runId!];

  const draftLoaded = Boolean(runId && revisionConsumedRunIds[runId] && isVetoRevisionPrompt(goal));

  useEffect(() => {
    if (!specId) {
      setProducts(null);
      return;
    }
    let cancelled = false;
    fetchSpec(specId)
      .then((data) => {
        if (!cancelled) setProducts(specCopyPayload(data));
      })
      .catch(() => {
        if (!cancelled) setProducts(null);
      });
    return () => {
      cancelled = true;
    };
  }, [specId]);

  const loadRevisionDraft = () => {
    if (!session.result?.runId || !canRevise) return;
    const sourceId = session.result.runId;
    setGoal(
      buildVetoRevisionPrompt({
        priorRunId: sourceId,
        originalGoal: session.question || goal,
        criticNotes: extractCriticNotes(session.result, session.steps),
        voteSummary: session.result.vote?.summary,
      })
    );
    setRevisionConsumedRunIds((prev) => ({ ...prev, [sourceId]: true }));
  };

  const run = async () => {
    const question = goal.trim();
    if (!question || busy) return;
    const roster = buildEffective(team);
    const revising = isVetoRevisionPrompt(question);
    const priorRunId = revising ? runId : null;
    try {
      await runJob({
        kind: "build",
        task: "build_spec",
        question,
        roles: roster.roles,
        mode: roster.roles.length === 1 ? "single" : roster.mode,
        council: roster.councilId || "build_spec",
        contextJson: JSON.stringify({
          backlogItem: question,
          adr: "0003",
          source: revising ? "orchestr8-console-revise-veto" : "orchestr8-console",
          revisionRound: revising ? 1 : 0,
          revisionMax: VETO_REVISION_MAX,
          priorRunId: priorRunId || undefined,
          operatorAttachments: capAttachments(attachments),
          operatorRefPaths: parseRefPaths(refPaths),
        }),
      });
    } catch {
      /* error stored on session */
    }
  };

  return (
    <div className="panel">
      <h2>Build Spec</h2>
      <p className="sub">
        Orchestr8 authors a critic-passed work order; Cursor builds it (ADR 0003). Attach reference
        files, watch the council chat, then copy .md / JSON / Cursor prompt. Live progress also stays
        in the dock. After a veto: one revision max.
      </p>

      <label className="field">
        <span>Backlog goal</span>
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Describe the backlog item to spec…"
          disabled={loading}
        />
      </label>

      <OperatorAttach
        attachments={attachments}
        onAttachments={setAttachments}
        refPaths={refPaths}
        onRefPaths={setRefPaths}
        errors={attachErrors}
        onErrors={setAttachErrors}
        disabled={loading}
      />

      <div className="actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !goal.trim()}
          onClick={() => void run()}
        >
          {loading ? "Running council…" : "Run Build Spec Council"}
        </button>
        {canRevise && (
          <button type="button" className="btn" onClick={loadRevisionDraft}>
            Revise from veto (1×)
          </button>
        )}
        {draftLoaded && (
          <span className="dim">Revision draft loaded — review, then Run (this is the 1×).</span>
        )}
        {vetoed && runId && revisionConsumedRunIds[runId] && !isVetoRevisionPrompt(goal) && (
          <span className="dim">Revision budget spent for this run — park or fill by hand.</span>
        )}
        {vetoed && isVetoRevisionPrompt(session.question) && (
          <span className="dim">Already a revision result — no further council loops.</span>
        )}
        {busy && liveKind !== "build" && (
          <span className="dim">Another council is running ({liveKind}).</span>
        )}
      </div>

      {session.error && <div className="banner error">{session.error}</div>}

      {session.result && (
        <div
          className={`banner ${vetoed ? "error" : status?.startsWith("emit_failed") ? "warn" : "ok"}`}
        >
          <div>
            <strong>{vetoed ? "VETOED" : status || "done"}</strong>
            {session.result.runId ? ` · ${session.result.runId}` : ""}
            {typeof cost === "number" ? ` · $${cost.toFixed(4)}` : ""}
          </div>
          {session.result.vote?.summary && (
            <div style={{ marginTop: 6 }}>{session.result.vote.summary}</div>
          )}
          {session.result.buildSpecPath && (
            <div style={{ marginTop: 6 }}>
              Spec path: <span className="mono">{session.result.buildSpecPath}</span>
              {session.result.buildSpecId ? ` · id ${session.result.buildSpecId}` : ""}{" "}
              <button
                type="button"
                className="btn btn-ghost"
                style={{ marginLeft: 8 }}
                onClick={() => setTab("specs")}
              >
                Open Specs
              </button>
            </div>
          )}
        </div>
      )}

      <CouncilChat
        question={session.question || goal}
        attachmentNames={attachments.map((a) => a.name)}
        progressMessage={session.progressMessage}
        loading={loading}
        steps={session.steps}
        result={session.result}
        error={session.error}
        products={products || undefined}
        onInsertQuestions={(qs) =>
          setGoal((g) =>
            `${g.trim()}\n\n## Operator answers to council questions\n${qs
              .map((q) => `- ${q}\n  Answer: `)
              .join("\n")}`
          )
        }
      />
    </div>
  );
}
