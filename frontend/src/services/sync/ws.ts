/**
 * Klient WebSocket do serwera RP Sync.
 *
 * Serwer (backend) przy kazdej zmianie encji broadcastuje event do
 * wszystkich sesji danego usera:
 *   { type: 'entity.changed', entityType, action, id }
 *
 * Klient otwiera polaczenie po zalogowaniu, nasluchuje eventow i przekazuje
 * je do callbacku. Na rozlaczenie reconnectuje z exponential backoff
 * (1s, 2s, 4s, 8s, 16s, 30s max).
 *
 * Self-save filter:
 *   Gdy sam zapisujesz encje, serwer tez wysyla event do ciebie (broadcast
 *   do wszystkich sesji usera, w tym do tej ktora zapisala). Zeby nie robic
 *   zbednego refetcha po kazdym wlasnym zapisie, markSelfSave(id) zapisuje
 *   timestamp, a isRecentSelfSave(id) sprawdza czy to nie echo wlasnej
 *   zmiany z ostatnich 3 sekund.
 */

import { wsUrl } from './config'
import { getToken } from './client'

export type EntityType = 'character' | 'persona' | 'conversation' | 'style' | 'lorebook'
export type EntityAction = 'created' | 'updated' | 'deleted'

export interface SyncEvent {
  type: 'entity.changed'
  entityType: EntityType
  action: EntityAction
  id: string
}

// --- Self-save tracking ---

const SELF_SAVE_TTL_MS = 3000
const selfSaves = new Map<string, number>()

/**
 * Zaznacza ze wlasnie zapisalismy encje o danym id. Wywolywane z entities.ts
 * po sukcesie PUT. Filtr TTL 3s.
 */
export function markSelfSave(id: string): void {
  selfSaves.set(id, Date.now())
  // Okazjonalny cleanup - nie pozwalamy mapie rosnac w nieskonczonosc.
  if (selfSaves.size > 200) {
    const now = Date.now()
    for (const [k, t] of selfSaves) {
      if (now - t > SELF_SAVE_TTL_MS) selfSaves.delete(k)
    }
  }
}

/**
 * Sprawdza czy event dotyczy swiezego wlasnego zapisu (echo). Jesli tak,
 * warstwa wyzej powinna go zignorowac - nie ma sensu refetchowac tego
 * co wlasnie sami zapisalismy.
 */
export function isRecentSelfSave(id: string): boolean {
  const t = selfSaves.get(id)
  if (!t) return false
  if (Date.now() - t > SELF_SAVE_TTL_MS) {
    selfSaves.delete(id)
    return false
  }
  return true
}

// --- WebSocket connection ---

interface HelloMessage {
  type: 'hello'
}

function isSyncEvent(data: unknown): data is SyncEvent {
  if (!data || typeof data !== 'object') return false
  const obj = data as Record<string, unknown>
  return (
    obj.type === 'entity.changed' &&
    typeof obj.entityType === 'string' &&
    typeof obj.action === 'string' &&
    typeof obj.id === 'string'
  )
}

/**
 * Otwiera polaczenie WebSocket do serwera sync. Zwraca funkcje zatrzymujaca
 * (cleanup), ktora zamyka polaczenie i wylacza reconnect.
 *
 * Reconnect dziala dopoki cleanup nie zostanie wywolany albo user sie nie
 * wyloguje (brak tokenu => retry co 1s az token sie pojawi).
 */
export function connectSyncWs(onEvent: (event: SyncEvent) => void): () => void {
  let ws: WebSocket | null = null
  let closed = false
  let attempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  const scheduleReconnect = (): void => {
    if (closed) return
    attempt++
    // 1s, 2s, 4s, 8s, 16s, 30s, 30s...
    const delay = Math.min(30_000, 1000 * Math.pow(2, Math.min(attempt - 1, 5)))
    reconnectTimer = setTimeout(open, delay)
  }

  const open = (): void => {
    if (closed) return

    const token = getToken()
    if (!token) {
      // Brak tokenu - user prawdopodobnie wylogowany. Sprobuj za chwile.
      reconnectTimer = setTimeout(open, 1000)
      return
    }

    try {
      ws = new WebSocket(wsUrl(token))
    } catch {
      scheduleReconnect()
      return
    }

    ws.onopen = () => {
      attempt = 0
    }

    ws.onmessage = (ev: MessageEvent) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(ev.data as string)
      } catch {
        return
      }

      // Serwer wysyla powitalny { type: 'hello' } - ignorujemy.
      if (parsed && typeof parsed === 'object' && (parsed as HelloMessage).type === 'hello') {
        return
      }

      if (isSyncEvent(parsed)) {
        try {
          onEvent(parsed)
        } catch (err) {
          console.warn('[ws] blad handlera eventu:', err)
        }
      }
    }

    ws.onclose = () => {
      ws = null
      if (closed) return
      scheduleReconnect()
    }

    ws.onerror = () => {
      // onclose odpali sie zaraz po tym i tak - nie duplikujemy logiki.
    }
  }

  open()

  return () => {
    closed = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (ws) {
      try {
        ws.close()
      } catch {
        /* ignore */
      }
      ws = null
    }
  }
}
