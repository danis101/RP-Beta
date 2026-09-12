import type { OpenAIMessage, ToolDefinition } from './OpenAIAdapter'
import type { APIToolCall } from '../../types'

export interface SendMessageParams {
  /** Gotowa lista wiadomości (z system promptem i injekcjami). */
  messages: OpenAIMessage[]
  model?: string
  temperature?: number
  systemPrompt?: string
  signal?: AbortSignal
  /** Narzedzia dozwolone dla tego wywolania. Brak/pusta lista = bez narzedzi. */
  tools?: ToolDefinition[]
}

export interface StreamCallbacks {
  onToken: (token: string) => void
  onThinking?: (token: string) => void
  onToolCalls?: (toolCalls: APIToolCall[]) => void
  onDone: () => void
  onError: (error: Error) => void
}

export interface ModelInfo {
  id: string
  status: 'loaded' | 'available' | 'unavailable'
}

export type ApiBackend = 'lmstudio' | 'generic'

export interface ListModelsResult {
  models: ModelInfo[]
  /** Wykryty backend – 'lmstudio' gdy odpowiedział /api/v0/models, inaczej 'generic'. */
  backend?: ApiBackend
}

export interface ApiAdapter {
  id: string
  name: string
  isConfigured(): boolean
  sendMessage(params: SendMessageParams): Promise<string>
  streamMessage(params: SendMessageParams, callbacks: StreamCallbacks): Promise<void>
  listModels(signal?: AbortSignal): Promise<ListModelsResult>
}
