/** Wpis lorebooka/world info — zgodny ze ST i TAVO. */
export interface LorebookEntry {
  id: string
  name?: string
  keys: string[]
  secondaryKeys?: string[]
  content: string
  enabled: boolean
  constant: boolean
  useRegex: boolean
  selective?: boolean
  caseSensitive: boolean
  matchWholeWords?: boolean
  /** 0=before_char, 1=after_char, 2=before, 3=after */
  position: number
  depth: number
  order: number
  probability?: number
  sticky?: number
  cooldown?: number
  delay?: number
  /** Pełny oryginalny wpis z importu — zachowujemy nieznane pola. */
  raw?: Record<string, unknown>
  [key: string]: unknown
}

/** Cały lorebook — kolekcja wpisów. */
export interface Lorebook {
  id: string
  name: string
  description?: string
  scanDepth: number
  tokenBudget?: number
  recursiveScanning?: boolean
  entries: LorebookEntry[]
}

/** Wpis lorebooka w formacie SillyTavern (character_book entries). */
export interface CharacterBook {
  entries?: LorebookEntry[]
  extensions?: Record<string, unknown>
  [key: string]: unknown
}

/**
 * Karta postaci.
 * Pola z `description` do `character_version` odwzorowują spec SillyTavern V2/V3.
 */
export interface CharacterCard {
  id: string
  name: string
  description?: string
  personality?: string
  scenario?: string
  firstMes?: string
  mesExample?: string
  creatorNotes?: string
  systemPrompt?: string
  postHistoryInstructions?: string
  alternateGreetings?: string[]
  tags?: string[]
  creator?: string
  characterVersion?: string
  extensions?: Record<string, unknown>
  characterBook?: CharacterBook

  // UI-only
  role?: string
  status?: 'online' | 'away' | 'offline'
  summary?: string
  portrait?: string

  /** Pełny oryginalny spec ST z importu. */
  rawSpec?: Record<string, unknown>
}

/**
 * Persona użytkownika.
 * Imię i opis trafiają do system promptu, żeby AI miało punkt odniesienia.
 * Avatar służy wyłącznie do wyglądu w UI.
 */
export interface Persona {
  id: string
  name: string
  description?: string
  avatar?: string
}

/** Parametry samplera wysyłane do LLM (OpenAI-compatible). */
export interface SamplerParams {
  temperature?: number
  topP?: number
  topK?: number
  frequencyPenalty?: number
  presencePenalty?: number
}

/** Konfiguracja jednego profilu API (zapisana, możliwa do wyboru). */
export interface ApiProfile {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
  sampler: SamplerParams
  maxTokens: number
  contextLength: number
  streamingEnabled: boolean
  memoryMessages: number
  /** Czy obsługuje vision (wysyłanie obrazów) */
  visionEnabled: boolean
  /** Model do vision (jeśli inny niż główny) */
  visionModel?: string
}

/**
 * Pojedynczy bloczek stylu (TAVO-compatible).
 * `marker: true` oznacza placeholder podmieniany danymi.
 */
export interface PromptBlock {
  identifier: string
  name: string
  content?: string
  systemPrompt: boolean
  marker: boolean
  role: 'system' | 'user' | 'assistant'
  injectionPosition?: number
  injectionDepth?: number
  forbidOverrides?: boolean
  enabled: boolean
}

/** Kolejność bloków per postać ('' = globalna). */
export interface PromptOrderEntry {
  characterId: string
  order: Array<{ identifier: string; enabled: boolean }>
}

/** Cały styl — jak JSON z TAVO. */
export interface StyleConfig {
  impersonationPrompt?: string
  newChatPrompt?: string
  newGroupChatPrompt?: string
  newExampleChatPrompt?: string
  continueNudgePrompt?: string
  scenarioFormat?: string
  personalityFormat?: string
  groupNudgePrompt?: string
  wiFormat?: string
  prompts: PromptBlock[]
  promptOrder: PromptOrderEntry[]
}

/** Nazwany preset stylu. */
export interface StylePreset {
  id: string
  name: string
  style: StyleConfig
}

export type MessageRole = 'user' | 'assistant'

export interface ToolCall {
  type: 'image' | 'websearch'
  label: string
  /** URL wygenerowanego obrazu (dla type: 'image'). */
  imageUrl?: string
  /** Wyniki wyszukiwania (dla type: 'websearch'). */
  results?: WebSearchResult[]
  /** Stan generowania obrazu (dla type: 'image'). */
  status?: 'generating' | 'done' | 'error'
  /** Komunikat błędu / info (dla type: 'image'). */
  error?: string
}

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
  source?: string
}

/** Załącznik do wiadomości (np. obraz) */
export interface MessageAttachment {
  type: 'image'
  data: string // base64 data URL
  name?: string
}

/** Reprezentacja tool call z API */
export interface APIToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string // JSON string
  }
}

/** Jeden wariant treści wiadomości (swipe). */
export interface MessageVariant {
  content: string
  toolCall?: ToolCall
  /** Tokeny reasoning/thinking wygenerowane przez model (opcjonalne). */
  thinking?: string
  /** Załączniki (obrazy) */
  attachments?: MessageAttachment[]
}

/**
 * Wiadomość w konwersacji.
 * Wiadomości asystenta mogą mieć wiele wariantów (regeneracje).
 */
export interface ChatMessage {
  id: string
  role: MessageRole
  variants: MessageVariant[]
  selectedVariant: number
  timestamp: number
}

/** Pojedynczy wpis pamięci długotrwałej. */
export interface LongTermMemoryEntry {
  id: string
  content: string
  timestamp: number
  /** Indeks ostatniej wiadomości, która została uwzględniona w tym wpisie. */
  messageIndex: number
}

export interface Conversation {
  id: string
  characterId: string
  messages: ChatMessage[]
  unread: number
  /** Opcjonalny override persony dla tej konwersacji (undefined = domyślna). */
  personaId?: string
  /** Opcjonalny override stylu dla tej konwersacji (undefined = domyślny). */
  styleId?: string
  /** Aktywne lorebooki dla tej konwersacji. */
  lorebookIds?: string[]
  /** Pamięć długotrwała – lista podsumowań. */
  longTermMemory: LongTermMemoryEntry[]
  /** Indeks ostatniej wiadomości, która została już podsumowana. */
  lastSummarizedIndex: number
}
