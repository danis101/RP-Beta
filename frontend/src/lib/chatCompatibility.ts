import type { OpenAIMessage } from '../services/api/OpenAIAdapter'

/** Laczy bloki tekstowe, nie gubiac czesci multimodalnych ani ich kolejnosci. */
function joinContent(left: OpenAIMessage['content'], right: OpenAIMessage['content']): OpenAIMessage['content'] {
  if (typeof left === 'string' && typeof right === 'string') return `${left}\n\n${right}`
  const asParts = (content: OpenAIMessage['content']) =>
    typeof content === 'string' ? [{ type: 'text', text: content }] : content
  return [...asParts(left), { type: 'text', text: '\n\n' }, ...asParts(right)]
}

/** Wspolny format zadania, niezalezny od nazwy modelu.
 * - Poczatkowe systemy tworza jeden blok.
 * - Pozniejsze systemy staja sie instrukcjami user na tej samej pozycji.
 * - Sasiednie zwykle wiadomosci tej samej roli sa scalane.
 * - Wywolania narzedzi i wyniki sa granicami, przez ktore nie scalamy.
 * Uruchamiac po dodaniu wszystkich instrukcji i wynikow narzedzi.
 * Nie zmienia zapisanej historii ani wejsciowych obiektow.
 */
export function prepareChatMessages(
  messages: readonly OpenAIMessage[],
  characterName: string,
): OpenAIMessage[] {
  const result: OpenAIMessage[] = []
  let hasConversationTurn = false
  for (const source of messages) {
    const role = source.role === 'system' && hasConversationTurn ? 'user' : source.role
    if (role !== 'system') hasConversationTurn = true
    const message = { ...source, role }
    const previous = result[result.length - 1]
    if (previous?.role === role && (role === 'system' || role === 'user' || role === 'assistant') &&
        !previous.tool_calls?.length && !message.tool_calls?.length &&
        !previous.tool_call_id && !message.tool_call_id) {
      result[result.length - 1] = { ...previous, content: joinContent(previous.content, message.content) }
    } else {
      result.push(message)
    }
  }

  const firstTurn = result.findIndex(message => message.role !== 'system')
  const startMessage = { role: 'user', content: `Start new chat as ${characterName}.` }
  if (firstTurn < 0) {
    // Regeneracja pierwszego powitania moze miec tylko opis postaci, bez historii.
    result.push(startMessage)
  } else if (result[firstTurn].role === 'assistant') {
    result.splice(firstTurn, 0, startMessage)
  }
  return result
}
