/** Wire-level types. Keep this module independent of React, authentication and storage. */
export interface APIToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface StreamCallbacks {
  onToken: (token: string) => void
  onThinking?: (token: string) => void
  onToolCalls?: (toolCalls: APIToolCall[]) => void
  onDone: () => void
  onError: (error: Error) => void
}
