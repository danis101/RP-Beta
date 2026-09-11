/**
 * Hub WebSocket - broadcast zdarzen o zmianach encji do wszystkich sesji
 * danego uzytkownika.
 *
 * Zdarzenia nie niosa tresci encji - tylko sygnal "cos sie zmienilo".
 * Klient na tej podstawie refetchuje. Dzieki temu payload jest maly,
 * a klient sam decyduje co chce trzymac w pamieci.
 *
 * Bloby nie sa broadcastowane - sa immutable i content-addressed,
 * klient dowiaduje sie o nich dopiero gdy zobaczy blobId w encji.
 *
 * entityType 'settings' to singleton ustawien aplikacji (patrz routes/settings.ts).
 */

import type { WSContext } from 'hono/ws'

export interface EntityChangedEvent {
  type: 'entity.changed'
  entityType: 'character' | 'persona' | 'conversation' | 'style' | 'lorebook' | 'settings'
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
      // martwe polaczenie - zostanie sprzatniete przez onClose
    }
  }
}

/** Diagnostyka - ile aktywnych sesji na usera (do /health). */
export function connectionStats(): { users: number; connections: number } {
  let total = 0
  for (const set of connections.values()) total += set.size
  return { users: connections.size, connections: total }
}
