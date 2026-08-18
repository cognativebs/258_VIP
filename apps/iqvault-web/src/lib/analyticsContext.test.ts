import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COMICS_PROMPTS,
  SPORTS_PROMPTS,
  TCG_PROMPTS,
  suggestedPrompts,
} from "./analyticsContext";

test("TCG verticals get card wording, not comics wording", () => {
  assert.deepEqual(suggestedPrompts("pokemon"), TCG_PROMPTS);
  assert.deepEqual(suggestedPrompts("mtg"), TCG_PROMPTS);
  // "books" belongs to comics prompts; a card terminal must not ask about books.
  assert.equal(
    suggestedPrompts("pokemon").some((p) => /\bbooks\b/i.test(p)),
    false,
  );
});

test("sports verticals get sports wording", () => {
  for (const id of ["football", "soccer", "basketball", "baseball"]) {
    assert.deepEqual(suggestedPrompts(id), SPORTS_PROMPTS);
  }
});

test("comics and unknown verticals fall back to comics prompts", () => {
  assert.deepEqual(suggestedPrompts("comic"), COMICS_PROMPTS);
  assert.deepEqual(suggestedPrompts("whatever"), COMICS_PROMPTS);
});
