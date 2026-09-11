import type { ChatMessage, ToolCall, CharacterCard, Persona, APIToolCall } from '../../types'
import type { ToolDefinition, ApiAdapter } from '../../services/api'

/**
 * Kontekst wykonania narzędzia — wszystko, czego handler może potrzebować,
 * żeby narzędzia były wykonywalne niezależnie od przewodzenia w App.
 */
export interface ToolContext {
  character: CharacterCard
  persona?: Persona
  history: ChatMessage[]
  settings: ToolSettings
  /** Adapter do LLM używanego przez narzędzie (np. refiner obrazu). */
  refinerAdapter?: ApiAdapter
  /** Model, którego ma użyć refiner (nadpisuje profil). */
  refinerModel?: string
}

/** Ustawienia, które narzędzia mogą odczytać (przekazywane z AppSettings). */
export interface ToolSettings {
  [key: string]: unknown
  webSearchUrl?: string
  webSearchApiKey?: string
  webSearchMaxResults?: number
  webSearchCooldown?: number
  imageGenBaseUrl?: string
  imageGenResponseFormat?: 'url' | 'b64_json'
  imageGenRefinerProfileId?: string
  imageGenRefinerPrompt?: string
  imageGenContextMessages?: number
}

/**
 * Wynik wykonania narzędzia.
 * - `toolCall` – struktura do zapisania w wariancie wiadomości (renderowana w dymku).
 * - `message` – wiadomość systemowa do wstrzyknięcia w drugi przebieg LLM (np. wyniki wyszukiwania).
 * - `followUp` – czy po wykonaniu narzędzia należy ponownie wywołać LLM z wynikami.
 */
export interface ToolResult {
  toolCall?: ToolCall
  message?: { role: 'system' | 'user' | 'assistant'; content: string }
  followUp?: boolean
}

/**
 * Pojedyncze narzędzie w rejestrze.
 * `declaration` to JSON Schema dla LLM (tool calling).
 * `run` wykonuje narzędzie i zwraca wynik.
 */
export interface ToolDef {
  name: string
  declaration: ToolDefinition
  run(args: Record<string, unknown>, call: APIToolCall, ctx: ToolContext): Promise<ToolResult>
}

/** Rejestr narzędzi. */
export type ToolRegistry = Record<string, ToolDef>