/** Wpis lorebooka/world info - zgodny ze ST i TAVO. */
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
  /** Pelny oryginalny wpis z importu - zachowujemy nieznane pola. */
  raw?: Record<string, unknown>
  [key: string]: unknown
}

/** Caly lorebook - kolekcja wpisow. */
export interface Lorebook {
  id: string
  name: string
  description?: string
  scanDepth: number
  tokenBudget?: number
  recursiveScanning?: boolean
  entries: LorebookEntry[]
  /** Server-assigned metadane do optimistic lockingu. */
  _serverCreatedAt?: number
  _serverUpdatedAt?: number
}

/** Wpis lorebooka w formacie SillyTavern (character_book entries). */
export interface CharacterBook {
  entries?: LorebookEntry[]
  extensions?: Record<string, unknown>
  [key: string]: unknown
}

/**
 * Karta postaci.
 * Pola z `description` do `character_version` odwzorowuja spec SillyTavern V2/V3.
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

  role?: string
  status?: 'online' | 'away' | 'offline'
  summary?: string

  /** Nowy format: sha256 bloba. Preferowany. */
  portraitBlobId?: string | null
  /** Stary format: base64 data URL. Deprecated. */
  portrait?: string

  rawSpec?: Record<string, unknown>

  _serverCreatedAt?: number
  _serverUpdatedAt?: number
}

/**
 * Persona uzytkownika.
 * Avatar: `avatarBlobId` (nowy) lub `avatar` (stary base64).
 */
export interface Persona {
  id: string
  name: string
  description?: string

  /** Nowy format: sha256 bloba. Preferowany. */
  avatarBlobId?: string | null
  /** Stary format: base64 data URL. Deprecated. */
  avatar?: string

  _serverCreatedAt?: number
  _serverUpdatedAt?: number
}

export interface SamplerParams {
  temperature?: number
  topP?: number
  topK?: number
  frequencyPenalty?: number
  presencePenalty?: number
}

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
  /** Dodaj ture user przed powitaniem assistant, tylko w zadaniu do modelu. */
  initialUserMessageEnabled?: boolean
  memoryMessages: number
  visionEnabled: boolean
  visionModel?: string
}

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

export interface PromptOrderEntry {
  characterId: string
  order: Array<{ identifier: string; enabled: boolean }>
}

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

export interface StylePreset {
  id: string
  name: string
  style: StyleConfig
  _serverCreatedAt?: number
  _serverUpdatedAt?: number
}

export type MessageRole = 'user' | 'assistant'

/**
 * Tool call (obraz lub websearch).
 */
export interface ToolCall {
  type: 'image' | 'websearch'
  label: string
  /** Nowy format: sha256 bloba. */
  imageBlobId?: string
  /** Stary format: base64 data URL. Deprecated. */
  imageUrl?: string
  /** Prompt do mostka obrazow (dla regeneracji). */
  prompt?: string
  /** Wyniki wyszukiwania (dla type: 'websearch'). */
  results?: WebSearchResult[]
  /** Stan generowania obrazu (dla type: 'image'). */
  status?: 'generating' | 'done' | 'error'
  /** Komunikat bledu / info (dla type: 'image'). */
  error?: string
}

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
  source?: string
}

/**
 * Zalacznik do wiadomosci (np. obraz).
 */
export interface MessageAttachment {
  type: 'image'
  blobId?: string
  data?: string
  name?: string
}

export interface APIToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface MessageVariant {
  content: string
  toolCall?: ToolCall
  thinking?: string
  attachments?: MessageAttachment[]
}

export interface ChatMessage {
  id: string
  role: MessageRole
  variants: MessageVariant[]
  selectedVariant: number
  timestamp: number
  /**
   * Timestamp ostatniej modyfikacji (edit treści, dodanie wariantu, zmiana
   * wybranego wariantu). Uzywany przy merge rozmow do rozstrzygniecia
   * konfliktu LWW (last-write-wins). Jesli brak — bierzemy `timestamp`
   * jako fallback (starsze dane sprzed migracji).
   */
  _updatedAt?: number
}

export interface LongTermMemoryEntry {
  id: string
  content: string
  timestamp: number
  messageIndex: number
}

export interface Conversation {
  id: string
  characterId: string
  messages: ChatMessage[]
  unread: number
  personaId?: string
  styleId?: string
  lorebookIds?: string[]
  longTermMemory: LongTermMemoryEntry[]
  lastSummarizedIndex: number
  /**
   * Wybrany styl obrazu dla tej konkretnej rozmowy. Pusty = refiner decyduje
   * sam. Wartosc pochodzi z listy zdefiniowanej przez usera w Settings
   * (`imageGenCustomStyles`). Wysylana do refinera jako twarda dyrektywa
   * `[STYLE: <wartość>]` — patrz `lib/refiner.ts`.
   */
  imageStyleId?: string
  /**
   * Tombstones — ID wiadomosci ktore zostaly usuniete. Trzymamy je osobno
   * (zamiast flagi na wiadomosci), zeby:
   *   - merge nie przywracal usunietych wiadomosci z drugiego urzadzenia
   *   - nie modyfikowac istniejacej struktury `messages` (UI dziala
   *     na widocznej liscie, tombstones sa tylko metadanymi)
   *
   * Przy kazdym merge union obu list — jesli na jednym urzadzeniu usunieto,
   * a na drugim nie, usuniecie wygrywa (bezpieczniej nie wskrzeszac).
   */
  _deletedMessageIds?: string[]
  _serverCreatedAt?: number
  _serverUpdatedAt?: number
}
