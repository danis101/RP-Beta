import type { CharacterCard, Persona, ChatMessage, StyleConfig, PromptBlock } from '../types'
import { getContent } from './messages'

/**
 * Kompozytor promptu wg stylu (TAVO-compatible).
 *
 * - Bloki `system_prompt: true` → jeden długi system prompt.
 * - Bloki `system_prompt: false` → osobne wiadomości (domyślnie `user`)
 *   wstrzykiwane w historię zgodnie z `injection_position` i `injection_depth`.
 * - Markery podmieniane danymi (charDescription, charPersonality, scenario,
 *   personaDescription, dialogueExamples, chatHistory, worldInfoBefore/After,
 *   longTermMemory).
 * - Nieznany marker z własnym `content` → fallback do content (custom autorski).
 * - `prompt_order` nadpisuje kolejność per postać.
 */

const MARKER_KEYS = [
  'worldInfoBefore',
  'personaDescription',
  'charDescription',
  'charPersonality',
  'scenario',
  'dialogueExamples',
  'chatHistory',
  'worldInfoAfter',
  'longTermMemory',
] as const

type MarkerKey = (typeof MARKER_KEYS)[number]

interface TokenContext {
  charName: string
  userName: string
  personaName: string
  charDescription?: string
  charPersonality?: string
  scenario?: string
  personaDescription?: string
  longTermMemory?: string
  date?: string
  time?: string
}

export function substituteStyleTokens(raw: string, ctx: TokenContext): string {
  const date = ctx.date ?? new Date().toLocaleDateString('pl-PL')
  const time = ctx.time ?? new Date().toLocaleTimeString('pl-PL')

  const map: Record<string, string> = {
    '{{char}}': ctx.charName,
    '{{Char}}': ctx.charName,
    '{{user}}': ctx.userName,
    '{{User}}': ctx.userName,
    '{{persona}}': ctx.personaName,
    '{{Persona}}': ctx.personaName,
    '{{description}}': ctx.charDescription ?? '',
    '{{personality}}': ctx.charPersonality ?? '',
    '{{scenario}}': ctx.scenario ?? '',
    '{{persona_description}}': ctx.personaDescription ?? '',
    '{{longTermMemory}}': ctx.longTermMemory ?? '',
    '{{date}}': date,
    '{{time}}': time,
  }

  let out = raw.replace(
    /\{\{(?:[Cc]har|[Uu]ser|[Pp]ersona|description|personality|scenario|persona_description|longTermMemory|date|time)\}\}/g,
    (m) => map[m] ?? m,
  )

  out = out.replace(/\{\{random::([^}]+)\}\}/g, (_, values: string) => {
    const parts = (values as string).split('::').filter(Boolean)
    if (parts.length === 0) return ''
    return parts[Math.floor(Math.random() * parts.length)]
  })

  return out
}

function applyFormat(format: string | undefined, value: string, ctx: TokenContext): string {
  if (!format) return value
  return substituteStyleTokens(format, ctx).replace(/\{\{value\}\}/g, value)
}

/** Zwraca treść markera albo undefined, jeśli źródło jest puste. */
function markerContent(
  key: string,
  style: StyleConfig,
  card: CharacterCard,
  persona: Persona | undefined,
  history: ChatMessage[],
  lorebook: string[],
  ctx: TokenContext,
): string | undefined {
  switch (key as MarkerKey) {
    case 'charDescription':
      return card.description
    case 'charPersonality':
      return applyFormat(style.personalityFormat, card.personality ?? '', ctx)
    case 'scenario':
      return applyFormat(style.scenarioFormat, card.scenario ?? '', ctx)
    case 'personaDescription':
      return persona?.description
    case 'dialogueExamples':
      return card.mesExample
    case 'chatHistory':
      return history
        .map((m) => `${m.role === 'assistant' ? card.name : (persona?.name ?? 'Użytkownik')}: ${getContent(m)}`)
        .join('\n')
    case 'worldInfoBefore':
    case 'worldInfoAfter':
      if (lorebook.length === 0) return undefined
      return style.wiFormat
        ? lorebook.map((e) => style.wiFormat!.replace(/\{0\}/g, e)).join('\n')
        : lorebook.join('\n')
    case 'longTermMemory':
      return ctx.longTermMemory
    default:
      return undefined
  }
}

