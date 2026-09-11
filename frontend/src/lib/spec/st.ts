import type { CharacterCard, CharacterBook } from '../../types'

/**
 * Konwersja między naszym modelem karty a specyfikacją SillyTavern.
 *
 * Cel: import/eksport kart PNG (tEXt chunk "chara") i JSON bez utraty danych.
 * Nieznane pola trzymamy w `rawSpec`, a przy eksporcie nadpisujemy tylko
 * znane nam pola — reszta zostaje nienaruszona.
 */

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((v) => v !== undefined && v !== '') ?? undefined
}

export function cardFromSTSpec(spec: any): CharacterCard {
  const data = spec?.data ?? spec ?? {}

  const uiExt = data.extensions?.rp_frontend as
    | { role?: string; status?: CharacterCard['status']; summary?: string }
    | undefined

  return {
    id: crypto.randomUUID(),
    name: data.name ?? 'Bez nazwy',
    description: firstNonEmpty(data.description),
    personality: firstNonEmpty(data.personality),
    scenario: firstNonEmpty(data.scenario),
    firstMes: firstNonEmpty(data.first_mes),
    mesExample: firstNonEmpty(data.mes_example),
    creatorNotes: firstNonEmpty(data.creator_notes),
    systemPrompt: firstNonEmpty(data.system_prompt),
    postHistoryInstructions: firstNonEmpty(data.post_history_instructions),
    alternateGreetings: Array.isArray(data.alternate_greetings) ? [...data.alternate_greetings] : undefined,
    tags: Array.isArray(data.tags) ? [...data.tags] : undefined,
    creator: firstNonEmpty(data.creator),
    characterVersion: firstNonEmpty(data.character_version),
    extensions: data.extensions ? structuredClone(data.extensions) : undefined,
    characterBook: (data.character_book as CharacterBook | undefined) ?? undefined,
    role: uiExt?.role,
    status: uiExt?.status ?? 'offline',
    summary: uiExt?.summary,
    rawSpec: structuredClone(spec ?? {}),
  }
}

export function cardToSTSpec(card: CharacterCard): any {
  const baseData = (card.rawSpec?.data as Record<string, unknown> | undefined) ?? {}

  const uiExt = {
    ...((card.extensions?.rp_frontend as Record<string, unknown> | undefined) ?? {}),
    role: card.role,
    status: card.status,
    summary: card.summary,
  }

  return {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      ...baseData,
      name: card.name,
      description: card.description ?? '',
      personality: card.personality ?? '',
      scenario: card.scenario ?? '',
      first_mes: card.firstMes ?? '',
      mes_example: card.mesExample ?? '',
      creator_notes: card.creatorNotes ?? '',
      system_prompt: card.systemPrompt ?? '',
      post_history_instructions: card.postHistoryInstructions ?? '',
      alternate_greetings: card.alternateGreetings ?? [],
      tags: card.tags ?? [],
      creator: card.creator ?? '',
      character_version: card.characterVersion ?? '',
      extensions: {
        ...(baseData.extensions as Record<string, unknown> | undefined ?? {}),
        rp_frontend: uiExt,
      },
      character_book: card.characterBook ?? { entries: [] },
    },
  }
}

/** Zwraca JSON spec jako string (do zapisu w tEXt chunk lub pliku .json). */
export function cardToJSON(card: CharacterCard): string {
  return JSON.stringify(cardToSTSpec(card), null, 2)
}

/** Parsuje JSON karty ST (V2 lub V3). */
export function parseSTJSON(raw: string): CharacterCard {
  const spec = JSON.parse(raw)
  return cardFromSTSpec(spec)
}
