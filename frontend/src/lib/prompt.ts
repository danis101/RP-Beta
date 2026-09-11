import type { CharacterCard, Persona } from '../types'
import { substituteTokens } from './tokens'

/**
 * Buduje system prompt z karty postaci i persony.
 * Wszystkie tokeny ({char}, {user}, {{user}} itd.) są podstawiane.
 * Persona jest dokładana jako sekcja [Użytkownik], żeby AI miało punkt odniesienia.
 */
export function buildSystemPrompt(card: CharacterCard, persona?: Persona): string {
  const tokenCtx = {
    charName: card.name,
    userName: persona?.name ?? 'Użytkownik',
    personaName: persona?.name ?? 'Użytkownik',
  }

  const parts: string[] = []

  const push = (label: string | undefined, value: string | undefined) => {
    if (value?.trim()) {
      const substituted = substituteTokens(value.trim(), tokenCtx)
      parts.push(label ? `[${label}]\n${substituted}` : substituted)
    }
  }

  push('Charakter', card.description)
  push('Osobowość', card.personality)
  push('Scenariusz', card.scenario)

  if (persona?.description?.trim()) {
    const personaDescription = substituteTokens(persona.description.trim(), tokenCtx)
    parts.push(`[Użytkownik]\nImię: ${persona.name}\n${personaDescription}`)
  }

  push('Przykłady wiadomości', card.mesExample)
  push(undefined, card.systemPrompt)

  return parts.join('\n\n')
}
