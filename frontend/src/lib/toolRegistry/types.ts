import type { ChatMessage, ToolCall, CharacterCard, Persona, APIToolCall } from '../../types'
import type { ToolDefinition, ApiAdapter } from '../../services/api'

/**
 * Kontekst wykonania narzędzia.
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
  refinerContextLength?: number
  refinerMaxTokens?: number
  /**
   * Wymuszony styl obrazu dla tej rozmowy (z `Conversation.imageStyleId`).
   * Przekazywany do refinera jako twarda dyrektywa.
   */
  imageStyleDirective?: string
}

/** Ustawienia, które narzędzia mogą odczytać. */
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

/** Przelaczniki dostepnosci narzedzi, wspolne dla deklaracji i wykonania. */
export interface ToolAvailability {
  webSearchEnabled: boolean
  imageGenEnabled: boolean
}

/**
 * Wynik wykonania narzędzia.
 */
export interface ToolResult {
  toolCall?: ToolCall
  message?: { role: 'system' | 'user' | 'assistant'; content: string }
  followUp?: boolean
}

/**
 * Pojedyncze narzędzie w rejestrze.
 */
export interface ToolDef {
  name: string
  enabledSetting: keyof ToolAvailability
  declaration: ToolDefinition
  run(args: Record<string, unknown>, call: APIToolCall, ctx: ToolContext): Promise<ToolResult>
}

/** Rejestr narzędzi. */
export type ToolRegistry = Record<string, ToolDef>
