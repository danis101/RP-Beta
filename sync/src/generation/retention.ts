import type { JobDatabase } from './store'

const DAY_MS = 24 * 60 * 60 * 1000
export const SUCCESS_RETENTION_MS = DAY_MS
export const RECOVERY_RETENTION_MS = 7 * DAY_MS

/** Run before blob GC so expired recovery-only images can become orphans.
 * Published answers live in entities, independently of these execution records.
 */
export function purgeGenerationJobs(db: JobDatabase, now = Date.now()): number {
  if (!db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='generation_jobs'").get()) return 0
  const result = db.run(`DELETE FROM generation_jobs
    WHERE (status='succeeded' AND updated_at <= ?)
       OR (status IN ('failed','cancelled','interrupted','conflict') AND updated_at <= ?)`,
    [now - SUCCESS_RETENTION_MS, now - RECOVERY_RETENTION_MS]) as { changes: number }
  return Number(result.changes)
}
