/**
 * Uwierzytelnianie: hashowanie haseł, JWT, middleware, walidacja.
 *
 * Hashowanie: Bun.password (argon2id).
 * Token: JWT HS256, 30 dni ważności.
 *
 * Uwaga o Hono >= 4.6: `verify` wymaga jawnego `alg` w opcjach.
 * Bez tego rzuca JwtAlgorithmRequired. Ustawiamy 'HS256' w JWT_ALG.
 *
 * Sesje:
 *   Każdy token niesie `sv` (session_version) zalogowanego usera w chwili
 *   wystawienia. Middleware sprawdza zgodność `sv` z aktualnym w bazie.
 *   Bump `sv` (przy zmianie hasła, przy admin reset hasła) unieważnia
 *   WSZYSTKIE istniejące tokeny tego usera — bezpieczne wylogowanie globalne.
 *   Usunięcie konta powoduje że user nie istnieje w bazie → 401.
 */

import { sign, verify } from 'hono/jwt'
import type { SignatureAlgorithm } from 'hono/utils/jwt/types'
import { createMiddleware } from 'hono/factory'
import { JWT_SECRET, JWT_TTL_SECONDS } from './config'
import { db } from './db'

const JWT_ALG: SignatureAlgorithm = 'HS256'

export type AppEnv = {
  Variables: {
    userId: string
    username: string
    isAdmin: boolean
  }
}

export interface JwtPayload {
  sub: string
  username: string
  /** session_version w chwili wystawienia tokenu. */
  sv: number
  exp: number
  [key: string]: unknown
}

// --- Hasła ---

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: 'argon2id' })
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await Bun.password.verify(password, hash)
  } catch {
    return false
  }
}

// --- Tokeny ---

export async function createToken(
  userId: string,
  username: string,
  sessionVersion: number,
): Promise<string> {
  const payload: JwtPayload = {
    sub: userId,
    username,
    sv: sessionVersion,
    exp: Math.floor(Date.now() / 1000) + JWT_TTL_SECONDS,
  }
  return sign(payload, JWT_SECRET, JWT_ALG)
}

export async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    const payload = (await verify(token, JWT_SECRET, JWT_ALG)) as JwtPayload
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
      return null
    }
    return payload
  } catch {
    return null
  }
}

// --- Stan konta / sesji ---

export interface UserSessionInfo {
  isAdmin: boolean
  sessionVersion: number
}

/**
 * Świeży odczyt stanu usera z bazy.
 * Zwraca `null` jeśli konto nie istnieje — middleware na tej podstawie
 * odrzuca tokeny usuniętych kont.
 */
export function getUserSessionInfo(userId: string): UserSessionInfo | null {
  const row = db
    .query('SELECT is_admin, session_version FROM users WHERE id = ?')
    .get(userId) as { is_admin: number; session_version: number } | null
  if (!row) return null
  return { isAdmin: row.is_admin === 1, sessionVersion: row.session_version }
}

/**
 * Bump wersji sesji — unieważnia wszystkie aktywne tokeny tego usera.
 * Wywoływane przy zmianie hasła (własnego i przez admina).
 */
export function bumpUserSessionVersion(userId: string): void {
  db.run('UPDATE users SET session_version = session_version + 1 WHERE id = ?', [userId])
}

/** Sprawdza, czy user o danym id ma uprawnienia admina (świeży odczyt z bazy). */
export function isUserAdmin(userId: string): boolean {
  const info = getUserSessionInfo(userId)
  return info?.isAdmin === true
}

// --- Walidacja danych wejściowych ---

export function validateUsername(username: string): string | null {
  if (!username) return 'Nazwa użytkownika jest wymagana'
  if (username.length < 3 || username.length > 32) return 'Nazwa użytkownika musi mieć 3–32 znaków'
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) return 'Dozwolone znaki: a–z, A–Z, 0–9, _ oraz -'
  return null
}

