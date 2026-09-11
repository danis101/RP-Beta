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
 *
 * Portret:
 *   - `portraitBlobId` (nowy format) - sha256 bloba na serwerze.
 *   - `portrait` (stary format) - base64 data URL inline. Deprecated.
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

  /** Nowy format: sha256 bloba. Preferowany. */
  portraitBlobId?: string | null
  /** Stary format: base64 data URL. Deprecated. */
  portrait?: string

  /** Pelny oryginalny spec ST z importu. */
  rawSpec?: Record<string, unknown>

  /** Server-assigned metadane do optimistic lockingu. */
  _serverCreatedAt?: number
  _serverUpdatedAt?: number
}

/**
 * Persona uzytkownika.
 *
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

  /** Server-assigned metadane do optimistic lockingu. */
  _serverCreatedAt?: number
  _serverUpdatedAt?: number
}

/** Parametry samplera wysylane do LLM (OpenAI-compatible). */
export interface SamplerParams {
  temperature?: number
  topP?: number
  topK?: number
  frequencyPenalty?: number
  presencePenalty?: number
}

/** Konfiguracja jednego profilu API (zapisana, mozliwa do wyboru). */
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
  visionEnabled: boolean
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

/** Kolejnosc blokow per postac ('' = globalna). */
export interface PromptOrderEntry {
  characterId: string
  order: Array<{ identifier: string; enabled: boolean }>
}

/** Caly styl - jak JSON z TAVO. */
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
  /** Server-assigned metadane do optimistic lockingu. */
  _serverCreatedAt?: number
  _serverUpdatedAt?: number
}

export type MessageRole = 'user' | 'assistant'

/**
 * Tool call (obraz lub websearch).
 *
 * Obraz:
 *   - `imageBlobId` (nowy format) - sha256 bloba. Preferowany.
 *   - `imageUrl` (stary format) - base64 data URL. Deprecated.
 */
export interface ToolCall {
  type: 'image' | 'websearch'
  label: string
  /** Nowy format: sha256 bloba. */
  imageBlobId?: string
  /** Stary format: base64 data URL. Deprecated. */
  imageUrl?: string
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
 * `blobId` (nowy) lub `data` (stary base64, deprecated).
 */
export interface MessageAttachment {
  type: 'image'
  /** Nowy format: sha256 bloba. */
  blobId?: string
  /** Stary format: base64 data URL. Deprecated. */
  data?: string
  name?: string
}

/** Reprezentacja tool call z API */
export interface APIToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

/** Jeden wariant tresci wiadomosci (swipe). */
export interface MessageVariant {
  content: string
  toolCall?: ToolCall
  thinking?: string
  attachments?: MessageAttachment[]
}

/**
 * Wiadomosc w konwersacji.
 * Wiadomosci asystenta moga miec wiele wariantow (regeneracje).
 */
export interface ChatMessage {
  id: string
  role: MessageRole
  variants: MessageVariant[]
  selectedVariant: number
  timestamp: number
}

/** Pojedynczy wpis pamieci dlugotrwalej. */
export interface LongTermMemoryEntry {
  id: string
  content: string
  timestamp: number
  /** Indeks ostatniej wiadomosci, ktora zostala uwzgledniona w tym wpisie. */
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
  /** Server-assigned metadane do optimistic lockingu. */
  _serverCreatedAt?: number
  _serverUpdatedAt?: number
}
