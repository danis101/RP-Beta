/**
 * Garbage collector dla blobów i soft-deleted encji.
 *
 * Dwa przebiegi:
 *   1) Hard delete encji z `deleted_at` starszym niż SOFT_DELETE_RETENTION_MS (7 dni).
 *      Fizycznie usuwa wiersze z `entities`.
 *   2) Znajduje i usuwa sierotne bloby.
 *      Referencje do blobów mogą być w:
 *        - kolumnie `blob_id` (portrety postaci, awatary person)
 *        - treści `data_json` encji (np. message.toolCall.imageBlobId,
 *          message.variants[].attachments[].blobId) — wykrywane regexem sha256
 *      Wszystkie żywe encje (deleted_at IS NULL) są skanowane. Zbiór
 *      referowanych sha256 porównujemy z tabelą `blobs`; różnica = sieroty.
 *
 * Wywoływany raz na GC_INTERVAL_MS (24h) oraz raz przy starcie (nadrabia
 * zaległości po downtime). Nigdy nie usuwa blobów używanych przez żywe encje.
 *
 * Uwaga: GC skanuje data_json regexem /[a-f0-9]{64}/g — sha256 hex.
 * To znaczy że każdy 64-znakowy hex w JSON zostanie potraktowany jako
 * potencjalne ID bloba. W obecnym modelu danych to bezpieczne założenie;
 * gdyby w przyszłości do data_json trafiały inne hashe, trzeba to zawęzić.
 */

import { db } from './db'
import { deleteBlob } from './blobs'
import { GC_INTERVAL_MS, SOFT_DELETE_RETENTION_MS } from './config'

const SHA256_RE = /[a-f0-9]{64}/g

export interface GcResult {
  purgedEntities: number
  orphanedBlobs: number
  deletedBlobs: number
  elapsedMs: number
}

/** Zbiera wszystkie sha256 referowane przez żywe encje. */
function collectReferencedBlobs(): Set<string> {
  const refs = new Set<string>()

  const rows = db
    .query(
      `SELECT user_id, blob_id, data_json FROM entities WHERE deleted_at IS NULL`,
    )
    .all() as Array<{ user_id: string; blob_id: string | null; data_json: string }>

  for (const row of rows) {
    if (row.blob_id) refs.add(row.blob_id)
    const matches = row.data_json.match(SHA256_RE)
    if (matches) {
      for (const m of matches) refs.add(m)
    }
  }

  return refs
}

/** Główny przebieg GC. Wywoływany ręcznie lub z crona. */
export function runGarbageCollection(): GcResult {
  const start = Date.now()
  const now = Date.now()
  const cutoff = now - SOFT_DELETE_RETENTION_MS

  // 1. Hard delete starych soft-deleted encji.
  const purgeResult = db.run(
    `DELETE FROM entities WHERE deleted_at IS NOT NULL AND deleted_at < ?`,
    [cutoff],
  )
  const purgedEntities = purgeResult.changes

  // 2. Znajdź sierotne bloby.
  const referenced = collectReferencedBlobs()

  const allBlobs = db
    .query('SELECT user_id, sha256 FROM blobs')
    .all() as Array<{ user_id: string; sha256: string }>

  const orphans = allBlobs.filter((b) => !referenced.has(b.sha256))
  let deletedBlobs = 0

  for (const blob of orphans) {
    try {
      // deleteBlob jest async, ale chcemy synchroniczny GC — używamy void + catch
      // na wypadek błędu systemu plików.
      void deleteBlob(blob.user_id, blob.sha256).catch((err) => {
        console.warn(`[gc] błąd kasowania bloba ${blob.sha256}:`, err)
      })
      deletedBlobs++
    } catch (err) {
      console.warn(`[gc] wyjątek przy kasowaniu bloba ${blob.sha256}:`, err)
    }
  }

  const result: GcResult = {
    purgedEntities,
    orphanedBlobs: orphans.length,
    deletedBlobs,
    elapsedMs: Date.now() - start,
  }

  console.log(
    `[gc] usunięto ${purgedEntities} encji, znaleziono ${orphans.length} sierot (${deletedBlobs} skasowanych) w ${result.elapsedMs} ms`,
  )

  return result
}

/** Startuje pętlę GC: natychmiast + co GC_INTERVAL_MS. */
export function startGcLoop(): void {
  // Pierwszy przebieg z krótkim opóźnieniem, żeby nie blokować startu serwera.
  setTimeout(() => {
    try {
      runGarbageCollection()
    } catch (err) {
      console.error('[gc] błąd pierwszego przebiegu:', err)
    }
  }, 5000)

  setInterval(() => {
    try {
      runGarbageCollection()
    } catch (err) {
      console.error('[gc] błąd przebiegu okresowego:', err)
    }
  }, GC_INTERVAL_MS)
}
