import type { SearchToolCall } from '../../../shared/llm/webSearch'

/** SQLite port keeps lifecycle tests runnable without Bun or a production database. */
export interface JobDatabase {
  exec(sql: string): unknown
  query(sql: string): { get(...args: any[]): any; all(...args: any[]): any[] }
  run(sql: string, args?: any[]): unknown
  transaction<T>(fn: () => T): () => T
}

export interface StartJob {
  id: string
  conversationId: string
  targetMessageId: string
  mode: 'append' | 'regenerate'
  expectedUpdatedAt: number
  profileId: string
  webSearch?: true
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
}

export interface JobRow {
  id: string; user_id: string; conversation_id: string; status: string
  request_json: string; input_json: string; target_json: string; result_message_id: string
  content: string; thinking: string; error: string | null
  workflow_json: string
  created_at: number; updated_at: number; revision: number
}

export class JobError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 409) { super(message) }
}

export class GenerationStore {
  constructor(private db: JobDatabase) {
    db.exec(`CREATE TABLE IF NOT EXISTS generation_jobs (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id TEXT NOT NULL, conversation_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled','interrupted','conflict')),
      request_json TEXT NOT NULL, input_json TEXT NOT NULL, target_json TEXT NOT NULL, result_message_id TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '', thinking TEXT NOT NULL DEFAULT '', error TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY(user_id,id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_generation_active ON generation_jobs(user_id,conversation_id)
      WHERE status IN ('queued','running');
    CREATE INDEX IF NOT EXISTS idx_generation_list ON generation_jobs(user_id,conversation_id,created_at DESC);`)
    // Additive migration for databases deployed before tool workflows.
    if (!db.query('PRAGMA table_info(generation_jobs)').all().some((column: any) => column.name === 'workflow_json')) {
      db.exec("ALTER TABLE generation_jobs ADD COLUMN workflow_json TEXT NOT NULL DEFAULT '{}'")
    }
  }

  get(userId: string, id: string): JobRow | null {
    return this.db.query('SELECT * FROM generation_jobs WHERE user_id=? AND id=?').get(userId, id) ?? null
  }

  list(userId: string, conversationId: string): JobRow[] {
    return this.db.query('SELECT * FROM generation_jobs WHERE user_id=? AND conversation_id=? ORDER BY created_at DESC LIMIT 30').all(userId, conversationId)
  }

  start(userId: string, request: StartJob, modelRequest: unknown = null): { job: JobRow; created: boolean } {
    return this.db.transaction(() => {
      const previous = this.get(userId, request.id)
      if (previous) {
        if (previous.request_json !== JSON.stringify(request)) throw new JobError('Ten identyfikator zadania zostal juz uzyty z innymi danymi.')
        return { job: previous, created: false }
      }
      const row = this.conversation(userId, request.conversationId)
      if (!row) throw new JobError('Rozmowa nie istnieje.', 404)
      if (row.updated_at !== request.expectedUpdatedAt) throw new JobError('Rozmowa zmienila sie. Odswiez przed generowaniem.')
      const conversation = JSON.parse(row.data_json)
      const target = conversation.messages?.find((message: any) => message.id === request.targetMessageId)
      if (!target || conversation._deletedMessageIds?.includes(target.id)) throw new JobError('Wiadomosc docelowa nie istnieje.', 404)
      if (target.role !== (request.mode === 'append' ? 'user' : 'assistant')) throw new JobError('Nieprawidlowa rola wiadomosci docelowej.', 400)
      if (request.mode === 'append' && conversation.messages[conversation.messages.length - 1].id !== target.id) throw new JobError('Nowa odpowiedz wymaga ostatniej wiadomosci uzytkownika.')
      if (this.db.query("SELECT id FROM generation_jobs WHERE user_id=? AND conversation_id=? AND status IN ('queued','running')").get(userId, request.conversationId)) {
        throw new JobError('Ta rozmowa ma juz aktywne generowanie.')
      }
      const now = Date.now()
      this.db.run(`INSERT INTO generation_jobs(user_id,id,conversation_id,status,request_json,input_json,target_json,result_message_id,created_at,updated_at)
        VALUES(?,?,?,'queued',?,?,?,?,?,?)`, [userId, request.id, request.conversationId, JSON.stringify(request), JSON.stringify(modelRequest), JSON.stringify(target),
        request.mode === 'append' ? crypto.randomUUID() : target.id, now, now])
      return { job: this.get(userId, request.id)!, created: true }
    })()
  }

