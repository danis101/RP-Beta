import React from 'react'
import type { FormattingPatterns, FormattedSegment } from './formatting'
import { parseFormattedText, defaultPatterns } from './formatting'

/**
 * Renderuje sformatowane segmenty wiadomości.
 * Oddzielny plik .tsx, bo zwraca JSX (ReactNode).
 */

export function renderFormattedText(
  raw: string,
  patterns: FormattingPatterns = defaultPatterns,
): React.ReactNode {
  const segments = parseFormattedText(raw, patterns)

  return segments.map((seg, idx) => {
    switch (seg.type) {
      case 'narrative':
        return (
          <span key={idx} className="italic text-[#b8bdd0]">
            {seg.text}
          </span>
        )
      case 'speech':
        return (
          <span key={idx} className="text-[#e8e8eb]">
            „{seg.text}”
          </span>
        )
      case 'monologue':
        return (
          <span key={idx} className="rounded bg-surface px-1 py-0.5 font-mono text-[12.5px] text-[#8ab4f8]">
            {seg.text}
          </span>
        )
      default:
        return <span key={idx}>{seg.text}</span>
    }
  })
}
