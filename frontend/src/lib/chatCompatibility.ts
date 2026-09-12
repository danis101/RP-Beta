import type { OpenAIMessage } from '../services/api/OpenAIAdapter'

/** Scala tylko poczatkowe instrukcje systemowe, zachowujac kolejnosc blokow.
 * Instrukcje w srodku historii pozostaja na swoich pozycjach.
 */
export function mergeInitialSystemMessages(
  messages: OpenAIMessage[],
  enabled: boolean | undefined,
): OpenAIMessage[] {
  if (!enabled) return messages
  let count = 0
  while (count < messages.length && messages[count].role === 'system' && typeof messages[count].content === 'string') count++
  if (count < 2) return messages
  return [
    { role: 'system', content: messages.slice(0, count).map(message => message.content).join('\n\n') },
    ...messages.slice(count),
  ]
}

/** Uzupelnia tylko brakujaca ture user przed poczatkowym powitaniem postaci.
 * Nie zmienia historii, instrukcji systemowych ani sekwencji narzedzi.
 */
export function addInitialUserMessage(
  messages: OpenAIMessage[],
  enabled: boolean | undefined,
  characterName: string,
): OpenAIMessage[] {
  if (!enabled) return messages
  const firstTurn = messages.findIndex(message => message.role !== 'system')
  if (firstTurn < 0 || messages[firstTurn].role !== 'assistant' || messages[firstTurn].tool_calls?.length) {
    return messages
  }
  return [
    ...messages.slice(0, firstTurn),
    { role: 'user', content: `Start new chat as ${characterName}.` },
    ...messages.slice(firstTurn),
  ]
}
