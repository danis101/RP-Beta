/** Konfiguracja z env, z sensownymi domyślnymi na dev. */

export const DATA_DIR = process.env.DATA_DIR || './data'
export const PORT = Number(process.env.PORT) || 8787
export const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me-in-production'
export const JWT_TTL_SECONDS = 60 * 60 * 24 * 30 // 30 dni

/** Limit rozmiaru pojedynczego bloba (20 MB). */
export const MAX_BLOB_BYTES = 20 * 1024 * 1024

/**
 * Konto admina seedowane przy pierwszym starcie na pustej bazie.
 * Jeśli w bazie już jest jakikolwiek admin — env jest ignorowane.
 */
export const ADMIN_USERNAME = process.env.ADMIN_USERNAME || ''
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''

/** Retencja soft-deleted encji przed hard delete (7 dni). */
export const SOFT_DELETE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

/** Interwał GC (24h). */
export const GC_INTERVAL_MS = 24 * 60 * 60 * 1000

/** Rate limit logowania: 5 prób / minutę / IP. */
export const LOGIN_RATE_LIMIT = 5
export const LOGIN_RATE_WINDOW_MS = 60 * 1000

if (JWT_SECRET.startsWith('dev-secret') && process.env.NODE_ENV === 'production') {
  console.warn('[config] UWAGA: JWT_SECRET nie jest ustawiony produkcyjnie — ustaw go w .env')
}

if (process.env.NODE_ENV === 'production' && (!ADMIN_USERNAME || !ADMIN_PASSWORD)) {
  console.warn(
    '[config] UWAGA: ADMIN_USERNAME / ADMIN_PASSWORD nie są ustawione. ' +
      'Jeśli baza jest pusta, nie da się utworzyć konta admina — zaloguj się nie będzie możliwe.',
  )
}
