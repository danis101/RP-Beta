/**
 * Hub WebSocket — broadcast zdarzeń o zmianach encji do wszystkich sesji
 * danego użytkownika.
 *
 * Zdarzenia nie niosą treści encji — tylko sygnał "coś się zmieniło".
 * Klient na tej podstawie refetchuje. Dzięki temu payload jest mały,
 * a klient sam decyduje co chce trzymać w pamięci.
 *
 * Bloby nie są broadcastowane — są immutable i content-addressed,
 * klient dowiaduje się o nich dopiero gdy zobaczy blobId w encji.
 */

import type { WSContext } from 'hono/ws'

export interface EntityChangedEvent {
  type: 'entity.changed'
  entityType: 'character' | 'persona' | 'conversation' | 'style' | 'lorebook'
  action: 'created' | 'updated' | 'deleted'
  id: string
}

const connections = new Map<string, Set<WSContext>>()

export function register(userId: string, ws: WSContext): void {
  let set = connections.get(userId)
  if (!set) {
    set = new Set()
    connections.set(userId, set)
  }
  set.add(ws)
}

export function unregister(userId: string, ws: WSContext): void {
  const set = connections.get(userId)
  if (!set) return
  set.delete(ws)
  if (set.size === 0) connections.delete(userId)
}

export function broadcast(userId: string, event: EntityChangedEvent): void {
  const set = connections.get(userId)
  if (!set || set.size === 0) return

  const payload = JSON.stringify(event)
  for (const ws of set) {
    try {
      ws.send(payload)
    } catch {
      // martwe połączenie — zostanie sprzątnięte przez onClose
    }
  }
}

/** Diagnostyka — ile aktywnych sesji na usera (do /health). */
export function connectionStats(): { users: number; connections: number } {
  let total = 0
  for (const set of connections.values()) total += set.size
  return { users: connections.size, connections: total }
}
