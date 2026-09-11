/**
 * API klienta dla encji (karty, persony, konwersacje, style, lorebooki).
 *
 * Wszystkie encje maja identyczny shape po stronie serwera, wiec jedna
 * fabryka obsluguje wszystkie piec typow. Zwracaja pojedyncze obiekty
 * lub `{ items: T[] }` (lista).
 *
 * Optimistic locking:
 *   Backend doklejaja do kazdej encji pole `_serverUpdatedAt` (server-assigned
 *   timestamp). Klient trzyma je w encji i wysyla z powrotem jako
 *   `_expectedUpdatedAt` przy PUT. Jesli na serwerze `updated_at` sie rozni,
 *   backend zwraca 409 z aktualna wersja - client.ts rzuca ConflictError<T>
 *   z `current`. Warstwa wyzej (App.tsx) decyduje co z tym zrobic.
 */

import { request, ConflictError } from './client'

interface ListResponse<T> {
  items: T[]
}

export interface EntityApi<T extends { id: string }> {
  list(): Promise<T[]>
  get(id: string): Promise<T>
  update(entity: T): Promise<T>
  remove(id: string): Promise<void>
}

/**
 * Dokleja pole `_expectedUpdatedAt` do body na podstawie `_serverUpdatedAt`
 * obecnego w encji. Backend tego oczekuje do optimistic lockingu.
 */
function withExpectedVersion<T extends { id: string }>(entity: T): Record<string, unknown> {
  const rec = entity as unknown as Record<string, unknown>
  const serverUpdatedAt = rec._serverUpdatedAt
  const body: Record<string, unknown> = { ...rec }
  if (typeof serverUpdatedAt === 'number') {
    body._expectedUpdatedAt = serverUpdatedAt
  }
  return body
}

/**
 * Rzutuje ogolny ConflictError<unknown> z client.ts na ConflictError<T>
 * z typowana encja. Bez tego App.tsx musialby rzutowac recznie.
 */
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
        return await request<T>(`${path}/${encodeURIComponent(entity.id)}`, {
          method: 'PUT',
          body: withExpectedVersion(entity),
        })
      } catch (err) {
        // 409 Conflict - ktos zmodyfikowal encje na innym urzadzeniu.
        // Rzucamy ConflictError<T> z typowana aktualna wersja, zeby warstwa
        // wyzej mogla ja przyjac bez rzutowania.
        refineConflict<T>(err)
      }
    },
    async remove(id) {
      await request<void>(`${path}/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },
  }
}
