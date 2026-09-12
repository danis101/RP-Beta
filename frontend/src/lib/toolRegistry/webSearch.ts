import type { ToolDef } from './types'
import { searchWeb } from '../tools'

/**
 * Narzędzie web_search — wyszukiwanie internetowe (SearXNG).
 * Zachowuje dokładnie dotychczasowe zachowanie: wykonuje wyszukiwanie,
 * zwraca wyniki do wstrzyknięcia w drugi przebieg LLM.
 */
export const webSearchTool: ToolDef = {
  name: 'web_search',
  enabledSetting: 'webSearchEnabled',
  declaration: {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the internet for up-to-date information. Use this when you need current information, recent events, or specific facts that may not be in your training data.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query. Be specific and include relevant keywords.',
          },
        },
        required: ['query'],
      },
    },
  },
  async run(args, _call, ctx) {
    const query = typeof args.query === 'string' ? args.query : ''
    const results = await searchWeb(
      query,
      ctx.settings.webSearchUrl ?? '',
      (ctx.settings.webSearchMaxResults as number) ?? 5,
      ctx.settings.webSearchApiKey as string | undefined,
      (ctx.settings.webSearchCooldown as number) ?? 1,
    )

    if (results.length === 0) {
      return {}
    }

    const summary = results
      .map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}\n   Źródło: ${r.url}`)
      .join('\n\n')

    return {
      toolCall: {
        type: 'websearch',
        label: query,
        results,
      },
      message: {
        role: 'system',
        content: `[Wyniki wyszukiwania dla: "${query}"]\n\n${summary}\n\nNa podstawie tych informacji, odpowiedz w roli postaci, używając swojego stylu. Nie cytuj surowych wyników – wpleć je naturalnie w odpowiedź.`,
      },
      followUp: true,
    }
  },
}
