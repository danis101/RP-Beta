/**
 * Garbage collector dla zakończonych zadań, blobów i soft-deleted encji.
 *
 * Najpierw usuwa stare zadania (udane: 24h, pozostałe zakończone: 7 dni),
 * bez dotykania aktywnych zadań i wyników zapisanych w rozmowach.
 * Następnie dwa przebiegi:
 *   1) Hard delete encji z `deleted_at` starszym niż SOFT_DELETE_RETENTION_MS (7 dni).
 *      Fizycznie usuwa wiersze z `entities`.
 *
 *   2) Znajduje i usuwa sierotne bloby. Referencje do blobów mogą być w:
 *        - kolumnie `blob_id` (portrety postaci, awatary person)
 *        - treści `data_json` encji (np. message.toolCall.imageBlobId,
 *          message.variants[].attachments[].blobId) — wykrywane regexem sha256
 *
 *   Referencje zbieramy PER-USER — blob jest per (user_id, sha256), więc
 *   referencja innego usera nie powinna chronić mojego sierotę (i vice versa).
 *
 *   Okres ochronny (MIN_BLOB_AGE_MS, domyślnie 1h): bloby młodsze niż próg
 *   NIE są usuwane nawet jeśli nie mają referencji — chroni to świeże uploady
 *   czekające na zapis karty/wiadomości (upload ≠ referencja).
 *
 * Wywoływany raz na GC_INTERVAL_MS (24h) oraz raz przy starcie (nadrabia
 * zaległości po downtime).
 */

import { db } from './db'
import { deleteBlob } from './blobs'
import { purgeGenerationJobs } from './generation/retention'
import { GC_INTERVAL_MS, MIN_BLOB_AGE_MS, SOFT_DELETE_RETENTION_MS } from './config'

const SHA256_RE = /[a-f0-9]{64}/g

export interface GcResult {
  purgedJobs: number
  purgedEntities: number
  /** Wszystkie bloby bez referencji (niezależnie od wieku). */
  orphanedBlobs: number
  /** Ile z sierot zostało pominiętych przez okres ochronny. */
  protectedYoung: number
  /** Ile sierot faktycznie usunięto (bez błędów). */
  deletedBlobs: number
  /** Ile prób usunięcia się nie powiodło (błąd FS / DB). */
  failedDeletes: number
  elapsedMs: number
}

/** Mapa: userId -> zbiór sha256 referowanych przez żywe encje tego usera. */
function collectReferencedBlobs(): Map<string, Set<string>> {
  const refs = new Map<string, Set<string>>()

  const rows = db
    .query(
      `SELECT user_id, blob_id, data_json FROM entities WHERE deleted_at IS NULL`,
    )
    .all() as Array<{ user_id: string; blob_id: string | null; data_json: string }>

  // A conflict/cancellation can retain an image in the job without publishing
  // it into the conversation. Keep that recoverable result for a live chat.
  if (db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='generation_jobs'").get()) {
    const jobs = db.query(`SELECT j.user_id, NULL AS blob_id, (j.workflow_json || j.request_json) AS data_json
      FROM generation_jobs j JOIN entities e ON e.user_id=j.user_id AND e.id=j.conversation_id
      AND e.type='conversation' AND e.deleted_at IS NULL WHERE j.status != 'succeeded'`).all() as typeof rows
    rows.push(...jobs)
  }

  for (const row of rows) {
    let set = refs.get(row.user_id)
    if (!set) {
      set = new Set<string>()
      refs.set(row.user_id, set)
    }

    if (row.blob_id) set.add(row.blob_id)

    const matches = row.data_json.match(SHA256_RE)
    if (matches) {
      for (const m of matches) set.add(m)
    }
  }

  return refs
}

/** Główny przebieg GC. Asynchroniczny — czeka na faktyczne usunięcia. */
export async function runGarbageCollection(): Promise<GcResult> {
  const start = Date.now()
  const now = Date.now()
  const entityCutoff = now - SOFT_DELETE_RETENTION_MS
  const blobAgeCutoff = now - MIN_BLOB_AGE_MS

  // Remove expired execution records before collecting their blob references.
  const purgedJobs = purgeGenerationJobs(db, now)

  // 1. Hard delete starych soft-deleted encji.
  const purgeResult = db.run(
    `DELETE FROM entities WHERE deleted_at IS NOT NULL AND deleted_at < ?`,
    [entityCutoff],
  )
  const purgedEntities = purgeResult.changes

  // 2. Zbierz referencje per-user.
  const refs = collectReferencedBlobs()

  const allBlobs = db
    .query('SELECT user_id, sha256, created_at FROM blobs')
    .all() as Array<{ user_id: string; sha256: string; created_at: number }>

  // Sierota = brak referencji u tego samego usera.
  const potentialOrphans = allBlobs.filter((b) => {
    const userRefs = refs.get(b.user_id)
    return !userRefs || !userRefs.has(b.sha256)
  })

  // Okres ochronny — świeże bloby czekają na referencję.
  const toDelete = potentialOrphans.filter((b) => b.created_at <= blobAgeCutoff)
  const protectedYoung = potentialOrphans.length - toDelete.length

  // Rzeczywiste kasowanie. Czekamy na każdą próbę, żeby raport był prawdziwy.
  let deletedBlobs = 0
  let failedDeletes = 0

  await Promise.all(
    toDelete.map(async (b) => {
      try {
        await deleteBlob(b.user_id, b.sha256)
        deletedBlobs++
      } catch (err) {
        failedDeletes++
        console.warn(`[gc] błąd kasowania bloba ${b.user_id}/${b.sha256}:`, err)
      }
    }),
  )

  const result: GcResult = {
    purgedJobs,
    purgedEntities,
    orphanedBlobs: potentialOrphans.length,
    protectedYoung,
    deletedBlobs,
    failedDeletes,
    elapsedMs: Date.now() - start,
  }

  console.log(
    `[gc] zadania usunięte: ${purgedJobs}, encje usunięte: ${purgedEntities}, ` +
      `sieroty: ${potentialOrphans.length} (ochrona wieku: ${protectedYoung}, ` +
      `skasowane: ${deletedBlobs}, błędy: ${failedDeletes}) ` +
      `w ${result.elapsedMs} ms`,
  )

  return result
}

/** Startuje pętlę GC: natychmiast + co GC_INTERVAL_MS. */
export function startGcLoop(): void {
  // Pierwszy przebieg z krótkim opóźnieniem, żeby nie blokować startu serwera.
  setTimeout(() => {
    void runGarbageCollection().catch((err) => {
      console.error('[gc] błąd pierwszego przebiegu:', err)
    })
  }, 5000)

  setInterval(() => {
    void runGarbageCollection().catch((err) => {
      console.error('[gc] błąd przebiegu okresowego:', err)
    })
  }, GC_INTERVAL_MS)
}
