/**
 * API klienta dla encji (karty, persony, konwersacje, style, lorebooki).
 *
 * Wszystkie encje mają identyczny shape po stronie serwera, więc jedna
 * fabryka obsługuje wszystkie pięć typów. Zwracają one pojedyncze obiekty
 * lub `{ items: T[] }` (lista).
 */

import { request } from './client'

interface ListResponse<T> {
  items: T[]
}

export interface EntityApi<T extends { id: string }> {
  list(): Promise<T[]>
  get(id: string): Promise<T>
  update(entity: T): Promise<T>
  remove(id: string): Promise<void>
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
      return request<T>(`${path}/${encodeURIComponent(entity.id)}`, {
        method: 'PUT',
        body: entity,
      })
    },
    async remove(id) {
      await request<void>(`${path}/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },
  }
}
