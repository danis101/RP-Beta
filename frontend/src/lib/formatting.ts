/**
 * Formatowanie tekstu w wiadomościach.
 *
 * Obsługuje segmenty:
 * - narracja: *tekst*
 * - mowa: "tekst"
 * - monolog wewnętrzny: `tekst`
 * - blok HTML: <img ...>, <div>...</div> (bezpiecznie renderowany osobno)
 * - default: zwykły tekst
 *
 * Wzorce i kolory są konfigurowalne w Ustawieniach > Formatowanie.
 */

export interface FormattingPatterns {
  narrative: { start: string; end: string }
  speech: { start: string; end: string }
  monologue: { start: string; end: string }
}

export interface FormattingColors {
  narrative: string
  speech: string
  monologue: string
  default: string
}

export const defaultPatterns: FormattingPatterns = {
  narrative: { start: '*', end: '*' },
  speech: { start: '"', end: '"' },
  monologue: { start: '`', end: '`' },
}

export const defaultColors: FormattingColors = {
  narrative: '#b8bdd0',
  speech: '#f2f2f4',
  monologue: '#8ab4f8',
  default: '#e8e8eb',
}

export type SegmentType = 'narrative' | 'speech' | 'monologue' | 'html' | 'default'

export interface FormattedSegment {
  type: SegmentType
  text: string
}

/** Tagi HTML bez wymaganego domknięcia. */
const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link'])

/**
 * Wyciąga pojedynczy element HTML zaczynający się w `pos`.
 * Obsługuje tagi samodomykające, void oraz pary otwierający/zamykający.
 */
function extractHtmlElement(raw: string, pos: number): { end: number; text: string } | null {
  const tagEnd = raw.indexOf('>', pos)
  if (tagEnd === -1) return null

  const tagMatch = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)/.exec(raw.slice(pos))
  if (!tagMatch) return null

  const isClosing = tagMatch[1] === '/'
  const tagName = tagMatch[2].toLowerCase()

  if (isClosing) {
    return { end: tagEnd + 1, text: raw.slice(pos, tagEnd + 1) }
  }

  const openingTag = raw.slice(pos, tagEnd + 1)

  if (/\/>\s*$/.test(openingTag) || VOID_TAGS.has(tagName)) {
    return { end: tagEnd + 1, text: openingTag }
  }

  const closeTag = `</${tagName}>`
  const closeIdx = raw.indexOf(closeTag, tagEnd + 1)
  if (closeIdx === -1) {
    return { end: tagEnd + 1, text: openingTag }
  }

  return { end: closeIdx + closeTag.length, text: raw.slice(pos, closeIdx + closeTag.length) }
}

/**
 * Dzieli surowy tekst na segmenty wg wzorców.
 * Kolejność sprawdzania: HTML, monolog, mowa, narracja.
 */
export function parseFormattedText(
  raw: string,
  patterns: FormattingPatterns = defaultPatterns,
): FormattedSegment[] {
  const segments: FormattedSegment[] = []
  let buffer = ''
  let i = 0

  const tryMatch = (pos: number, start: string, end: string): { end: number; text: string } | null => {
    if (!start || !end) return null
    if (!raw.startsWith(start, pos)) return null
    const searchFrom = pos + start.length
    const endIdx = raw.indexOf(end, searchFrom)
    if (endIdx === -1) return null
    return { end: endIdx + end.length, text: raw.slice(searchFrom, endIdx) }
  }

  const flushBuffer = () => {
    if (buffer) {
      segments.push({ type: 'default', text: buffer })
      buffer = ''
    }
  }

  while (i < raw.length) {
    // 1. Blok HTML
    if (raw[i] === '<') {
      const html = extractHtmlElement(raw, i)
      if (html) {
        flushBuffer()
        segments.push({ type: 'html', text: html.text })
        i = html.end
        continue
      }
    }

    // 2. Monolog wewnętrzny
    const mono = tryMatch(i, patterns.monologue.start, patterns.monologue.end)
    if (mono) {
      flushBuffer()
      segments.push({ type: 'monologue', text: mono.text })
      i = mono.end
      continue
    }

    // 3. Mowa
    const speech = tryMatch(i, patterns.speech.start, patterns.speech.end)
    if (speech) {
      flushBuffer()
      segments.push({ type: 'speech', text: speech.text })
      i = speech.end
      continue
    }

    // 4. Narracja
    const narr = tryMatch(i, patterns.narrative.start, patterns.narrative.end)
    if (narr) {
      flushBuffer()
      segments.push({ type: 'narrative', text: narr.text })
      i = narr.end
      continue
    }

    buffer += raw[i]
    i++
  }

  flushBuffer()

  return segments
}
