import type { IJMAPClient } from "./client-interface";

/**
 * How many blob uploads to run at once against `client`'s server: its
 * maxConcurrentUpload (4 when the session doesn't say), past which it
 * refuses uploads, and two request slots left for the rest of the app.
 */
export function maxConcurrentUploads(client: Pick<IJMAPClient, "getCapabilities" | "getMaxConcurrentRequests">): number {
  const core = client.getCapabilities()["urn:ietf:params:jmap:core"] as { maxConcurrentUpload?: unknown } | undefined;
  const uploads = typeof core?.maxConcurrentUpload === "number" && core.maxConcurrentUpload > 0 ? core.maxConcurrentUpload : 4;
  return Math.max(1, Math.min(uploads, (client.getMaxConcurrentRequests?.() ?? 4) - 2));
}
