/**
 * Endpointy ustawien aplikacji (singleton per user).
 *
 *   GET  /settings  -> zwraca obiekt settings albo null (jesli user nic
 *                      jeszcze nie zapisal - klient uzyje defaults)
 *   PUT  /settings  -> upsert (bez optimistic lockingu - LWW wystarczy)
 *
 * Settings trzymamy w tabeli `entities` pod type='settings' i id='singleton'.
 * Wykorzystujemy ta sama tabele co encje, dzieki czemu broadcast WebSocket
 * dziala identycznie (entity.changed z entityType='settings').
 *
 * Brak optimistic lockingu: uzytkownik rzadko edytuje ustawienia na dwoch
 * urzadzeniach jednoczesnie. Jak bedzie problem, dorobimy (wzorzec juz mamy
 * w entities.ts).
 */

import { Hono } from 'hono'
import { db } from '../db'
import { authMiddleware, type AppEnv } from '../auth'
import { broadcast } from '../ws'

const SETTINGS_ID = 'singleton'

export const settingsRoutes = new Hono<AppEnv>()

settingsRoutes.use('*', authMiddleware)

settingsRoutes.get('/', (c) => {
  const userId = c.get('userId')
  const row = db
    .query(
      `SELECT data_json, updated_at FROM entities
       WHERE user_id = ? AND type = 'settings' AND id = ? AND deleted_at IS NULL`,
    )
    .get(userId, SETTINGS_ID) as { data_json: string; updated_at: number } | null

  if (!row) {
    return c.json({ settings: null, updatedAt: null })
  }

  return c.json({
    settings: JSON.parse(row.data_json),
    updatedAt: row.updated_at,
  })
})

settingsRoutes.put('/', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json().catch(() => null)

  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Nieprawidlowy JSON w body' }, 400)
  }

  const now = Date.now()
  const dataJson = JSON.stringify(body)

  const existing = db
    .query(
      `SELECT created_at FROM entities
       WHERE user_id = ? AND type = 'settings' AND id = ?`,
    )
    .get(userId, SETTINGS_ID) as { created_at: number } | null

  if (existing) {
    db.run(
      `UPDATE entities
       SET data_json = ?, updated_at = ?, deleted_at = NULL
       WHERE user_id = ? AND type = 'settings' AND id = ?`,
      [dataJson, now, userId, SETTINGS_ID],
    )
  } else {
    db.run(
      `INSERT INTO entities
        (user_id, type, id, name, blob_id, data_json, created_at, updated_at, deleted_at)
       VALUES (?, 'settings', ?, NULL, NULL, ?, ?, ?, NULL)`,
      [userId, SETTINGS_ID, dataJson, now, now],
    )
  }

  broadcast(userId, {
    type: 'entity.changed',
    entityType: 'settings',
    action: existing ? 'updated' : 'created',
    id: SETTINGS_ID,
  })

  return c.json({ ok: true, updatedAt: now })
})
