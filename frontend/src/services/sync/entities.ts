/**
 * API klienta dla encji (karty, persony, konwersacje, style, lorebooki).
 *
 * Wszystkie encje maja identyczny shape po stronie serwera, wiec jedna
 * fabryka obsluguje wszystkie piec typow.
 *
 * Optimistic locking: patrz client.ts (ConflictError).
 *
 * Self-save tracking: po kazdym udanym zapisie wywolujemy markSelfSave(id),
 * zeby WebSocket listener mogl odfiltrowac echo wlasnej zmiany i nie robil
 * zbednego refetcha.
 */

import { request, ConflictError } from './client'
import { markSelfSave } from './ws'

interface ListResponse<T> {
  items: T[]
}

export interface EntityApi<T extends { id: string }> {
  list(): Promise<T[]>
  get(id: string): Promise<T>
  update(entity: T): Promise<T>
  remove(id: string): Promise<void>
}

function withExpectedVersion<T extends { id: string }>(entity: T): Record<string, unknown> {
  const rec = entity as unknown as Record<string, unknown>
  const serverUpdatedAt = rec._serverUpdatedAt
  const body: Record<string, unknown> = { ...rec }
  if (typeof serverUpdatedAt === 'number') {
    body._expectedUpdatedAt = serverUpdatedAt
  }
  return body
}

function refineConflict<T>(err: unknown): never {
  if (err instanceof ConflictError) {
    throw new ConflictError<T>(err.current as T | null)
  }
  throw err
}

export function createEntityApi<T extends { id: string }>(path: string): EntityApi<T> {
  return {
    async list() {
      const resp = await request<ListResponse<T>>(path)
      return resp.items
    },
    async get(id) {
      return request<T>(`${path}/${encodeURIComponent(id)}`)
    },
    async update(entity) {
      try {
        const saved = await request<T>(`${path}/${encodeURIComponent(entity.id)}`, {
          method: 'PUT',
          body: withExpectedVersion(entity),
        })
        // Znacz ze to nasz wlasny zapis - WebSocket listener odfiltruje echo.
        markSelfSave(saved.id)
        return saved
      } catch (err) {
        refineConflict<T>(err)
      }
    },
    async remove(id) {
      await request<void>(`${path}/${encodeURIComponent(id)}`, { method: 'DELETE' })
      markSelfSave(id)
    },
  }
}
