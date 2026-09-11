/**
 * Merge konwersacji przy konflikcie optimistic lockingu.
 *
 * Scenariusz: A i B maja te sama konwersacje otwarta. A wyslal wiadomosc,
 * zapisal na serwer. B wyslal wiadomosc rownolegle, probuje zapisac -
 * serwer zwraca 409 bo B ma stara wersje. Nie chcemy tracic ani pracy A
 * ani pracy B, wiec scalamy:
 *
 *   - wiadomosci z serwera (A)
 *   - + wiadomosci z B ktorych nie ma na serwerze (po id)
 *   - sortowane po timestamp
 *
 * Ustawienia konwersacji (personaId, styleId, lorebookIds): wygrywa B
 * (bo user przed chwila cos zmienil). Long-term memory: wygrywa ta wersja
 * ktora ma wiecej wpisow (bogatsza historia).
 *
 * Zwrocona konwersacja ma `_serverUpdatedAt` z remote (swiezy timestamp),
 * zeby retry z nowym `_expectedUpdatedAt` mial szanse przejsc.
 */

import type { Conversation } from '../types'

export function mergeConversations(local: Conversation, remote: Conversation): Conversation {
  const remoteIds = new Set(remote.messages.map((m) => m.id))

  // Wiadomosci lokalne ktorych nie ma na serwerze (nowe z tego urzadzenia).
  const localOnlyMessages = local.messages.filter((m) => !remoteIds.has(m.id))

  // Laczymy i sortujemy po timestamp (najstarsze pierwsze).
  const mergedMessages = [...remote.messages, ...localOnlyMessages].sort(
    (a, b) => a.timestamp - b.timestamp,
  )

  return {
    ...remote,
    messages: mergedMessages,

    // Ustawienia konwersacji - preferujemy lokalne (user wlasnie zmienil).
    // `??` dziala tak, ze jesli local ma undefined, bierzemy z remote.
    personaId: local.personaId ?? remote.personaId,
    styleId: local.styleId ?? remote.styleId,
    lorebookIds: local.lorebookIds ?? remote.lorebookIds,

    // Long-term memory: wybieramy bogatsza historie.
    longTermMemory:
      local.longTermMemory.length >= remote.longTermMemory.length
        ? local.longTermMemory
        : remote.longTermMemory,
    lastSummarizedIndex: Math.max(local.lastSummarizedIndex, remote.lastSummarizedIndex),

    // Server-assigned metadane: z remote (swieze).
    _serverCreatedAt: remote._serverCreatedAt,
    _serverUpdatedAt: remote._serverUpdatedAt,
  }
}
