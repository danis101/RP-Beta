/** Wspolne typy dla warstwy sync. */

export interface SyncUser {
  id: string
  username: string
  isAdmin: boolean
}

export interface LoginResponse {
  token: string
  user: SyncUser
}

/**
 * Payload 409 Conflict z backendu.
 * `current` to swieza wersja encji z serwera (moze byc null jesli zostala
 * usunieta w miedzyczasie).
 */
export interface ConflictPayload<T> {
  error: string
  conflict: true
  current: T | null
}
