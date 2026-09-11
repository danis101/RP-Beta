/**
 * Uwierzytelnianie: hashowanie haseł, JWT, middleware, walidacja.
 *
 * Hashowanie: Bun.password (argon2id).
 * Token: JWT HS256, 30 dni ważności.
 *
 * Uwaga o Hono >= 4.6: `verify` wymaga jawnego `alg` w opcjach.
 * Bez tego rzuca JwtAlgorithmRequired. Ustawiamy 'HS256' w JWT_ALG.
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

export async function createToken(userId: string, username: string): Promise<string> {
  const payload: JwtPayload = {
    sub: userId,
    username,
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

/** Sprawdza, czy user o danym id ma uprawnienia admina (świeży odczyt z bazy). */
export function isUserAdmin(userId: string): boolean {
  const row = db
    .query('SELECT is_admin FROM users WHERE id = ?')
    .get(userId) as { is_admin: number } | null
  return row?.is_admin === 1
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

// --- Middleware ---

/** Wymaga nagłówka `Authorization: Bearer <token>`. */
export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('Authorization') ?? ''
  const token = header.replace(/^Bearer\s+/i, '').trim()

  if (!token) {
    return c.json({ error: 'Brak tokenu autoryzacji' }, 401)
  }

  const payload = await verifyToken(token)
  if (!payload) {
    return c.json({ error: 'Nieprawidłowy lub wygasły token' }, 401)
  }

  c.set('userId', payload.sub)
  c.set('username', payload.username)
  c.set('isAdmin', isUserAdmin(payload.sub))
  await next()
})

/** Wymaga, żeby zalogowany user był adminem. Zakłada że authMiddleware już przeszło. */
export const adminMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('isAdmin')) {
    return c.json({ error: 'Wymagane uprawnienia administratora' }, 403)
  }
  await next()
})