/** Rozstrzyga treść bloku z fallbackiem dla nieznanych markerów. */
function resolveBlockContent(
  block: PromptBlock,
  style: StyleConfig,
  card: CharacterCard,
  persona: Persona | undefined,
  history: ChatMessage[],
  lorebook: string[],
  ctx: TokenContext,
): string | null {
  if (!block.marker) {
    const content = block.content ?? ''
    return content.trim() ? content : null
  }

  const replaced = markerContent(block.identifier, style, card, persona, history, lorebook, ctx)

  if (replaced) return replaced

  // Fallback: nieznany marker z własną treścią — nie gubimy danych autora.
  const fallback = block.content ?? ''
  return fallback.trim() ? fallback : null
}

function orderedBlocks(style: StyleConfig, characterId: string): PromptBlock[] {
  const orderEntry = style.promptOrder?.find((o) => o.characterId === characterId || String(o.characterId) === characterId)
  if (!orderEntry || !orderEntry.order || orderEntry.order.length === 0) {
    return style.prompts
  }

  const byIdentifier = new Map(style.prompts.map((b) => [b.identifier, b]))
  const ordered: PromptBlock[] = []

  for (const orderItem of orderEntry.order) {
    const block = byIdentifier.get(orderItem.identifier)
    if (block) {
      ordered.push({ ...block, enabled: orderItem.enabled ?? block.enabled })
    }
  }

  for (const block of style.prompts) {
    if (!orderEntry.order.some((o) => o.identifier === block.identifier)) {
      ordered.push(block)
    }
  }

  return ordered
}

/** Buduje system prompt z bloków `system_prompt: true`. */
export function buildStyledSystemPrompt(
  style: StyleConfig,
  card: CharacterCard,
  persona?: Persona,
  history: ChatMessage[] = [],
  lorebook: string[] = [],
  longTermMemory?: string,
): string | undefined {
  const blocks = orderedBlocks(style, card.id)
  const ctx: TokenContext = {
    charName: card.name,
    userName: persona?.name ?? 'Użytkownik',
    personaName: persona?.name ?? 'Użytkownik',
    charDescription: card.description,
    charPersonality: card.personality,
    scenario: card.scenario,
    personaDescription: persona?.description,
    longTermMemory,
  }

  const parts: string[] = []

  for (const block of blocks) {
    if (!block.enabled) continue
    if (!block.systemPrompt) continue

    const content = resolveBlockContent(block, style, card, persona, history, lorebook, ctx)
    if (!content) continue

    const substituted = substituteStyleTokens(content, ctx)
    if (substituted.trim()) parts.push(substituted.trim())
  }

  return parts.length > 0 ? parts.join('\n\n') : undefined
}

export interface ChatInjection {
  role: 'user' | 'assistant' | 'system'
  content: string
  beforeIndex: number
}

/** Zwraca wiadomości do wstrzyknięcia w historię (bloki `system_prompt: false`). */
export function getStyledChatInjections(
  style: StyleConfig,
  card: CharacterCard,
  persona: Persona | undefined,
  history: ChatMessage[],
  lorebook: string[] = [],
  longTermMemory?: string,
): ChatInjection[] {
  const blocks = orderedBlocks(style, card.id)
  const ctx: TokenContext = {
    charName: card.name,
    userName: persona?.name ?? 'Użytkownik',
    personaName: persona?.name ?? 'Użytkownik',
    charDescription: card.description,
    charPersonality: card.personality,
    scenario: card.scenario,
    personaDescription: persona?.description,
    longTermMemory,
  }

  const injections: ChatInjection[] = []

  for (const block of blocks) {
    if (!block.enabled) continue
    if (block.systemPrompt) continue

    const content = resolveBlockContent(block, style, card, persona, history, lorebook, ctx)
    if (!content) continue

    const substituted = substituteStyleTokens(content, ctx)
    if (!substituted.trim()) continue

    const depth = block.injectionDepth ?? 0
    const position = block.injectionPosition ?? 0
    const beforeIndex = position === 0
      ? Math.max(0, history.length - depth)
      : Math.min(history.length, history.length - depth + 1)

    injections.push({
      role: block.role === 'assistant' ? 'assistant' : block.role === 'system' ? 'system' : 'user',
      content: substituted,
      beforeIndex,
    })
  }

  injections.sort((a, b) => a.beforeIndex - b.beforeIndex)

  return injections
}

export function defaultStyle(): StyleConfig {
  return {
    prompts: [],
    promptOrder: [],
  }
}
