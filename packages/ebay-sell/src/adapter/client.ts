import { redactSecrets } from "./auth.js";
import type { EbayApiErrorClass, EbayApiResult, EbayEnvironment } from "../schemas.js";
import { sellAuthHosts } from "./auth.js";

export type EbayAuditEvent = {
  method: string;
  path: string;
  status: number;
  errorClass: EbayApiErrorClass | null;
  errorMessage: string | null;
  requestIdempotencyKey?: string;
  durationMs: number;
};

export type EbayHttpClient = {
  request: (input: {
    method: string;
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
    idempotencyKey?: string;
  }) => Promise<EbayApiResult>;
};

export type CreateEbayHttpClientOptions = {
  env: EbayEnvironment;
  accessToken: string;
  fetchImpl?: typeof fetch;
  onAudit?: (event: EbayAuditEvent) => void | Promise<void>;
  maxRetries?: number;
};

export function classifyHttpError(status: number): EbayApiErrorClass | null {
  if (status >= 200 && status < 300) return null;
  if (status === 429 || status >= 500) return "retryable";
  if (status === 408) return "retryable";
  return "non_retryable";
}

export function createEbayHttpClient(opts: CreateEbayHttpClientOptions): EbayHttpClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxRetries = opts.maxRetries ?? 2;
  const { api } = sellAuthHosts(opts.env);

  return {
    async request(input) {
      let last: EbayApiResult = {
        ok: false,
        status: 0,
        errorClass: "retryable",
        errorMessage: "request not sent",
      };
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const started = Date.now();
        try {
          const res = await fetchImpl(`${api}${input.path}`, {
            method: input.method,
            headers: {
              Authorization: `Bearer ${opts.accessToken}`,
              Accept: "application/json",
              "Content-Language": "en-US",
              ...(input.body !== undefined ? { "Content-Type": "application/json" } : {}),
              ...(input.headers ?? {}),
            },
            body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
          });
          const text = await res.text();
          let body: unknown = null;
          if (text) {
            try {
              body = JSON.parse(text);
            } catch {
              body = { raw: redactSecrets(text.slice(0, 400)) };
            }
          }
          const errorClass = classifyHttpError(res.status);
          const errorMessage = res.ok
            ? null
            : extractErrorMessage(body) ?? `eBay HTTP ${res.status}`;
          last = {
            ok: res.ok,
            status: res.status,
            errorClass,
            errorMessage,
            body,
          };
          await opts.onAudit?.({
            method: input.method,
            path: input.path,
            status: res.status,
            errorClass,
            errorMessage,
            requestIdempotencyKey: input.idempotencyKey,
            durationMs: Date.now() - started,
          });
          if (res.ok || errorClass !== "retryable" || attempt === maxRetries) {
            return last;
          }
        } catch (e) {
          last = {
            ok: false,
            status: 0,
            errorClass: "retryable",
            errorMessage: e instanceof Error ? e.message : String(e),
          };
          await opts.onAudit?.({
            method: input.method,
            path: input.path,
            status: 0,
            errorClass: "retryable",
            errorMessage: last.errorMessage,
            requestIdempotencyKey: input.idempotencyKey,
            durationMs: Date.now() - started,
          });
          if (attempt === maxRetries) return last;
        }
      }
      return last;
    },
  };
}

function extractErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const rec = body as { errors?: { message?: string }[]; message?: string };
  if (Array.isArray(rec.errors) && rec.errors[0]?.message) return rec.errors[0].message;
  if (typeof rec.message === "string") return rec.message;
  return null;
}
