import { readCompletionStream } from '../../../shared/llm/stream'
import { GenerationStore, type JobRow } from './store'
import type { SearchToolCall } from '../../../shared/llm/webSearch'

export interface WorkflowProgress { content: string; thinking: string; phase: string; toolCall?: SearchToolCall }
export type GenerationWorkflow = (signal: AbortSignal, progress: (state: WorkflowProgress) => void) => Promise<WorkflowProgress>

/** Owns execution; HTTP handlers only start/observe/cancel. No browser request signal. */
export class GenerationRunner {
  private active = new Map<string, AbortController>()
  constructor(private store: GenerationStore, private published: (userId: string, conversationId: string) => void) {}

  start(job: JobRow, openResponse: (signal: AbortSignal) => Promise<Response>, workflow?: GenerationWorkflow): void {
    const key = JSON.stringify([job.user_id, job.id])
    if (this.active.has(key) || job.status !== 'queued') return
    const controller = new AbortController()
    this.active.set(key, controller)
    // Store admission has completed synchronously before this detached task starts.
    void this.run(job, controller, openResponse, workflow).finally(() => this.active.delete(key)).catch(error => console.error('[generation]', error))
  }

  cancel(userId: string, id: string): JobRow | null {
    const result = this.store.cancel(userId, id)
    this.active.get(JSON.stringify([userId, id]))?.abort()
    return result
  }

  cancelUser(userId: string): void {
    for (const [key, controller] of this.active) {
      const [owner, id] = JSON.parse(key) as [string, string]
      if (owner === userId) {
        this.store.cancel(userId, id)
        controller.abort()
      }
    }
  }

  private async run(job: JobRow, controller: AbortController, openResponse: (signal: AbortSignal) => Promise<Response>, workflow?: GenerationWorkflow): Promise<void> {
    let content = '', thinking = '', lastSaved = 0
    const progress = () => {
      if (Date.now() - lastSaved < 500) return
      const current = this.store.get(job.user_id, job.id)
      if (!current || current.status !== 'running') { controller.abort(); throw new Error('Zadanie nie jest aktywne.') }
      this.store.update(job.user_id, job.id, 'running', content, thinking)
      lastSaved = Date.now()
    }
    try {
      this.store.update(job.user_id, job.id, 'running', content, thinking)
      if (workflow) {
        let phase = '', toolJson = ''
        const result = await workflow(controller.signal, state => {
          content = state.content; thinking = state.thinking
          const changed = phase !== state.phase || toolJson !== JSON.stringify(state.toolCall)
          if (changed) {
            phase = state.phase; toolJson = JSON.stringify(state.toolCall)
            this.store.workflow(job.user_id, job.id, phase, state.toolCall)
            lastSaved = 0
          }
          progress()
        })
        content = result.content; thinking = result.thinking
        if (!content.trim() && !thinking.trim()) throw new Error('Model nie zwrocil odpowiedzi.')
        if (this.store.complete(job.user_id, job.id, content, thinking, result.toolCall)) this.published(job.user_id, job.conversation_id)
        return
      }
      const response = await openResponse(controller.signal)
      await readCompletionStream(response, {
        onToken: text => { content += text; progress() },
        onThinking: text => { thinking += text; progress() },
        onToolCalls: () => { throw new Error('Ten etap obsluguje tylko tekst. Model zwrocil niezamowione wywolanie narzedzia.') },
        onError: error => { throw error }, onDone: () => {},
      })
      if (!content.trim() && !thinking.trim()) throw new Error('Model nie zwrocil odpowiedzi.')
      if (this.store.complete(job.user_id, job.id, content, thinking)) this.published(job.user_id, job.conversation_id)
    } catch (error) {
      this.store.update(job.user_id, job.id, 'failed', content, thinking, error instanceof Error ? error.message : String(error))
    } finally {
      controller.abort()
    }
  }
}
