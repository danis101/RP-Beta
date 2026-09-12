import type { OpenAIMessage } from '../services/api/OpenAIAdapter'

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
