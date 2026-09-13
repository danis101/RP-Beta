import type { ChatMessage, CharacterCard, Persona, ApiProfile } from '../types'
import type { ApiAdapter } from '../services/api'


import { buildSummaryPrompt } from '../../../shared/llm/summary'
export { buildSummaryPrompt, shouldSummarize } from '../../../shared/llm/summary'

/**
 * Generuje podsumowanie historii rozmowy za pomocą LLM.
 * @param messages - wiadomości do podsumowania
 * @param character - karta postaci
 * @param persona - persona użytkownika
 * @param existingSummary - dotychczasowe podsumowanie (jeśli istnieje)
 * @param customPrompt - edytowalny prompt systemowy
 * @param model - model do użycia (jeśli pusty, użyj domyślnego z profilu)
 * @param adapter - adapter API
 * @param profile - profil API (do pobrania modelu domyślnego)
 * @param signal - sygnał abortu
 */
export async function generateSummary(
  messages: ChatMessage[],
  character: CharacterCard,
  persona: Persona | undefined,
  existingSummary: string | undefined,
  customPrompt: string,
  model: string | undefined,
  adapter: ApiAdapter,
  profile: ApiProfile,
  signal?: AbortSignal,
): Promise<string> {
  if (messages.length === 0) return ''

  const { system, user } = buildSummaryPrompt(
    messages,
    character,
    persona,
    existingSummary,
    customPrompt,
  )

  const targetModel = model?.trim() || profile.model
  if (!targetModel) {
    throw new Error('Brak modelu dla summarizera – ustaw model w ustawieniach lub profilu API.')
  }

  try {
    const result = await adapter.sendMessage({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      model: targetModel,
      temperature: 0.3, // niższa temperatura dla zwięzłości
      signal,
    })
    return result.trim()
  } catch (error) {
    console.error('Błąd generowania podsumowania:', error)
    throw error
  }
}
