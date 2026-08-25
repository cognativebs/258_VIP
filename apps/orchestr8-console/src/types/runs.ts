import { z } from "zod";

/** GET /v1/runs list item — matches orchestr8/api/runs_routes.py, not the Gate A draft RunRecord. */
export const RunListItemSchema = z.object({
  run_id: z.string(),
  task: z.string().nullable().optional(),
  mode: z.string().nullable().optional(),
  roles: z.array(z.string()).optional(),
  question: z.string().optional(),
  question_truncated: z.boolean().optional(),
  created_at: z.string().nullable().optional(),
  retrieved_at: z.string().optional(),
  costUsd: z.number().optional(),
  vetoed: z.boolean().optional(),
  paused: z.boolean().optional(),
  verification: z.string().nullable().optional(),
});
export type RunListItem = z.infer<typeof RunListItemSchema>;

export const RunListResponseSchema = z.object({
  runs: z.array(RunListItemSchema),
  count: z.number().int().nonnegative(),
  retrieved_at: z.string().optional(),
  source: z.string().optional(),
});
export type RunListResponse = z.infer<typeof RunListResponseSchema>;

/** GET /v1/runs/:id is the full persisted bundle. Require run_id; keep the rest. */
export const RunDetailSchema = z
  .object({
    run_id: z.string(),
  })
  .passthrough();
export type RunDetail = z.infer<typeof RunDetailSchema>;
