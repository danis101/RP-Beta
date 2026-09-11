/**
 * Obsługa blobów — plików binarnych (portrety, avatary, obrazy w konwersacjach).
 *
 * Content-addressed: id = sha256 zawartości. Dedup per-user — jeśli ten sam
 * plik (np. ten sam avatar w dwóch personach) jest wgrywany drugi raz, nie
 * zapisujemy go ponownie, tylko zwracamy istniejące id.
 *
 * Layout na dysku: <DATA_DIR>/blobs/<user_id>/<sha[0:2]>/<sha256>
 * Sharding po 2 znakach trzyma listowanie katalogów szybkie przy wielu plikach.
 */

import { createHash } from 'node:crypto'
import { mkdir, writeFile, unlink, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { db, blobPath } from './db'

export interface BlobMeta {
  sha256: string
  size: number
  mime: string
  created_at: number
}

/** Znajduje metadane bloba dla danego użytkownika (null jeśli brak). */
export function findBlob(userId: string, sha256: string): BlobMeta | null {
  const row = db
    .query('SELECT sha256, size, mime, created_at FROM blobs WHERE user_id = ? AND sha256 = ?')
    .get(userId, sha256) as BlobMeta | null
  return row ?? null
}

/**
 * Zapisuje blob. Idempotentne — jeśli sha256 już istnieje dla tego usera,
 * zwraca istniejące metadane bez zapisu na dysk.
 */
export async function saveBlob(
  userId: string,
  bytes: Uint8Array,
  mime: string,
): Promise<BlobMeta> {
  const sha256 = createHash('sha256').update(bytes).digest('hex')

  const existing = findBlob(userId, sha256)
  if (existing) return existing

  const path = blobPath(userId, sha256)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes)

  const now = Date.now()
  db.run(
    'INSERT INTO blobs (sha256, user_id, size, mime, created_at) VALUES (?, ?, ?, ?, ?)',
    [sha256, userId, bytes.length, mime, now],
  )

  return { sha256, size: bytes.length, mime, created_at: now }
}

/** Zwraca ścieżkę do pliku i potwierdza, że plik istnieje na dysku. */
export async function resolveBlobPath(
  userId: string,
  sha256: string,
): Promise<string | null> {
  const path = blobPath(userId, sha256)
  try {
    await stat(path)
    return path
  } catch {
    return null
  }
}

/** Usuwa blob (używane np. przy sprzątaniu sierot — TODO). */
export async function deleteBlob(userId: string, sha256: string): Promise<void> {
  const path = blobPath(userId, sha256)
  try {
    await unlink(path)
  } catch {
    // plik mógł już nie istnieć — ignorujemy
  }
  db.run('DELETE FROM blobs WHERE user_id = ? AND sha256 = ?', [userId, sha256])
}
