/**
 * Generyczne endpointy CRUD dla encji (characters, personas, conversations,
 * styles, lorebooks).
 *
 * Wszystkie encje maja identyczna sygnature: id, user_id, name, blob_id,
 * data_json, timestampy. Roznice miedzy typami sa w zawartosci data_json.
 * Dzieki temu jedna fabryka obsluguje wszystkie piec typow.
 *
 * Operacje:
 *   GET    /       lista encji danego typu
 *   GET    /:id    pojedyncza encja
 *   PUT    /:id    upsert z optimistic locking
 *   DELETE /:id    soft delete
 *
 * Optimistic locking:
 *   Klient przy PUT moze podac pole `expectedUpdatedAt` (timestamp z
 *   ostatniego odczytu). Jesli rozni sie od aktualnego `updated_at` w bazie,
 *   ktos inny zmodyfikowal encje w miedzyczasie - zwracamy 409 Conflict
 *   z aktualna wersja encji w polu `current`, zeby klient mogl ja przyjac
 *   bez dodatkowego GET-a.
 *
 *   Brak `expectedUpdatedAt` = brak sprawdzania (kompatybilnosc wstecz).
 *   Encja nowa (nie istnieje w bazie) = brak sprawdzania (nie ma z czym
 *   porownywac). Zwracane encje zawsze maja pole `updatedAt` (server-assigned).
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

/** Dokleja server-assigned metadane do encji zwracanej klientowi. */
function withServerMeta(row: EntityRow): Record<string, unknown> {
  const data = JSON.parse(row.data_json) as Record<string, unknown>
  return {
    ...data,
    _serverCreatedAt: row.created_at,
    _serverUpdatedAt: row.updated_at,
  }
}

/**
 * @param entityType  wartosc kolumny `type` w tabeli entities
 * @param blobField   nazwa pola w body, ktore wskazuje na blob (np. portraitBlobId)
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

    return c.json({ items: rows.map(withServerMeta) })
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
    return c.json(withServerMeta(row))
  })

  // --- UPSERT z optimistic locking ---
  app.put('/:id', async (c) => {
    const userId = c.get('userId')
    const id = c.req.param('id')
    const body = await c.req.json().catch(() => null)

    if (!body || typeof body !== 'object') {
      return c.json({ error: 'Nieprawidlowy JSON w body' }, 400)
    }

    const obj = body as Record<string, unknown>
    const name = typeof obj.name === 'string' ? obj.name : null
    const blobId = blobField && typeof obj[blobField] === 'string'
      ? (obj[blobField] as string)
      : null

    // Wyciagamy pole kontrolne z body, zeby nie trafilo do data_json.
    const expectedUpdatedAt =
      typeof obj._expectedUpdatedAt === 'number' ? (obj._expectedUpdatedAt as number) : undefined
    const { _expectedUpdatedAt: _ignored, _serverCreatedAt: _ignored2, _serverUpdatedAt: _ignored3, ...cleanObj } = obj

    const now = Date.now()
    const dataJson = JSON.stringify({ ...cleanObj, id })

    const existing = db
      .query(
        `SELECT created_at, updated_at FROM entities
         WHERE user_id = ? AND type = ? AND id = ?`,
      )
      .get(userId, entityType, id) as { created_at: number; updated_at: number } | null

    // Optimistic locking: sprawdzamy tylko gdy encja istnieje i klient podal
    // oczekiwana wersje. Brak expectedUpdatedAt = brak sprawdzania.
    if (existing && expectedUpdatedAt !== undefined && existing.updated_at !== expectedUpdatedAt) {
      // Ktos zmodyfikowal encje w miedzyczasie. Zwracamy aktualna wersje
      // z bazy + flage _conflict, zeby klient wiedzial ze to konflikt.
      const currentRow = db
        .query(
          `SELECT * FROM entities
           WHERE user_id = ? AND type = ? AND id = ? AND deleted_at IS NULL`,
        )
        .get(userId, entityType, id) as EntityRow | null

      return c.json(
        {
          error: 'Konflikt: encja zostala zmieniona na innym urzadzeniu',
          conflict: true,
          current: currentRow ? withServerMeta(currentRow) : null,
        },
        409,
      )
    }

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

    return c.json({
      ...cleanObj,
      id,
      _serverCreatedAt: existing?.created_at ?? now,
      _serverUpdatedAt: now,
    })
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
