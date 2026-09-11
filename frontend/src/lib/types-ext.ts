/**
 * Pomocnicze typy dla server-assigned metadanych doklejanych do encji.
 * Backend zwraca je razem z encja (prefix `_server`), dzieki czemu klient
 * zna aktualna wersje encji do optimistic lockingu.
 */

export interface WithServerMeta {
  /** Timestamp utworzenia encji po stronie serwera. */
  _serverCreatedAt?: number
  /** Timestamp ostatniej modyfikacji po stronie serwera. */
  _serverUpdatedAt?: number
}

/** Pomocnik: zwraca `_serverUpdatedAt` lub undefined. */
export function getServerUpdatedAt(entity: { _serverUpdatedAt?: number }): number | undefined {
  return entity._serverUpdatedAt
}
