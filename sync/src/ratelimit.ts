/**
 * Prosty in-memory rate limiter.
 *
 * Wystarczy dla jednego procesu i LAN-u. Nie jest rozproszony — jeśli kiedyś
 * postawisz kilka instancji za load balancerem, trzeba to przenieść na Redis
 * albo współdzieloną bazę.
 *
 * Kasowanie starych wpisów: sprzątanie co 5 minut, żeby mapa nie rosła.
 */

interface Entry {
  count: number
  resetAt: number
}

const store = new Map<string, Entry>()

/** Zwraca `true` jeśli żądanie mieści się w limicie, `false` jeśli przekroczone. */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || entry.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }

  if (entry.count >= limit) {
    return false
  }

  entry.count++
  return true
}

/** Pomocniczo: nagłówek informujący ile czekać (Retry-After w sekundach). */
export function retryAfterSeconds(key: string): number {
  const entry = store.get(key)
  if (!entry) return 0
  const remaining = Math.max(0, entry.resetAt - Date.now())
  return Math.ceil(remaining / 1000)
}

// Sprzątanie starych wpisów co 5 min.
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key)
  }
}, 5 * 60 * 1000)
