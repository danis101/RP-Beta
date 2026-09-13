import { readCompletionStream } from '../../../shared/llm/stream'
import { prepareChatMessages } from '../../../shared/llm/chatCompatibility'
import { searchFollowUp, type SearchResult, type SearchToolCall } from '../../../shared/llm/webSearch'
import type { APIToolCall } from '../../../shared/llm/types'
import type { GenerationWorkflow, WorkflowProgress } from './runner'
import type { StartJob } from './store'

export interface SearchWorkflowDependencies {
  messages: StartJob['messages']
  open: (messages: ReturnType<typeof prepareChatMessages>, signal: AbortSignal) => Promise<Response>
  search: (query: string, signal: AbortSignal) => Promise<SearchResult[]>
  enabled: () => boolean
  showResults: boolean
}

/** Existing sequence: initial LLM, sequential searches, at most one follow-up LLM.
 * Tool calls in the follow-up are not executed. No prompt rebuild on reconnect.
 */
export function searchWorkflow(deps: SearchWorkflowDependencies): GenerationWorkflow {
  return async (signal, report) => {
    let state: WorkflowProgress = { content: '', thinking: '', phase: 'model' }
    const emit = () => { signal.throwIfAborted(); report({ ...state }) }
    const model = async (messages: ReturnType<typeof prepareChatMessages>) => {
      let calls: APIToolCall[] = []
      const response = await deps.open(messages, signal)
      await readCompletionStream(response, {
        onToken: text => { state.content += text; emit() },
        onThinking: text => { state.thinking += text; emit() },
        onToolCalls: value => { calls = value }, onError: error => { throw error }, onDone: () => {},
      })
      signal.throwIfAborted()
      return calls
    }
    emit()
    const calls = await model(deps.messages)
    const followUps: ReturnType<typeof searchFollowUp>[] = []
    let lastTool: SearchToolCall | undefined
    try {
      for (const call of calls) {
        signal.throwIfAborted()
        if (call.function.name !== 'web_search' || !deps.enabled()) continue
        let args: Record<string, unknown> = {}
        try { args = JSON.parse(call.function.arguments || '{}') ?? {} } catch { /* same fallback as browser */ }
        const query = typeof args.query === 'string' ? args.query : ''
        state.phase = 'web-search'; emit()
        const results = query.trim() ? await deps.search(query, signal) : []
        signal.throwIfAborted()
        if (!results.length) continue
        lastTool = { type: 'websearch', label: query, results }
        state.toolCall = lastTool
        emit() // Persist results before the next external call.
        followUps.push(searchFollowUp(query, results))
      }
    } catch (error) {
      signal.throwIfAborted()
      state.content += `\n\nBlad wykonania narzedzia: ${error instanceof Error ? error.message : String(error)}`
    }
    if (followUps.length) {
      state = { content: '', thinking: '', phase: 'follow-up', toolCall: lastTool }
      emit()
      // Initial messages are already normalized and contain a user turn.
      await model(prepareChatMessages([...deps.messages, ...followUps], 'Assistant'))
    }
    state.toolCall = deps.showResults ? lastTool : undefined
    return state
  }
}