export function validatePassword(password: string): string | null {
  if (!password) return 'Hasło jest wymagane'
  if (password.length < 8) return 'Hasło musi mieć co najmniej 8 znaków'
  if (password.length > 200) return 'Hasło jest zbyt długie'
  return null
}

// --- Wspólna weryfikacja tokenu + sesji ---

interface SessionCheckOk {
  ok: true
  userId: string
  username: string
  isAdmin: boolean
}

interface SessionCheckErr {
  ok: false
  status: number
  error: string
}

/**
 * Wspólna logika dla HTTP i WS: weryfikuje token, sprawdza że user istnieje
 * i że session_version w tokenie zgadza się z bazą.
 */
export async function verifySession(token: string): Promise<SessionCheckOk | SessionCheckErr> {
  const payload = await verifyToken(token)
  if (!payload) {
    return { ok: false, status: 401, error: 'Nieprawidłowy lub wygasły token' }
  }

  const sv = typeof payload.sv === 'number' ? payload.sv : null
  if (sv === null) {
    // Stary token sprzed wersjonowania sesji — odrzucamy.
    return { ok: false, status: 401, error: 'Token bez wersji sesji. Zaloguj się ponownie.' }
  }

  const info = getUserSessionInfo(payload.sub)
  if (!info) {
    return { ok: false, status: 401, error: 'Konto nie istnieje' }
  }

  if (info.sessionVersion !== sv) {
    return { ok: false, status: 401, error: 'Sesja wygasła. Zaloguj się ponownie.' }
  }

  return {
    ok: true,
    userId: payload.sub,
    username: payload.username,
    isAdmin: info.isAdmin,
  }
}

// --- Middleware ---

/** Wymaga nagłówka `Authorization: Bearer <token>`. */
export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('Authorization') ?? ''
  const token = header.replace(/^Bearer\s+/i, '').trim()

  if (!token) {
    return c.json({ error: 'Brak tokenu autoryzacji' }, 401)
  }

  const result = await verifySession(token)
  if (!result.ok) {
    return c.json({ error: result.error }, result.status as 401)
  }

  c.set('userId', result.userId)
  c.set('username', result.username)
  c.set('isAdmin', result.isAdmin)
  await next()
})

/** Wymaga, żeby zalogowany user był adminem. Zakłada że authMiddleware już przeszło. */
export const adminMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('isAdmin')) {
    return c.json({ error: 'Wymagane uprawnienia administratora' }, 403)
  }
  await next()
})

/**
 * Auth middleware dla endpointów proxy (/llm-proxy, /searxng-proxy, /images-proxy).
 *
 * Dlaczego osobny nagłówek:
 *   Proxy przekazuje żądania do zewnętrznych usług (LM Studio, SearXNG, mostek
 *   obrazów). Nagłówek `Authorization` jest tam używany do KLUCZA API tych usług
 *   — nie możemy go zająć na JWT sync. Dlatego JWT idzie w dedykowanym nagłówku
 *   `X-RP-Auth: Bearer <token>`, który proxy zużywa i nie forwarduje dalej.
 *
 * Dlaczego w ogóle:
 *   Bez tego proxy jest otwartym SSRF relay — każdy z dostępem do portu 8787
 *   może kazać serwerowi wysłać dowolny request pod dowolny adres.
 */
export const proxyAuthMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('X-RP-Auth') ?? ''
  const token = header.replace(/^Bearer\s+/i, '').trim()

  if (!token) {
    return c.json(
      {
        error:
          'Brak tokenu autoryzacji proxy (nagłówek X-RP-Auth). Zaloguj się ponownie.',
      },
      401,
    )
  }

  const result = await verifySession(token)
  if (!result.ok) {
    return c.json({ error: result.error }, result.status as 401)
  }

  c.set('userId', result.userId)
  c.set('username', result.username)
  c.set('isAdmin', result.isAdmin)
  await next()
})

