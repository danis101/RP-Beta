import DOMPurify from 'dompurify'

/**
 * Bezpieczna obsługa HTML osadzonego w wiadomościach kart postaci.
 * Wiele kart (zwłaszcza z chub.ai / SillyTavern) ma w first_mes lub
 * alternate_greetings obrazki i proste formatowanie HTML.
 */

/** Wykrywa, czy tekst zawiera znaczniki HTML. */
export function isHtmlMessage(content: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(content)
}

/** Sanityzuje HTML — usuwa skrypty, niebezpieczne atrybuty i zdarzenia. */
export function sanitizeHtml(content: string): string {
  return DOMPurify.sanitize(content, {
    // Ograniczamy do tego, co faktycznie może się przydać w kartach postaci
    ALLOWED_TAGS: ['div', 'span', 'p', 'br', 'b', 'i', 'em', 'strong', 'u', 's', 'code', 'pre', 'img', 'a', 'ul', 'ol', 'li', 'blockquote', 'hr'],
    ALLOWED_ATTR: ['src', 'alt', 'title', 'href', 'target', 'rel'],
  })
}
