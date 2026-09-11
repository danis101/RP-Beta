/**
 * Konfiguracja połączenia z serwerem RP Sync.
 *
 * Dev: VITE_SYNC_URL z .env.development (np. http://192.168.100.80:8787).
 * Prod: same-origin (puste) — Hono serwuje statyki z tego samego kontenera
 *       co API, więc frontend woła względne ścieżki.
 */

export const SYNC_URL = (import.meta.env.VITE_SYNC_URL ?? '').trim()

/** Buduje pełny URL do endpointu API (lub względny gdy same-origin). */
export function syncUrl(path: string): string {
  if (!SYNC_URL) return path
  return `${SYNC_URL.replace(/\/+$/, '')}${path}`
}

/** Buduje URL do WebSocket kanału zdarzeń. */
export function wsUrl(token: string): string {
  const query = `?token=${encodeURIComponent(token)}`

  if (SYNC_URL) {
    const u = new URL(SYNC_URL)
    const proto = u.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${u.host}/ws${query}`
  }

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/ws${query}`
}