  private conversation(userId: string, id: string): { data_json: string; updated_at: number } | null {
    return this.db.query("SELECT data_json,updated_at FROM entities WHERE user_id=? AND type='conversation' AND id=? AND deleted_at IS NULL").get(userId, id) ?? null
  }

  update(userId: string, id: string, status: string, content: string, thinking: string, error: string | null = null): void {
    this.db.run(`UPDATE generation_jobs SET status=?,content=?,thinking=?,error=?,revision=revision+1,updated_at=MAX(updated_at+1,?)
      WHERE user_id=? AND id=? AND status IN ('queued','running')`, [status, content, thinking, error, Date.now(), userId, id])
  }

  cancel(userId: string, id: string): JobRow | null {
    const job = this.get(userId, id)
    if (job) this.update(userId, id, 'cancelled', job.content, job.thinking)
    return this.get(userId, id)
  }

  workflow(userId: string, id: string, phase: string, toolCall?: SearchToolCall): void {
    this.db.run(`UPDATE generation_jobs SET workflow_json=?,revision=revision+1,updated_at=MAX(updated_at+1,?)
      WHERE user_id=? AND id=? AND status IN ('queued','running')`,
      [JSON.stringify({ phase, toolCall }), Date.now(), userId, id])
  }

  recover(): void {
    this.db.run(`UPDATE generation_jobs SET status='interrupted',error='Serwer zostal zrestartowany. Zadanie nie zostalo automatycznie ponowione.',
      revision=revision+1,updated_at=MAX(updated_at+1,?) WHERE status IN ('queued','running')`, [Date.now()])
  }

  /** Publish against current state, in the same transaction as successful job completion. */
  complete(userId: string, id: string, content: string, thinking: string, toolCall?: SearchToolCall): boolean {
    return this.db.transaction(() => {
      const job = this.get(userId, id)
      if (!job || job.status !== 'running') return false
      const request: StartJob = JSON.parse(job.request_json)
      const row = this.conversation(userId, job.conversation_id)
      const conversation = row ? JSON.parse(row.data_json) : null
      const target = conversation?.messages?.find((message: any) => message.id === request.targetMessageId)
      if (!row || !target || conversation._deletedMessageIds?.includes(target.id) ||
          conversation._deletedMessageIds?.includes(job.result_message_id) || JSON.stringify(target) !== job.target_json ||
          (request.mode === 'append' && conversation.messages[conversation.messages.length - 1].id !== target.id)) {
        this.update(userId, id, 'conflict', content, thinking, 'Rozmowa lub wiadomosc docelowa zostala zmieniona/usunieta. Wynik zachowano w zadaniu.')
        return false
      }
      const now = Math.max(Date.now(), row.updated_at + 1, (target._updatedAt ?? target.timestamp ?? 0) + 1)
      const variant = { content, ...(thinking ? { thinking } : {}), ...(toolCall ? { toolCall } : {}) }
      if (request.mode === 'append') {
        if (conversation.messages.some((message: any) => message.id === job.result_message_id)) {
          throw new JobError('Wiadomosc wynikowa juz istnieje.')
        }
        conversation.messages.push({ id: job.result_message_id, role: 'assistant', variants: [variant], selectedVariant: 0, timestamp: now, _updatedAt: now })
      } else {
        target.variants.push(variant)
        target.selectedVariant = target.variants.length - 1
        target._updatedAt = now
      }
      conversation.unread = 0
      this.db.run("UPDATE entities SET data_json=?,updated_at=? WHERE user_id=? AND type='conversation' AND id=? AND deleted_at IS NULL",
        [JSON.stringify(conversation), now, userId, job.conversation_id])
      this.update(userId, id, 'succeeded', content, thinking)
      return true
    })()
  }
}

/** Do not expose prompts, profile configuration or credentials through status polling. */
export function publicJob(row: JobRow) {
  const request = JSON.parse(row.request_json) as StartJob
  return { id: row.id, conversationId: row.conversation_id, status: row.status, resultMessageId: row.result_message_id,
    mode: request.mode, targetMessageId: request.targetMessageId,
    ...JSON.parse(row.workflow_json || '{}'),
    content: row.content, thinking: row.thinking, error: row.error, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at }
}
