/**
 * Podstawianie zmiennych w tekstach kart i person.
 * Obsługuje format SillyTavern i luźniejsze warianty z pojedynczymi klamrami.
 */

export interface TokenContext {
  charName: string
  userName: string
  personaName?: string
}

/** Buduje mapę token -> wartość. Dłuższe ({{...}}) mają pierwszeństwo przed krótszymi. */
function buildTokenMap(ctx: TokenContext): Record<string, string> {
  const personaName = ctx.personaName ?? ctx.userName
  return {
    '{{char}}': ctx.charName,
    '{{user}}': ctx.userName,
    '{{persona}}': personaName,
    '{{Char}}': ctx.charName,
    '{{User}}': ctx.userName,
    '{char}': ctx.charName,
    '{Char}': ctx.charName,
    '{user}': ctx.userName,
    '{User}': ctx.userName,
    '{persona}': personaName,
  }
}

const TOKEN_REGEX = /\{\{(?:[Cc]har|[Uu]ser|[Pp]ersona)\}\}|\{(?:[Cc]har|[Uu]ser|[Pp]ersona)\}/g

/** Podstawia wszystkie rozpoznane tokeny w tekście. */
export function substituteTokens(raw: string, ctx: TokenContext): string {
  if (!raw) return raw
  const map = buildTokenMap(ctx)
  return raw.replace(TOKEN_REGEX, (match) => map[match] ?? match)
}
