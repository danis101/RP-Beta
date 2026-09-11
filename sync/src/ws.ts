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
 *
 * Sesje: event `session.revoked` (bez id) mowi klientowi "twoj token jest
 * niewazny, wyloguj sie natychmiast". Wysylany gdy admin resetuje haslo
 * albo usuwa konto. Bez tego klient dowiedzialby sie dopiero przy nastepnym
 * requestcie HTTP (401) albo po F5 — z opoznieniem.
 */

import type { WSContext } from 'hono/ws'

export interface EntityChangedEvent {
  type: 'entity.changed'
  entityType: 'character' | 'persona' | 'conversation' | 'style' | 'lorebook' | 'settings'
  action: 'created' | 'updated' | 'deleted'
  id: string
}

export interface SessionRevokedEvent {
  type: 'session.revoked'
  reason?: string
}

export type ServerEvent = EntityChangedEvent | SessionRevokedEvent

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

function send(userId: string, payload: string): void {
  const set = connections.get(userId)
  if (!set || set.size === 0) return

  for (const ws of set) {
    try {
      ws.send(payload)
    } catch {
      // martwe polaczenie - zostanie sprzatniete przez onClose
    }
  }
}

export function broadcast(userId: string, event: EntityChangedEvent): void {
  send(userId, JSON.stringify(event))
}

/**
 * Zamyka wszystkie aktywne połączenia WS danego usera.
 * Wywoływane przy DELETE konta.
 */
export function closeAllForUser(userId: string): void {
  const set = connections.get(userId)
  if (!set) return

  for (const ws of set) {
    try {
      ws.close(4001, 'session ended')
    } catch {
      // kanał mógł już być zamknięty po drugiej stronie
    }
  }
  connections.delete(userId)
}

/**
 * Unieważnia sesje usera: wysyła event `session.revoked` przez WS
 * (klient natychmiast sie wylogowuje), potem po krótkiej chwili zamyka
 * połączenie. Opóźnienie daje przeglądarce czas na przetworzenie eventu
 * przed close.
 *
 * Uzywane gdy admin resetuje haslo albo usuwa konto.
 */
export function revokeUserSessions(userId: string, reason?: string): void {
  const event: SessionRevokedEvent = { type: 'session.revoked', reason }
  send(userId, JSON.stringify(event))

  // Krótkie opóźnienie — event zdąży dojść do klienta, potem close.
  // WebSocket frames są uporządkowane, więc even gdyby close nastąpił
  // od razu, klient i tak przetworzy event najpierw.
  setTimeout(() => {
    closeAllForUser(userId)
  }, 300)
}

/** Diagnostyka - ile aktywnych sesji na usera (do /health). */
export function connectionStats(): { users: number; connections: number } {
  let total = 0
  for (const set of connections.values()) total += set.size
  return { users: connections.size, connections: total }
}

