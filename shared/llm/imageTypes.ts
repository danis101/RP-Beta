import type { SearchToolCall } from './webSearch'

export interface ImageInput {
  /** Regeneration uses the exact prompt stored in the selected image variant. */
  prompt?: string
  refinerProfileId?: string
  refinerMessages?: Array<{ role: 'system' | 'user'; content: string }>
}
export interface ImageToolCall {
  type: 'image'
  label: string
  status: 'done' | 'generating' | 'error'
  prompt?: string
  imageBlobId?: string
  error?: string
}
export type WorkflowToolCall = SearchToolCall | ImageToolCall

export const imageDeclaration = {
  type: 'function' as const,
  function: {
    name: 'generate_image',
    description: 'Generate an image of the current scene or character described in the conversation. Use this when the story calls for a visual of what is happening or how the character currently looks.',
    parameters: { type: 'object' as const, properties: { description: { type: 'string', description: 'Short description of what should be depicted: the character, their current outfit/pose, and the scene. Be concrete.' } }, required: ['description'] },
  },
}
