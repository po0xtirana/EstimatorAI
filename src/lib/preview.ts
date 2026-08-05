// Temporary local-only preview access. This must never be used as production auth.
export const PREVIEW_COOKIE = "estimator_preview";

export function isLocalHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
