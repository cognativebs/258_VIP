/** Browser drop → inbox API. Server writes the file; the job/API then syncs. */

export type SourceLink = {
  href: string;
  label: string;
  title?: string;
};

export type InboxStatus = {
  ok: boolean;
  inbox?: string;
  archive?: string;
  exists?: boolean;
  pendingCount?: number;
  pendingFiles?: string[];
  clzCloudUrl?: string;
  clzCollectorUrl?: string;
  error?: string;
};

export type InboxDropResult = {
  ok: boolean;
  savedAs?: string;
  path?: string;
  inbox?: string;
  bytes?: number;
  syncStarted?: boolean;
  error?: string;
};

export const DEFAULT_CLZ_CLOUD_URL = "https://cloud.clz.com/";
export const DEFAULT_CLZ_COLLECTOR_URL = "https://www.clz.com/comic-collector/";
export const DEFAULT_CLZ_SPORTS_URL = "https://www.clz.com/sports-collector/";

export const CLZ_CLOUD_URL =
  process.env.NEXT_PUBLIC_CLZ_CLOUD_URL ?? DEFAULT_CLZ_CLOUD_URL;
export const CLZ_COLLECTOR_URL =
  process.env.NEXT_PUBLIC_CLZ_COLLECTOR_URL ?? DEFAULT_CLZ_COLLECTOR_URL;
export const CLZ_SPORTS_URL =
  process.env.NEXT_PUBLIC_CLZ_SPORTS_URL ?? DEFAULT_CLZ_SPORTS_URL;

export const INBOX_UPLOAD_TIMEOUT_MS = 120_000;
export const INBOX_POLL_MS = 2_000;
export const INBOX_POLL_MAX_MS = 180_000;

export function isAcceptedDropFile(file: File, acceptExt = ".xml"): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(acceptExt.toLowerCase());
}
