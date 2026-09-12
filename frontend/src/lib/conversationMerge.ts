/**
 * Merge konwersacji przy konflikcie optimistic lockingu.
 *
 * Scenariusz: A i B maja te sama konwersacje otwarta. A wyslal wiadomosc,
 * zapisal na serwer. B wyslal wiadomosc rownolegle, probuje zapisac -
 * serwer zwraca 409 bo B ma stara wersje. Nie chcemy tracic ani pracy A
 * ani pracy B, wiec scalamy:
 *
 *   - nowsza wersja kazdej wiadomosci po _updatedAt (fallback: timestamp)
 *   - przy remisie wersja serwera; usuniecie zawsze wygrywa z edycja
 *   - nowe wiadomosci z obu urzadzen (po id)
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
import { getMessageUpdatedAt } from './messages'

export function mergeConversations(local: Conversation, remote: Conversation): Conversation {
  // Usuniecie wygrywa nawet z pozniejsza edycja na drugim urzadzeniu.
  // Zachowujemy ID rowniez wtedy, gdy zadna kopia nie ma juz wiadomosci.
  const deletedIds = new Set([
    ...(remote._deletedMessageIds ?? []),
    ...(local._deletedMessageIds ?? []),
  ])
  const messagesById = new Map(remote.messages.map((message) => [message.id, message]))
  for (const message of local.messages) {
    const remoteMessage = messagesById.get(message.id)
    // Przy remisie zachowujemy wersje serwera, takze dla starszych danych.
    // Wybieramy cala wiadomosc razem z wariantami i ich aktywnym indeksem.
    if (!remoteMessage || getMessageUpdatedAt(message) > getMessageUpdatedAt(remoteMessage)) {
      messagesById.set(message.id, message)
    }
  }
  const mergedMessages = [...messagesById.values()].filter(
    (message) => !deletedIds.has(message.id),
  ).sort(
    (a, b) => a.timestamp - b.timestamp,
  )

  return {
    ...remote,
    messages: mergedMessages,
    _deletedMessageIds: [...deletedIds],

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
