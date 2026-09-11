import type { ChatMessage, CharacterCard, Persona, ApiProfile } from '../types'
import type { ApiAdapter } from '../services/api'
import { getContent } from './messages'

/**
 * Buduje prompt dla summarizera.
 * @param messages - wiadomości do podsumowania (zazwyczaj ostatnie N)
 * @param character - karta postaci
 * @param persona - persona użytkownika
 * @param existingSummary - dotychczasowe podsumowanie (jeśli istnieje)
 * @param customPrompt - edytowalny prompt systemowy z ustawień
 */
export function buildSummaryPrompt(
  messages: ChatMessage[],
  character: CharacterCard,
  persona: Persona | undefined,
  existingSummary: string | undefined,
  customPrompt: string,
): { system: string; user: string } {
  const charName = character.name
  const userName = persona?.name ?? 'Użytkownik'

  const historyText = messages
    .map((m) => {
      const role = m.role === 'assistant' ? charName : userName
      const content = getContent(m)
      return `${role}: ${content}`
    })
    .join('\n')

  const existingText = existingSummary?.trim() ? `Aktualne podsumowanie:\n${existingSummary.trim()}\n\n` : ''

  const userPrompt = `${existingText}Oto nowe wiadomości:\n\n${historyText}\n\nZaktualizuj podsumowanie, uwzględniając nowe wydarzenia.`

  return {
    system: customPrompt,
    user: userPrompt,
  }
}

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

/**
 * Sprawdza, czy należy wygenerować nowe podsumowanie.
 * @param lastSummarizedIndex - indeks ostatniej podsumowanej wiadomości
 * @param currentMessageCount - aktualna liczba wiadomości
 * @param threshold - próg nowych wiadomości od ostatniego podsumowania
 */
export function shouldSummarize(
  lastSummarizedIndex: number,
  currentMessageCount: number,
  threshold: number,
): boolean {
  return currentMessageCount - 1 - lastSummarizedIndex >= threshold
}
