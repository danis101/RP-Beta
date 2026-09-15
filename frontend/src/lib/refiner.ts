import type { ChatMessage, CharacterCard, Persona } from '../types'
import type { ApiAdapter } from '../services/api'
import { getContent } from './messages'
import { estimateRefinerTokens, refinerInputBudget, assertRefinerBudget } from '../../../shared/llm/refinerBudget'

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
  /** Context window of the selected API profile, including output tokens. */
  contextLength?: number
  maxTokens?: number
  /**
   * Wymuszony styl obrazu dla tej rozmowy (z listy `imageGenCustomStyles`
   * w Settings). Pusty/undefined = brak wymuszenia.
   */
  imageStyleDirective?: string
}


/**
 * Buduje kompaktowy opis karty — tylko to, co potrzebne do wygenerowania
 * wizerunku.
 */
function buildCompactCard(card: CharacterCard): string {
  const parts: string[] = []

  const push = (label: string, value: string | undefined) => {
    const v = value?.trim()
    if (v) parts.push(`${label}: ${v}`)
  }

  push('Imię', card.name)
  push('Opis', card.description)
  push('Osobowość', card.personality)
  push('Scenariusz', card.scenario)

  const entries = card.characterBook?.entries ?? []
  if (entries.length > 0) {
    const snippets: string[] = []
    for (const entry of entries) {
      const content = entry.content?.trim()
      if (content) snippets.push(`- ${content}`)
    }
    if (snippets.length > 0) {
      parts.push(`Kontekst świata:\n${snippets.join('\n')}`)
    }
  }

  return parts.join('\n\n')
}

function buildCompactPersona(persona: Persona | undefined): string | undefined {
  if (!persona) return undefined
  const description = persona.description?.trim()
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
  for (const m of recent) {
    const role = m.role === 'assistant' ? character.name : (persona?.name ?? 'Użytkownik')
    const content = getContent(m).trim()
    if (!content) continue
    const line = `${role}: ${content}`
    lines.push(line)
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
  const budget = refinerInputBudget(ctx.contextLength, ctx.maxTokens)
  // Drop only whole oldest messages. Never silently cut descriptions or the
  // newest turn; that can change the scene being illustrated.
  let history = ctx.history.slice(-Math.max(1, ctx.contextMessages))
  while (true) {
    const messages = assembleRefinerMessages({ ...ctx, history }, systemPrompt)
    if (estimateRefinerTokens(messages[0].system + messages[0].user) <= budget) return messages
    // Validate only when the refiner actually runs. Merely enabling the image
    // tool must not prevent an ordinary text answer from starting.
    if (history.length <= 1) return messages
    history = history.slice(1)
  }
}

function assembleRefinerMessages(ctx: RefineContext, systemPrompt: string): { system: string; user: string }[] {
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
  assertRefinerBudget(req.system + req.user, ctx.contextLength, ctx.maxTokens)

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
