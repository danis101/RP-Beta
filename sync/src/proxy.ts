/**
 * Proxy dla zewnętrznych usług (LLM, SearXNG, mostek obrazów).
 *
 * Dlaczego to istnieje:
 *   Produkcja chodzi po HTTPS (reverse proxy z SSL). LM Studio, SearXNG
 *   i mostek ComfyUI chodzą po HTTP. Bezpośrednie wołanie HTTP z HTTPS
 *   strony to mixed content — przeglądarka blokuje.
 *
 *   Rozwiązanie: frontend woła ten sam origin (`/llm-proxy/...`,
 *   `/searxng-proxy/...`, `/images-proxy/...`), backend (Bun) przekazuje
 *   żądanie do docelowego serwera, którego adres podany jest w nagłówku
 *   `X-LLM-Target` / `X-SearXNG-Target` / `X-Image-Target`.
 *
 *   Ten sam mechanizm działał w dev (Vite proxy plugin). Tu jest jego
 *   produkcyjny odpowiednik — Hono/Bun. Frontend nie musi wiedzieć, na
 *   jakim środowisku działa — zawsze woła względne ścieżki.
 *
 * Bezpieczeństwo:
 *   Endpointy nie wymagają JWT. Uzasadnienie: aplikacja jest projektowana
 *   do LAN/VPN, wejście po HTTPS jest już za reverse proxy, a proxy nie
 *   jest otwarte (wymaga podania targetu w nagłówku). Auth tutaj
 *   komplikowałby sprawę: przeglądarka wysyła `Authorization` do LM Studio
 *   (klucz API), a my nie chcemy mieszać go z JWT sync.
 */

import type { Context } from 'hono'
import type { AppEnv } from './auth'

/** Nagłówki, których NIE przekazujemy do backendu docelowego (hop-by-hop). */
const SKIP_REQ_HEADERS = new Set([
  'host',
  'origin',
  'referer',
  'connection',
  'content-length',
])

/**
 * Nagłówki, których NIE przekazujemy z powrotem do klienta.
 * `content-encoding` i `content-length` — Bun/undici automatycznie
 * dekompresuje ciało odpowiedzi, więc oryginalne wartości byłyby nieprawdziwe.
 */
const SKIP_RESP_HEADERS = new Set([
  'transfer-encoding',
  'connection',
  'content-length',
  'content-encoding',
])

/** Nagłówki kontrolne proxy — nie forwardujemy ich do celu. */
const PROXY_CONTROL_HEADERS = new Set([
  'x-llm-target',
  'x-searxng-target',
  'x-image-target',
])

/**
 * Buduje handler proxy dla danego prefiksu i nagłówka docelowego.
 *
 * @param prefix      prefiks ścieżki, np. '/llm-proxy'
 * @param targetHeader nazwa nagłówka z adresem docelowym, np. 'x-llm-target'
 */
export function makeProxyHandler(prefix: string, targetHeader: string) {
  return async (c: Context<AppEnv>): Promise<Response> => {
    const rawTarget = (c.req.header(targetHeader) ?? '').trim()
    const targetBase = rawTarget.replace(/\/+$/, '')

    if (!targetBase) {
      return c.json({ error: `Brak nagłówka ${targetHeader} (adres backendu docelowego)` }, 400)
    }

    // Walidacja URL docelowego.
    let parsed: URL
    try {
      parsed = new URL(targetBase)
    } catch {
      return c.json({ error: `Nieprawidłowy adres docelowy: ${targetBase}` }, 400)
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return c.json({ error: `Nieobsługiwany protokół: ${parsed.protocol}` }, 400)
    }

    // Ścieżka po prefiksie + query string.
    const reqPath = c.req.path
    const suffix = reqPath.startsWith(prefix) ? reqPath.slice(prefix.length) : reqPath
    const search = new URL(c.req.url).search
    const targetUrl = targetBase + suffix + search

    // Nagłówki przekazywane do celu — kopiujemy wszystko oprócz hop-by-hop
    // i naszych własnych nagłówków sterujących proxy.
    const forwardHeaders = new Headers()
    for (const [key, value] of c.req.raw.headers) {
      const lower = key.toLowerCase()
      if (SKIP_REQ_HEADERS.has(lower)) continue
      if (PROXY_CONTROL_HEADERS.has(lower)) continue
      forwardHeaders.set(key, value)
    }

    const fetchInit: RequestInit = {
      method: c.req.method,
      headers: forwardHeaders,
      redirect: 'follow',
    }

    // Body dla POST/PUT/PATCH — czytamy jako ArrayBuffer (JSON, nie stream).
    // Chat completions i generacja obrazów używają fixed-length JSON body.
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const bodyBytes = await c.req.arrayBuffer()
      if (bodyBytes.byteLength > 0) {
        fetchInit.body = bodyBytes
      }
    }

    let upstream: Response
    try {
      upstream = await fetch(targetUrl, fetchInit)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(
        `[proxy] ${c.req.method} ${prefix}${suffix} -> ${targetUrl} FAILED: ${msg}`,
      )
      return c.json(
        {
          error: `Nie można połączyć się z ${targetBase}: ${msg}`,
          target: targetUrl,
        },
        502,
      )
    }

    // Nagłówki odpowiedzi — filtrujemy hop-by-hop i content-encoding/length.
    const respHeaders = new Headers()
    for (const [key, value] of upstream.headers) {
      const lower = key.toLowerCase()
      if (SKIP_RESP_HEADERS.has(lower)) continue
      respHeaders.set(key, value)
    }

    // Streaming body → streaming response. SSE z LLM przechodzi bez buforowania,
    // obrazy z mostka też lecą strumieniem.
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
    })
  }
}
