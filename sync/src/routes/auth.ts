/**
 * Endpointy auth: POST /login, GET /me, POST /change-password.
 *
 * Rejestracja publiczna jest WYŁĄCZONA — konta tworzy admin przez /admin/users.
 * Pierwsze konto admina seeduje się z env przy starcie.
 *
 * Login ma rate limit (LOGIN_RATE_LIMIT / LOGIN_RATE_WINDOW_MS per IP).
 */

import { Hono } from 'hono'
import { db } from '../db'
import {
  authMiddleware,
  createToken,
  hashPassword,
  validatePassword,
  verifyPassword,
  type AppEnv,
} from '../auth'
import { LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_MS } from '../config'
import { checkRateLimit, retryAfterSeconds } from '../ratelimit'

interface UserRow {
  id: string
  username: string
  password_hash: string
  is_admin: number
  created_at: number
}

export const authRoutes = new Hono<AppEnv>()

/** Wyciąga IP klienta (uwzględnia X-Forwarded-For gdy za reverse proxy). */
function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  const xff = c.req.header('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const real = c.req.header('x-real-ip')
  if (real) return real
  return 'unknown'
}

authRoutes.post('/login', async (c) => {
  const ip = clientIp(c)
  const key = `login:${ip}`

  if (!checkRateLimit(key, LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_MS)) {
    const retry = retryAfterSeconds(key)
    c.header('Retry-After', String(retry))
    return c.json({ error: `Zbyt wiele prób logowania. Spróbuj ponownie za ${retry}s.` }, 429)
  }

  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Nieprawidłowy JSON' }, 400)
  }

  const username = String((body as Record<string, unknown>).username ?? '').trim()
  const password = String((body as Record<string, unknown>).password ?? '')

  if (!username || !password) {
    return c.json({ error: 'Podaj nazwę użytkownika i hasło' }, 400)
  }

  const user = db
    .query('SELECT * FROM users WHERE username = ?')
    .get(username) as UserRow | null

  if (!user) {
    // Nie ujawniamy czy username istnieje.
    return c.json({ error: 'Nieprawidłowe dane logowania' }, 401)
  }

  const ok = await verifyPassword(password, user.password_hash)
  if (!ok) {
    return c.json({ error: 'Nieprawidłowe dane logowania' }, 401)
  }

  const token = await createToken(user.id, user.username)
  return c.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      isAdmin: user.is_admin === 1,
    },
  })
})

authRoutes.get('/me', authMiddleware, (c) => {
  return c.json({
    id: c.get('userId'),
    username: c.get('username'),
    isAdmin: c.get('isAdmin'),
  })
})

/** Zmiana własnego hasła. Wymaga podania starego hasła. */
authRoutes.post('/change-password', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Nieprawidłowy JSON' }, 400)
  }

  const currentPassword = String((body as Record<string, unknown>).currentPassword ?? '')
  const newPassword = String((body as Record<string, unknown>).newPassword ?? '')

  if (!currentPassword || !newPassword) {
    return c.json({ error: 'Podaj aktualne i nowe hasło' }, 400)
  }

  const pErr = validatePassword(newPassword)
  if (pErr) return c.json({ error: pErr }, 400)

  const user = db
    .query('SELECT * FROM users WHERE id = ?')
    .get(userId) as UserRow | null
  if (!user) return c.json({ error: 'Konto nie istnieje' }, 404)

  const ok = await verifyPassword(currentPassword, user.password_hash)
  if (!ok) return c.json({ error: 'Aktualne hasło jest nieprawidłowe' }, 401)

  const hash = await hashPassword(newPassword)
  db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, userId])

  return c.json({ ok: true })
})
