/**
 * Generyczne endpointy CRUD dla encji (characters, personas, conversations,
 * styles, lorebooks).
 *
 * Wszystkie encje mają identyczną sygnaturę: id, user_id, name, blob_id,
 * data_json, timestampy. Różnice między typami są w zawartości data_json.
 * Dzięki temu jedna fabryka obsługuje wszystkie pięć typów.
 *
 * Operacje:
 *   GET    /       lista encji danego typu
 *   GET    /:id    pojedyncza encja
 *   PUT    /:id    upsert (id z URL, treść z body)
 *   DELETE /:id    soft delete
 *
 * Blob (portret / avatar) trzymamy w kolumnie `blob_id` jako denormalizację,
 * a pełny obiekt (włącznie z referencją do bloba) w `data_json`.
 */

import { Hono } from 'hono'
import { db } from '../db'
import { authMiddleware, type AppEnv } from '../auth'
import { broadcast, type EntityChangedEvent } from '../ws'

interface EntityRow {
  user_id: string
  type: string
  id: string
  name: string | null
  blob_id: string | null
  data_json: string
  created_at: number
  updated_at: number
  deleted_at: number | null
}

/**
 * @param entityType  wartość kolumny `type` w tabeli entities
 * @param blobField   nazwa pola w body, które wskazuje na blob (np. portraitBlobId)
 */
export function createEntityRoutes(
  entityType: EntityChangedEvent['entityType'],
  blobField?: string,
) {
  const app = new Hono<AppEnv>()

  app.use('*', authMiddleware)

  // --- LISTA ---
  app.get('/', (c) => {
    const userId = c.get('userId')
    const rows = db
      .query(
        `SELECT * FROM entities
         WHERE user_id = ? AND type = ? AND deleted_at IS NULL
         ORDER BY updated_at DESC`,
      )
      .all(userId, entityType) as EntityRow[]

    return c.json({ items: rows.map((r) => JSON.parse(r.data_json)) })
  })

  // --- POJEDYNCZA ---
  app.get('/:id', (c) => {
    const userId = c.get('userId')
    const id = c.req.param('id')
    const row = db
      .query(
        `SELECT * FROM entities
         WHERE user_id = ? AND type = ? AND id = ? AND deleted_at IS NULL`,
      )
      .get(userId, entityType, id) as EntityRow | null

    if (!row) return c.json({ error: 'Nie znaleziono' }, 404)
    return c.json(JSON.parse(row.data_json))
  })

  // --- UPSERT ---
  app.put('/:id', async (c) => {
    const userId = c.get('userId')
    const id = c.req.param('id')
    const body = await c.req.json().catch(() => null)

    if (!body || typeof body !== 'object') {
      return c.json({ error: 'Nieprawidłowy JSON w body' }, 400)
    }

    const obj = body as Record<string, unknown>
    const name = typeof obj.name === 'string' ? obj.name : null
    const blobId = blobField && typeof obj[blobField] === 'string'
      ? (obj[blobField] as string)
      : null
    const dataJson = JSON.stringify({ ...obj, id })
    const now = Date.now()

    const existing = db
      .query(
        `SELECT created_at FROM entities
         WHERE user_id = ? AND type = ? AND id = ?`,
      )
      .get(userId, entityType, id) as { created_at: number } | null

    if (existing) {
      db.run(
        `UPDATE entities
         SET name = ?, blob_id = ?, data_json = ?, updated_at = ?, deleted_at = NULL
         WHERE user_id = ? AND type = ? AND id = ?`,
        [name, blobId, dataJson, now, userId, entityType, id],
      )
    } else {
      db.run(
        `INSERT INTO entities
          (user_id, type, id, name, blob_id, data_json, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [userId, entityType, id, name, blobId, dataJson, now, now],
      )
    }

    broadcast(userId, {
      type: 'entity.changed',
      entityType,
      action: existing ? 'updated' : 'created',
      id,
    })

    return c.json({ ...obj, id, createdAt: existing?.created_at ?? now, updatedAt: now })
  })

  // --- SOFT DELETE ---
  app.delete('/:id', (c) => {
    const userId = c.get('userId')
    const id = c.req.param('id')
    const now = Date.now()

    const result = db.run(
      `UPDATE entities
       SET deleted_at = ?, updated_at = ?
       WHERE user_id = ? AND type = ? AND id = ? AND deleted_at IS NULL`,
      [now, now, userId, entityType, id],
    )

    if (result.changes === 0) {
      return c.json({ error: 'Nie znaleziono' }, 404)
    }

    broadcast(userId, {
      type: 'entity.changed',
      entityType,
      action: 'deleted',
      id,
    })

    return c.json({ ok: true })
  })

  return app
}
