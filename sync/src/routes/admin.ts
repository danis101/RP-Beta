/**
 * Endpointy administracyjne (wymagają is_admin):
 *   GET    /admin/users                — lista kont
 *   POST   /admin/users                — utwórz konto (z seedem Asystent + Persona)
 *   DELETE /admin/users/:id            — usuń konto (twardo + ich encje + bloby)
 *   PATCH  /admin/users/:id/password   — zmień hasło innego usera
 *
 * Admin nie może usunąć samego siebie (żeby nie zostawić serwera bez admina).
 */

import { Hono } from 'hono'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { db, BLOBS_DIR } from '../db'
import {
  adminMiddleware,
  authMiddleware,
  hashPassword,
  validatePassword,
  validateUsername,
  type AppEnv,
} from '../auth'
import { seedUserContent } from '../seed'

interface UserRow {
  id: string
  username: string
  is_admin: number
  created_at: number
}

export const adminRoutes = new Hono<AppEnv>()

adminRoutes.use('*', authMiddleware, adminMiddleware)

adminRoutes.get('/users', (c) => {
  const rows = db
    .query('SELECT id, username, is_admin, created_at FROM users ORDER BY created_at ASC')
    .all() as UserRow[]

  return c.json({
    users: rows.map((r) => ({
      id: r.id,
      username: r.username,
      isAdmin: r.is_admin === 1,
      createdAt: r.created_at,
    })),
  })
})

adminRoutes.post('/users', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Nieprawidłowy JSON' }, 400)
  }

  const username = String((body as Record<string, unknown>).username ?? '').trim()
  const password = String((body as Record<string, unknown>).password ?? '')
  const isAdmin = (body as Record<string, unknown>).isAdmin === true

  const uErr = validateUsername(username)
  if (uErr) return c.json({ error: uErr }, 400)

  const pErr = validatePassword(password)
  if (pErr) return c.json({ error: pErr }, 400)

  const existing = db
    .query('SELECT id FROM users WHERE username = ?')
    .get(username) as { id: string } | null
  if (existing) {
    return c.json({ error: 'Ta nazwa użytkownika jest już zajęta' }, 409)
  }

  const id = crypto.randomUUID()
  const hash = await hashPassword(password)
  const now = Date.now()

  db.run(
    'INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, username, hash, isAdmin ? 1 : 0, now],
  )

  seedUserContent(id)

  return c.json({
    user: {
      id,
      username,
      isAdmin,
      createdAt: now,
    },
  })
})

adminRoutes.delete('/users/:id', async (c) => {
  const targetId = c.req.param('id')
  const selfId = c.get('userId')

  if (targetId === selfId) {
    return c.json({ error: 'Nie możesz usunąć własnego konta' }, 400)
  }

  const user = db
    .query('SELECT id, username FROM users WHERE id = ?')
    .get(targetId) as { id: string; username: string } | null
  if (!user) return c.json({ error: 'Konto nie istnieje' }, 404)

  // Twarde kasowanie: encje + bloby + konto.
  db.run('DELETE FROM entities WHERE user_id = ?', [targetId])
  db.run('DELETE FROM blobs WHERE user_id = ?', [targetId])
  db.run('DELETE FROM users WHERE id = ?', [targetId])

  // Katalog blobów tego usera — usuń rekurencyjnie (best effort).
  try {
    await rm(join(BLOBS_DIR, targetId), { recursive: true, force: true })
  } catch (err) {
    console.warn(`[admin] nie udało się usunąć katalogu blobów ${targetId}:`, err)
  }

  return c.json({ ok: true })
})

adminRoutes.patch('/users/:id/password', async (c) => {
  const targetId = c.req.param('id')
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Nieprawidłowy JSON' }, 400)
  }

  const newPassword = String((body as Record<string, unknown>).newPassword ?? '')
  const pErr = validatePassword(newPassword)
  if (pErr) return c.json({ error: pErr }, 400)

  const user = db
    .query('SELECT id FROM users WHERE id = ?')
    .get(targetId) as { id: string } | null
  if (!user) return c.json({ error: 'Konto nie istnieje' }, 404)

  const hash = await hashPassword(newPassword)
  db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, targetId])

  return c.json({ ok: true })
})
