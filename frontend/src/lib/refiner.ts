import type { ChatMessage, CharacterCard, Persona } from '../types'
import type { ApiAdapter } from '../services/api'
import { getContent } from './messages'

/**
 * Prompt-refiner obrazu: zamienia kontekst rozmowy + kartę postaci na
 * czysty „positive prompt” w formacie akceptowanym przez mostek.
 *
 * UWAGA o payloadzie: NIE wysyłamy całej karty jako JSON.stringify(card).
 * Budujemy KOMPAKTOWY opis — tylko pola istotne dla wygenerowania obrazu.
 *
 * imageStyleDirective: opcjonalna wartość wybrana przez usera w menu
 * konwersacji (⋮ → Styl obrazu). Wstawiana jako osobna sekcja w wiadomości
 * do refinera. Refiner ma ja przepisać do tagu [STYLE: ...] na początku
 * promptu. Zero walidacji — user wie co jego mostek akceptuje.
 */

export interface RefineContext {
  character: CharacterCard
  persona?: Persona
  /** Ostatnie wiadomości konwersacji (scena/outfit/sytuacja). */
  history: ChatMessage[]
  /** Ile ostatnich wiadomości uwzględnić. */
  contextMessages: number
  /**
   * Wymuszony styl obrazu dla tej rozmowy (z listy `imageGenCustomStyles`
   * w Settings). Pusty/undefined = brak wymuszenia.
   */
  imageStyleDirective?: string
}

/** Limit znaków na pojedyncze pole karty. */
const FIELD_MAX = 4000
/** Limit łączny znaków na cały opis karty. */
const CARD_BUDGET = 12_000
/** Limit znaków na historię rozmowy. */
const HISTORY_BUDGET = 8_000
/** Limit znaków na pojedynczą wiadomość w historii. */
const MESSAGE_MAX = 1_500
/** Maksymalna liczba wpisów character_book branych pod uwagę. */
const MAX_BOOK_ENTRIES = 20
/** Limit znaków na pojedynczy wpis lorebooka. */
const BOOK_ENTRY_MAX = 400

function truncate(text: string | undefined, max: number): string {
  if (!text) return ''
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return trimmed.slice(0, max) + '…'
}

/**
 * Buduje kompaktowy opis karty — tylko to, co potrzebne do wygenerowania
 * wizerunku.
 */
function buildCompactCard(card: CharacterCard): string {
  const parts: string[] = []

  const push = (label: string, value: string | undefined) => {
    const v = truncate(value, FIELD_MAX)
    if (v) parts.push(`${label}: ${v}`)
  }

  push('Imię', card.name)
  push('Opis', card.description)
  push('Osobowość', card.personality)
  push('Scenariusz', card.scenario)

  const entries = card.characterBook?.entries ?? []
  if (entries.length > 0) {
    const snippets: string[] = []
    for (const entry of entries.slice(0, MAX_BOOK_ENTRIES)) {
      const content = truncate(entry.content, BOOK_ENTRY_MAX)
      if (content) snippets.push(`- ${content}`)
    }
    if (snippets.length > 0) {
      parts.push(`Kontekst świata:\n${snippets.join('\n')}`)
    }
  }

  let out = parts.join('\n\n')
  if (out.length > CARD_BUDGET) {
    out = out.slice(0, CARD_BUDGET) + '…'
  }
  return out
}

function buildCompactPersona(persona: Persona | undefined): string | undefined {
  if (!persona) return undefined
  const description = truncate(persona.description, FIELD_MAX)
  if (!description) return `Imię: ${persona.name}`
  return `Imię: ${persona.name}\n${description}`
}

function buildHistoryText(
  history: ChatMessage[],
  character: CharacterCard,
  persona: Persona | undefined,
  contextMessages: number,
): string {
  const recent = history.slice(-Math.max(1, contextMessages))
  const lines: string[] = []
  let used = 0
  for (const m of recent) {
    const role = m.role === 'assistant' ? character.name : (persona?.name ?? 'Użytkownik')
    const content = truncate(getContent(m), MESSAGE_MAX)
    if (!content) continue
    const line = `${role}: ${content}`
    if (used + line.length > HISTORY_BUDGET) break
    lines.push(line)
    used += line.length
  }
  return lines.join('\n')
}

/**
 * Buduje wiadomości dla refinera: kompaktowy opis karty + ostatnie N wiadomości
 * + opcjonalny wymagany styl od usera.
 */
export function buildImageRefinerMessages(
  ctx: RefineContext,
  systemPrompt: string,
): { system: string; user: string }[] {
  const cardText = buildCompactCard(ctx.character)
  const personaText = buildCompactPersona(ctx.persona)
  const historyText = buildHistoryText(ctx.history, ctx.character, ctx.persona, ctx.contextMessages)

  const sections: string[] = []
  sections.push('KARTA POSTACI:')
  sections.push(cardText || '(brak danych)')

  if (personaText) {
    sections.push('')
    sections.push('PERSONA UŻYTKOWNIKA:')
    sections.push(personaText)
  }

  sections.push('')
  sections.push('OSTATNIE WIADOMOŚCI ROZMOWY (scena, strój, sytuacja):')
  sections.push(historyText || '(brak wiadomości)')

  // Wymuszony styl od usera (menu konwersacji → Styl obrazu).
  // Zero walidacji — user wie co jego mostek akceptuje.
  if (ctx.imageStyleDirective && ctx.imageStyleDirective.trim()) {
    sections.push('')
    sections.push('## WYMAGANY STYL (od usera — MUSISZ to uwzględnić)')
    sections.push('')
    sections.push(`Umieść na SAMYM POCZĄTKU promptu tag: [STYLE: ${ctx.imageStyleDirective.trim()}]`)
    sections.push('Użyj dokładnie tej wartości. Nie zmieniaj jej, nie tłumacz.')
  }

  sections.push('')
  sections.push('Na podstawie powyższego napisz jeden spójny, szczegółowy pozytywny prompt do modelu tekst-do-obraz.')

  return [{ system: systemPrompt, user: sections.join('\n') }]
}

/**
 * Woła refinera i zwraca czysty prompt (lub rzuca błąd).
 */
export async function refineImagePrompt(
  ctx: RefineContext,
  systemPrompt: string,
  adapter: ApiAdapter,
  model?: string,
  signal?: AbortSignal,
): Promise<string> {
  const [req] = buildImageRefinerMessages(ctx, systemPrompt)

  if (import.meta.env.DEV) {
    const totalChars = req.system.length + req.user.length
    console.debug(
      `[refiner] payload: system=${req.system.length} znaków, user=${req.user.length} znaków, razem≈${totalChars} (~${Math.round(totalChars / 3.5)} tokenów)`,
    )
  }

  const result = await adapter.sendMessage({
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ],
    model,
    temperature: 0.6,
    signal,
  })

  const prompt = result.trim()
  if (!prompt) throw new Error('Refiner zwrócił pusty prompt.')

  return prompt
}

