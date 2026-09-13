import type { WorkflowToolCall, ImageInput } from '../../../shared/llm/imageTypes'
import type { ModelMessage } from '../../../shared/llm/messages'
import { summaryMessage } from '../../../shared/llm/summary'

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
  image?: ImageInput
  operation?: 'image' | 'summary'
  historyTailId?: string
  messages: ModelMessage[]
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
    CREATE INDEX IF NOT EXISTS idx_generation_list ON generation_jobs(user_id,conversation_id,created_at DESC);`)
    // Additive migration for databases deployed before tool workflows.
    if (!db.query('PRAGMA table_info(generation_jobs)').all().some((column: any) => column.name === 'workflow_json')) {
      db.exec("ALTER TABLE generation_jobs ADD COLUMN workflow_json TEXT NOT NULL DEFAULT '{}'")
    }
    const oldIndex = db.query("SELECT sql FROM sqlite_master WHERE name='idx_generation_active'").get() as { sql: string } | null
    if (oldIndex && !oldIndex.sql.includes('json_extract')) db.exec('DROP INDEX idx_generation_active')
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_generation_active ON generation_jobs(user_id,conversation_id)
      WHERE status IN ('queued','running') AND COALESCE(json_extract(request_json,'$.operation'),'') != 'summary';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_summary_active ON generation_jobs(user_id,conversation_id)
      WHERE status IN ('queued','running') AND json_extract(request_json,'$.operation') = 'summary';`)
  }

  get(userId: string, id: string): JobRow | null {
    return this.db.query('SELECT * FROM generation_jobs WHERE user_id=? AND id=?').get(userId, id) ?? null
  }

  list(userId: string, conversationId: string): JobRow[] {
    return this.db.query("SELECT * FROM generation_jobs WHERE user_id=? AND conversation_id=? ORDER BY CASE WHEN status IN ('queued','running') THEN 0 ELSE 1 END,created_at DESC LIMIT 30").all(userId, conversationId)
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
      const emptyImage = request.operation === 'image' && request.mode === 'append' && conversation.messages.length === 0 && request.targetMessageId === conversation.id
      if ((!target && !emptyImage) || conversation._deletedMessageIds?.includes(target?.id)) throw new JobError('Wiadomosc docelowa nie istnieje.', 404)
      if (!emptyImage && !(request.operation && request.mode === 'append') && target.role !== (request.mode === 'append' ? 'user' : 'assistant')) throw new JobError('Nieprawidlowa rola wiadomosci docelowej.', 400)
      if (request.historyTailId && (request.operation || request.mode !== 'append')) throw new JobError('Nieprawidlowa kotwica historii.', 400)
      if (request.mode === 'append' && !emptyImage && conversation.messages[conversation.messages.length - 1].id !== (request.historyTailId ?? target.id)) throw new JobError('Koniec rozmowy zmienil sie.')
      if (request.image?.prompt !== undefined) {
        const variant = target?.variants?.[target.selectedVariant] ?? target?.variants?.[0]
        if (request.operation !== 'image' || request.mode !== 'regenerate' || variant?.toolCall?.type !== 'image' || variant.toolCall.prompt !== request.image.prompt) throw new JobError('Prompt regeneracji nie odpowiada zapisanemu wariantowi obrazu.')
      }
      if (this.db.query("SELECT id FROM generation_jobs WHERE user_id=? AND conversation_id=? AND status IN ('queued','running') AND (COALESCE(json_extract(request_json,'$.operation'),'')='summary')=?").get(userId, request.conversationId, request.operation === 'summary' ? 1 : 0)) {
        throw new JobError('Ta rozmowa ma juz aktywne generowanie.')
      }
      const now = Date.now()
      this.db.run(`INSERT INTO generation_jobs(user_id,id,conversation_id,status,request_json,input_json,target_json,result_message_id,created_at,updated_at)
        VALUES(?,?,?,'queued',?,?,?,?,?,?)`, [userId, request.id, request.conversationId, JSON.stringify(request), JSON.stringify(modelRequest), JSON.stringify(request.operation === 'summary'
          ? { messages: conversation.messages.map(summaryMessage), memory: conversation.longTermMemory, index: conversation.lastSummarizedIndex } : target ?? null),
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

  workflow(userId: string, id: string, phase: string, toolCall?: WorkflowToolCall): void {
    this.db.run(`UPDATE generation_jobs SET workflow_json=?,revision=revision+1,updated_at=MAX(updated_at+1,?)
      WHERE user_id=? AND id=? AND status IN ('queued','running')`,
      [JSON.stringify({ phase, toolCall }), Date.now(), userId, id])
  }

  recover(): void {
    this.db.run(`UPDATE generation_jobs SET status='interrupted',error='Serwer zostal zrestartowany. Zadanie nie zostalo automatycznie ponowione.',
      revision=revision+1,updated_at=MAX(updated_at+1,?) WHERE status IN ('queued','running')`, [Date.now()])
  }

  /** Publish against current state, in the same transaction as successful job completion. */
  complete(userId: string, id: string, content: string, thinking: string, toolCall?: WorkflowToolCall): boolean {
    return this.db.transaction(() => {
      const job = this.get(userId, id)
      if (!job || job.status !== 'running') return false
      const request: StartJob = JSON.parse(job.request_json)
      const row = this.conversation(userId, job.conversation_id)
      const conversation = row ? JSON.parse(row.data_json) : null
      if (request.operation === 'summary') {
        const snapshot = JSON.parse(job.target_json)
        const same = conversation && JSON.stringify(conversation.messages.slice(0, snapshot.messages.length).map(summaryMessage)) === JSON.stringify(snapshot.messages) &&
          JSON.stringify(conversation.longTermMemory) === JSON.stringify(snapshot.memory) && conversation.lastSummarizedIndex === snapshot.index
        if (!same) { this.update(userId, id, 'conflict', content, thinking, 'Historia lub pamiec zmienila sie podczas podsumowania. Wynik zachowano w zadaniu.'); return false }
        const summary = (content.trim() ? content : thinking).trim()
        if (!summary) throw new JobError('Model zwrocil puste podsumowanie.', 400)
        const now = Math.max(Date.now(), row!.updated_at + 1)
        const boundary = snapshot.messages.length - 1
        conversation.longTermMemory.push({ id: job.result_message_id, content: summary, timestamp: now, messageIndex: boundary })
        conversation.lastSummarizedIndex = boundary
        this.db.run("UPDATE entities SET data_json=?,updated_at=? WHERE user_id=? AND type='conversation' AND id=? AND deleted_at IS NULL", [JSON.stringify(conversation), now, userId, job.conversation_id])
        this.update(userId, id, 'succeeded', content, thinking)
        return true
      }
      const target = conversation?.messages?.find((message: any) => message.id === request.targetMessageId)
      const emptyImage = request.operation === 'image' && request.mode === 'append' && conversation?.messages?.length === 0 && request.targetMessageId === conversation.id
      if (!row || (!target && !emptyImage) || conversation._deletedMessageIds?.includes(target?.id) ||
          conversation._deletedMessageIds?.includes(job.result_message_id) || JSON.stringify(target ?? null) !== job.target_json ||
          (request.mode === 'append' && !emptyImage && conversation.messages[conversation.messages.length - 1].id !== (request.historyTailId ?? target.id))) {
        this.update(userId, id, 'conflict', content, thinking, 'Rozmowa lub wiadomosc docelowa zostala zmieniona/usunieta. Wynik zachowano w zadaniu.')
        return false
      }
      const now = Math.max(Date.now(), row.updated_at + 1, (target?._updatedAt ?? target?.timestamp ?? 0) + 1)
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
    operation: request.operation,
    ...JSON.parse(row.workflow_json || '{}'),
    content: row.content, thinking: row.thinking, error: row.error, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at }
}
