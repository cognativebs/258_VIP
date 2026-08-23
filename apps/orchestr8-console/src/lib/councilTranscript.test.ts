import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCouncilTranscript, extractCouncilQuestions, specCopyPayload } from "./councilTranscript";

describe("councilTranscript", () => {
  it("builds user, role, question, and final bubbles", () => {
    const messages = buildCouncilTranscript({
      question: "Spec the HUD",
      attachmentNames: ["notes.md"],
      steps: [
        { role: "architect", role_label: "Architect", text: "Drafted schemas first." },
        { role: "critic", role_label: "Critic", text: "What host is v1? Confirm Windows." },
      ],
      result: { text: "Emitted spec.", vote: { vetoed: false, summary: "ok" } },
    });
    assert.equal(messages[0]?.kind, "user");
    assert.match(messages[0]?.body || "", /notes.md/);
    assert.ok(messages.some((m) => m.kind === "role" && m.title === "Architect"));
    assert.ok(messages.some((m) => m.kind === "question"));
    assert.ok(messages.some((m) => m.kind === "final"));
  });

  it("extracts unique question lines from critic text", () => {
    const qs = extractCouncilQuestions(
      {
        vote: { summary: "Need a host pick?" },
        trace: [{ role: "critic", text: "What host is v1?\nWhat host is v1?" }],
      },
      [],
    );
    assert.ok(qs.includes("Need a host pick?"));
    assert.equal(qs.filter((q) => q.includes("What host")).length, 1);
  });

  it("copies cursor_prompt from the spec JSON", () => {
    const payload = specCopyPayload({
      markdown: "# Spec",
      spec: { cursor_prompt: "Build the HUD" },
    });
    assert.equal(payload.cursorPrompt, "Build the HUD");
    assert.match(payload.json, /cursor_prompt/);
  });
});
