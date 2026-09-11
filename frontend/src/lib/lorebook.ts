import type { Lorebook, LorebookEntry, ChatMessage } from '../types'
import { getContent } from './messages'

/**
 * Silnik lorebooków (World Info) kompatybilny ze ST/TAVO.
 *
 * Pozycje:
 * - 0 = before_char → wstrzykiwane przed opisem postaci (worldInfoBefore)
 * - 1 = after_char → wstrzykiwane po opisie postaci (worldInfoAfter)
 * - 2 = before → przed historią czatu
 * - 3 = after → po historii czatu (najbliżej końca)
 */

export interface ActivatedLorebook {
  beforeChar: string[]
  afterChar: string[]
  beforeChat: string[]
  afterChat: string[]
}

/** Normalizuje pozycję: akceptuje nazwy ST i kody numeryczne. */
function normalizePosition(position: string | number): number {
  if (typeof position === 'number') return position
  switch (position) {
    case 'before_char':
      return 0
    case 'after_char':
      return 1
    case 'before':
      return 2
    case 'after':
      return 3
    default:
      return 4
  }
}

/** Sprawdza, czy klucz pasuje do tekstu (zwykły lub regex). */
function keyMatches(
  entry: LorebookEntry,
  key: string,
  text: string,
): boolean {
  if (!key) return false

  if (entry.useRegex) {
    try {
      const flags = entry.caseSensitive ? 'g' : 'gi'
      const re = new RegExp(key, flags)
      re.lastIndex = 0
      return re.test(text)
    } catch {
      return false
    }
  }

  if (!entry.caseSensitive) {
    text = text.toLowerCase()
    key = key.toLowerCase()
  }

  if (entry.matchWholeWords) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`\\b${escaped}\\b`, entry.caseSensitive ? '' : 'i')
    return re.test(text)
  }

  return text.includes(key)
}

/** Zwraca treści aktywowanych wpisów, pogrupowane po pozycji. */
export function activateLorebooks(
  lorebooks: Lorebook[],
  messages: ChatMessage[],
): ActivatedLorebook {
  const result: ActivatedLorebook = {
    beforeChar: [],
    afterChar: [],
    beforeChat: [],
    afterChat: [],
  }

  const activatedEntries: Array<{ entry: LorebookEntry; position: number }> = []

  for (const lorebook of lorebooks) {
    const scanDepth = Math.max(1, lorebook.scanDepth || 4)
    const scanMessages = messages.slice(-scanDepth)

    const scanText = scanMessages.map((m) => getContent(m)).join('\n')

    for (const entry of lorebook.entries) {
      if (!entry.enabled) continue

      if (entry.constant) {
        activatedEntries.push({ entry, position: normalizePosition(entry.position) })
        continue
      }

      let matched = false
      for (const key of entry.keys) {
        if (keyMatches(entry, key, scanText)) {
          matched = true
          break
        }
      }

      if (matched) {
        activatedEntries.push({ entry, position: normalizePosition(entry.position) })
      }
    }
  }

  activatedEntries.sort((a, b) => (a.entry.order ?? 0) - (b.entry.order ?? 0))

  for (const { entry, position } of activatedEntries) {
    if (!entry.content?.trim()) continue

    switch (position) {
      case 0:
        result.beforeChar.push(entry.content)
        break
      case 1:
        result.afterChar.push(entry.content)
        break
      case 2:
        result.beforeChat.push(entry.content)
        break
      case 3:
        result.afterChat.push(entry.content)
        break
    }
  }

  return result
}

/** Tworzy pusty lorebook. */
export function defaultLorebook(): Lorebook {
  return {
    id: crypto.randomUUID(),
    name: 'Nowy lorebook',
    description: '',
    scanDepth: 4,
    recursiveScanning: false,
    entries: [],
  }
}

/** Tworzy pusty wpis. */
export function defaultLorebookEntry(): LorebookEntry {
  return {
    id: crypto.randomUUID(),
    keys: [],
    content: '',
    enabled: true,
    constant: false,
    useRegex: false,
    caseSensitive: false,
    matchWholeWords: false,
    position: 3,
    depth: 0,
    order: 0,
  }
}

/**
 * Import wpisu ze specyfikacji ST/TAVO.
 * Normalizuje pole `key`/`keys`, `keysecondary`, `disable`, `order`, `position`.
 * Zapisuje nazwę wpisu (`name` lub `comment`), żeby lista była czytelna.
 */
export function entryFromST(raw: Record<string, unknown>): LorebookEntry {
  const keysRaw = raw.keys ?? raw.key ?? []
  const secondaryRaw = raw.secondary_keys ?? raw.keysecondary ?? []
  const keys = Array.isArray(keysRaw) ? keysRaw.map(String) : [String(keysRaw)]
  const secondaryKeys = Array.isArray(secondaryRaw) ? secondaryRaw.map(String) : []

  const position = normalizePosition((raw.position as string | number) ?? 3)

  return {
    id: crypto.randomUUID(),
    name: raw.name ? String(raw.name) : raw.comment ? String(raw.comment) : undefined,
    keys,
    secondaryKeys,
    content: String(raw.content ?? ''),
    enabled: raw.enabled === true || raw.disable === false || raw.disable === undefined,
    constant: raw.constant === true,
    useRegex: raw.use_regex === true,
    selective: raw.selective === true,
    caseSensitive: raw.case_sensitive === true || raw.caseSensitive === true,
    matchWholeWords: raw.match_whole_words === true || raw.matchWholeWords === true,
    position,
    depth: Number(raw.depth ?? 0) || 0,
    order: Number(raw.order ?? raw.insertion_order ?? raw.display_index ?? 0) || 0,
    probability: typeof raw.probability === 'number' ? raw.probability : undefined,
    sticky: typeof raw.sticky === 'number' ? raw.sticky : undefined,
    cooldown: typeof raw.cooldown === 'number' ? raw.cooldown : undefined,
    delay: typeof raw.delay === 'number' ? raw.delay : undefined,
    raw,
  }
}

/** Import całego lorebooka z różnych formatów ST/TAVO. */
export function lorebookFromRaw(raw: any, fallbackName?: string): Lorebook {
  const entriesRaw = raw.entries ?? raw.character_book?.entries ?? []
  let entries: LorebookEntry[] = []

  if (Array.isArray(entriesRaw)) {
    entries = entriesRaw.map((e) => entryFromST(e as Record<string, unknown>))
  } else if (entriesRaw && typeof entriesRaw === 'object') {
    entries = Object.values(entriesRaw).map((e) => entryFromST(e as Record<string, unknown>))
  }

  return {
    id: crypto.randomUUID(),
    name: fallbackName || String(raw.name ?? 'Importowany lorebook'),
    description: raw.description ? String(raw.description) : undefined,
    scanDepth: Number(raw.scan_depth ?? 4) || 4,
    tokenBudget: raw.token_budget ? Number(raw.token_budget) : undefined,
    recursiveScanning: raw.recursive_scanning === true,
    entries,
  }
}
