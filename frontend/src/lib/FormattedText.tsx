import React from 'react'
import type { FormattingPatterns, FormattingColors } from './formatting'
import { parseFormattedText, defaultPatterns, defaultColors } from './formatting'
import { sanitizeHtml } from './html'
import HtmlContent from '../components/chat/HtmlContent'

/**
 * Renderuje sformatowane segmenty wiadomości jako JSX.
 * Obsługuje: narrację (kursywa), mowę, monolog wewnętrzny,
 * bloki HTML (sanityzowane, z podglądem obrazów) i zwykły tekst.
 */
export function renderFormattedText(
  raw: string,
  patterns: FormattingPatterns = defaultPatterns,
  colors: FormattingColors = defaultColors,
  onImageClick?: (src: string) => void,
): React.ReactNode {
  const segments = parseFormattedText(raw, patterns)

  return segments.map((seg, idx) => {
    switch (seg.type) {
      case 'narrative':
        return (
          <span key={idx} className="italic" style={{ color: colors.narrative }}>
            {seg.text}
          </span>
        )
      case 'speech':
        return (
          <span key={idx} className="font-medium" style={{ color: colors.speech }}>
            „{seg.text}”
          </span>
        )
      case 'monologue':
        return (
          <span
            key={idx}
            className="rounded bg-surface px-1 py-0.5 font-mono text-[12.5px]"
            style={{ color: colors.monologue }}
          >
            {seg.text}
          </span>
        )
      case 'html':
        return (
          <HtmlContent
            key={idx}
            html={sanitizeHtml(seg.text)}
            onImageClick={onImageClick}
          />
        )
      default:
        return (
          <span key={idx} style={{ color: colors.default }}>
            {seg.text}
          </span>
        )
    }
  })
}
