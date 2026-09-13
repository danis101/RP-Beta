// Shared by browser and server. No storage, DOM or model-specific configuration.
const REASONING_TAGS = [
  { open: '<think>', close: '</think>' },
  { open: '[think]', close: '[/think]' },
] as const

/** Separates leading reasoning blocks. Once answer text starts, all text is literal.
 * Buffers only a possible tag prefix, including when SSE splits a tag across chunks.
 */
export class ReasoningParser {
  private buffer = ''
  private closingTag: string | undefined
  private inAnswer = false

  constructor(
    private onContent: (text: string) => void,
    private onThinking: (text: string) => void,
  ) {}

  push(text: string): void {
    this.buffer += text
    while (this.buffer) {
      if (this.inAnswer) {
        this.onContent(this.buffer)
        this.buffer = ''
        return
      }
      if (!this.closingTag) {
        const prefix = this.buffer.trimStart().toLowerCase()
        const tag = REASONING_TAGS.find(candidate => prefix.startsWith(candidate.open))
        if (tag) {
          this.buffer = this.buffer.trimStart().slice(tag.open.length)
          this.closingTag = tag.close
          continue
        }
        if (!prefix || REASONING_TAGS.some(candidate => candidate.open.startsWith(prefix))) return
        this.inAnswer = true
        continue
      }
      // ASCII-only folding preserves string offsets (e.g. Turkish İ expands in toLowerCase).
      const lower = this.buffer.replace(/[A-Z]/g, letter => letter.toLowerCase())
      const closingIndex = lower.indexOf(this.closingTag)
      if (closingIndex >= 0) {
        if (closingIndex) this.onThinking(this.buffer.slice(0, closingIndex))
        this.buffer = this.buffer.slice(closingIndex + this.closingTag.length)
        this.closingTag = undefined
        continue
      }
      let keep = Math.min(this.closingTag.length - 1, this.buffer.length)
      while (keep > 0 && !this.closingTag.startsWith(lower.slice(-keep))) keep--
      const ready = this.buffer.slice(0, this.buffer.length - keep)
      if (ready) this.onThinking(ready)
      this.buffer = this.buffer.slice(this.buffer.length - keep)
      return
    }
  }

  finish(): void {
    if (this.buffer) {
      // Interrupted reasoning remains reasoning, including an incomplete closing tag.
      if (this.closingTag) this.onThinking(this.buffer)
      else this.onContent(this.buffer)
      this.buffer = ''
    }
  }
}

/** Backends use different names for the dedicated reasoning field. */
export function readReasoning(message: Record<string, unknown> | undefined): string {
  for (const key of ['reasoning_content', 'reasoning', 'thinking']) {
    const value = message?.[key]
    if (typeof value === 'string' && value.length) return value
  }
  return ''
}
