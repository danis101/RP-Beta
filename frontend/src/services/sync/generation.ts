import { request } from './client'
import type { ImageInput, WorkflowToolCall } from '../../../../shared/llm/imageTypes'

export interface GenerationJob {
  id: string
  conversationId: string
  targetMessageId: string
  mode: 'append' | 'regenerate'
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted' | 'conflict'
  resultMessageId: string
  content: string
  thinking: string
  error: string | null
  revision: number
  createdAt: number
  updatedAt: number
  phase?: string
  toolCall?: WorkflowToolCall
}

export interface StartGeneration {
  id: string
  conversationId: string
  targetMessageId: string
  mode: 'append' | 'regenerate'
  expectedUpdatedAt: number
  profileId: string
  webSearch?: true
  image?: ImageInput
  operation?: 'image'
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
}

export const isGenerationActive = (job: GenerationJob | null) =>
  job?.status === 'queued' || job?.status === 'running'

export const generationApi = {
  list: (conversationId: string, signal?: AbortSignal) =>
    request<{ items: GenerationJob[] }>(`/generation-jobs?conversationId=${encodeURIComponent(conversationId)}`, { signal }),
  start: (body: StartGeneration) => request<GenerationJob>('/generation-jobs', { method: 'POST', body }),
  cancel: (id: string) => request<GenerationJob>(`/generation-jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
}
