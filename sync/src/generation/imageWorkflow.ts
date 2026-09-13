import type { ImageToolCall } from '../../../shared/llm/imageTypes'
import type { ImageGenResult } from '../../../shared/llm/imageGen'
import type { WorkflowProgress } from './runner'

export interface ImageDependencies {
  refine: (signal: AbortSignal) => Promise<string>
  generate: (prompt: string, signal: AbortSignal) => Promise<ImageGenResult>
  save: (blob: Blob, signal: AbortSignal) => Promise<string>
}

/** The prompt is checkpointed before the generator is called; regeneration skips refiner. */
export async function runImage(deps: ImageDependencies, signal: AbortSignal,
  report: (state: WorkflowProgress) => void, savedPrompt?: string, label = 'Wygenerowany obraz'): Promise<ImageToolCall> {
  let tool: ImageToolCall = { type: 'image', label, status: 'generating', prompt: savedPrompt }
  const phase = (value: string) => { signal.throwIfAborted(); report({ content: '', thinking: '', phase: value, toolCall: { ...tool } }) }
  try {
    if (savedPrompt === undefined) {
      phase('refiner')
      tool.prompt = (await deps.refine(signal)).trim()
      if (!tool.prompt) throw new Error('Refiner zwrócił pusty prompt.')
    }
    phase('image-generation')
    const result = await deps.generate(tool.prompt!, signal)
    signal.throwIfAborted()
    if (result.status === 'done') {
      phase('image-save')
      tool.imageBlobId = await deps.save(result.blob, signal)
      signal.throwIfAborted()
      tool.status = 'done'
    } else if (result.status === 'processing') {
      tool.error = 'Mostek zwrócił processing bez gotowego obrazu. Odbiór późniejszego wyniku wymaga obsługi protokołu mostka.'
      // Do not issue a second generation request: its outcome is unknown.
      phase('image-processing')
      throw new Error(tool.error)
    } else {
      tool.status = 'error'; tool.error = result.message
    }
  } catch (error) {
    signal.throwIfAborted()
    if (tool.status === 'generating' && tool.error) throw error
    tool.status = 'error'; tool.error = error instanceof Error ? error.message : String(error)
  }
  phase('image-result')
  return tool
}
