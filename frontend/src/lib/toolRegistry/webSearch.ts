import type { ToolDef } from './types'
import { searchWeb } from '../tools'
import { searchFollowUp, webSearchDeclaration } from '../../../../shared/llm/webSearch'

/**
 * Narzędzie web_search — wyszukiwanie internetowe (SearXNG).
 * Zachowuje dokładnie dotychczasowe zachowanie: wykonuje wyszukiwanie,
 * zwraca wyniki do wstrzyknięcia w drugi przebieg LLM.
 */
export const webSearchTool: ToolDef = {
  name: 'web_search',
  enabledSetting: 'webSearchEnabled',
  declaration: webSearchDeclaration,
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

    return {
      toolCall: {
        type: 'websearch',
        label: query,
        results,
      },
      message: searchFollowUp(query, results),
      followUp: true,
    }
  },
}
