/**
 * Warstwa bazy danych — bun:sqlite + schemat.
 *
 * Tabele:
 *   users     — konta (username unique, password_hash argon2id, is_admin flag)
 *   blobs     — metadane plików blobów, dedup per (user_id, sha256)
 *   entities  — generyczna tabela encji (character/persona/conversation/style/lorebook)
 *
 * Encje trzymamy w jednej tabeli z kolumną `type`, bo struktura wszystkich
 * jest identyczna: id + user_id + name + blob_id + data_json + timestampy.
 * Różnice między typami są w `data_json`.
 *
 * Soft delete: `deleted_at` — usunięte encje zostają w bazie, żeby inne sesje
 * mogły się dowiedzieć o usunięciu (przez WebSocket event) i żeby GC mógł
 * je twardo usunąć dopiero po okresie retencji.
 */

import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { DATA_DIR } from './config'

export const BLOBS_DIR = `${DATA_DIR}/blobs`
export const DB_PATH = `${DATA_DIR}/rp-sync.sqlite`

mkdirSync(DATA_DIR, { recursive: true })
mkdirSync(BLOBS_DIR, { recursive: true })

export const db = new Database(DB_PATH)

// WAL = lepsza współbieżność, mniejsze ryzyko blokady.
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')
db.exec('PRAGMA busy_timeout = 5000')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS blobs (
    sha256     TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    size       INTEGER NOT NULL,
    mime       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, sha256)
  );

  CREATE TABLE IF NOT EXISTS entities (
    user_id     TEXT NOT NULL,
    type        TEXT NOT NULL,
    id          TEXT NOT NULL,
    name        TEXT,
    blob_id     TEXT,
    data_json   TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    PRIMARY KEY (user_id, type, id)
  );

  CREATE INDEX IF NOT EXISTS idx_entities_list
    ON entities(user_id, type, deleted_at, updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_entities_deleted
    ON entities(deleted_at);
`)

/**
 * Migracja addytywna: dodaj `is_admin` jeśli brakuje (starsze bazy).
 * Bezpieczne wielokrotne wywołanie — sprawdzamy PRAGMA table_info.
 */
function ensureColumn(table: string, column: string, definition: string): void {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

ensureColumn('users', 'is_admin', 'INTEGER NOT NULL DEFAULT 0')

/** Ścieżka pliku bloba na dysku — z shardingiem po 2 pierwszych znakach sha. */
export function blobPath(userId: string, sha256: string): string {
  return `${BLOBS_DIR}/${userId}/${sha256.slice(0, 2)}/${sha256}`
}
