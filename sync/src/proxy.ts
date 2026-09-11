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
 * Bezpieczeństwo (trzy warstwy):
 *
 *   1. AUTH — endpointy proxy są pod `proxyAuthMiddleware`. Wymagają
 *      zalogowanego usera RP. JWT idzie w `X-RP-Auth` (nie `Authorization`,
 *      bo ten jest zarezerwowany na klucz API usługi docelowej).
 *
 *   2. ALLOWLISTA CELÓW — host docelowy musi być na liście `PROXY_ALLOWED_HOSTS`
 *      (jeśli ustawiona) albo być adresem prywatnym (LAN/loopback/link-local,
 *      gdy lista pusta). Publiczne hosty są domyślnie zablokowane — chroni to
 *      przed użyciem serwera jako otwartego SSRF relay do internetu.
 *
 *   3. REDIRECTY — `redirect: 'manual'`. Nie idziemy w ciemno za Location,
 *      bo allowlista targetu nic nie mówi o tym, gdzie redirect prowadzi.
 *
 * Nagłówki kontrolne proxy (`X-LLM-Target`, `X-SearXNG-Target`, `X-Image-Target`,
 * `X-RP-Auth`) są usuwane z forwardowanego żądania i nie trafiają do celu.
 */

import type { Context } from 'hono'
import type { AppEnv } from './auth'
import { PROXY_ALLOWED_HOSTS } from './config'

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

/**
 * Nagłówki kontrolne proxy — nie forwardujemy ich do celu.
 * `x-rp-auth` to nasz JWT sync, nie może wyciec do zewnętrznej usługi.
 */
const PROXY_CONTROL_HEADERS = new Set([
  'x-llm-target',
  'x-searxng-target',
  'x-image-target',
  'x-rp-auth',
])

/**
 * Regex na prywatne / lokalne adresy. Domyślna allowlista, gdy
 * PROXY_ALLOWED_HOSTS nie jest ustawione.
 *
 * Pokrywa:
 *   - hostname "localhost" i dowolny *.localhost
 *   - IPv4 prywatne: 10/8, 172.16/12, 192.168/16
 *   - IPv4 loopback: 127/8
 *   - IPv4 link-local: 169.254/16
 *   - IPv6 loopback ::1, link-local fe80::/10, unique local fc00::/7
 *   - hostname .local (mDNS, typowy dla LAN)
 *   - hostname .lan / .home / .internal (typowo lokalne)
 */
const PRIVATE_HOST_RE = new RegExp(
  '^(' +
    'localhost' +
    '|[a-z0-9-]+\\.localhost' +
    '|127\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}' +
    '|10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}' +
    '|192\\.168\\.\\d{1,3}\\.\\d{1,3}' +
    '|172\\.(1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3}' +
    '|169\\.254\\.\\d{1,3}\\.\\d{1,3}' +
    '|\\[?::1\\]?' +
    '|\\[?fe80:[0-9a-f:]+\\]?' +
    '|\\[?f[cd][0-9a-f]{2}:[0-9a-f:]+\\]?' +
    '|[a-z0-9-]+\\.(local|lan|home|internal)' +
    ')$',
  'i',
)

/**
 * Sprawdza, czy target jest dozwolony.
 *
 * Reguła:
 *   - jeśli PROXY_ALLOWED_HOSTS ustawione: target.host (z portem) LUB target.hostname
 *     musi być dokładnie na liście (lowercase). Publiczne wpisy wtedy działają.
 *   - jeśli puste: host musi pasować do PRIVATE_HOST_RE (tylko LAN/loopback).
 */
function isAllowedTarget(url: URL): boolean {
  const hostWithPort = url.host.toLowerCase()
  const hostOnly = url.hostname.toLowerCase()

  if (PROXY_ALLOWED_HOSTS.length > 0) {
    return (
      PROXY_ALLOWED_HOSTS.includes(hostWithPort) ||
      PROXY_ALLOWED_HOSTS.includes(hostOnly)
    )
  }

  return PRIVATE_HOST_RE.test(hostOnly)
}

/**
 * Buduje handler proxy dla danego prefiksu i nagłówka docelowego.
 *
 * @param prefix       prefiks ścieżki, np. '/llm-proxy'
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

    // --- Allowlista ---
    if (!isAllowedTarget(parsed)) {
      console.warn(
        `[proxy] blocked target ${parsed.host} (not in PROXY_ALLOWED_HOSTS, ` +
          `and not a private address). user=${c.get('userId')}`,
      )
      return c.json(
        {
          error:
            `Cel proxy niedozwolony: ${parsed.host}. ` +
            `Domyślnie dozwolone są tylko adresy prywatne (LAN). ` +
            `Aby dopuścić ten host, dodaj go do PROXY_ALLOWED_HOSTS w .env.`,
          target: parsed.origin,
        },
        403,
      )
    }

    // Ścieżka po prefiksie + query string.
    const reqPath = c.req.path
    const suffix = reqPath.startsWith(prefix) ? reqPath.slice(prefix.length) : reqPath
    const search = new URL(c.req.url).search
    const targetUrl = targetBase + suffix + search

    // Nagłówki przekazywane do celu — kopiujemy wszystko oprócz hop-by-hop
    // i naszych własnych nagłówków sterujących proxy (w tym JWT sync!).
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
      // NIE podążamy automatycznie za redirectami — allowlista dotyczyła
      // tylko pierwotnego targetu, a Location może wskazywać gdziekolwiek.
      redirect: 'manual',
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

    // Redirect — nie idziemy za nim automatycznie. Sprawdzamy Location
    // i jeśli też jest dozwolony, robimy JEDEN hop ręcznie. Dalsze redirecty
    // zwracamy do klienta jako błąd — świadomie, żeby nie zbudować otwartego
    // łańcucha redirectów poza allowlistą.
    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get('location')
      if (!location) {
        return c.json({ error: 'Upstream zwrócił redirect bez Location' }, 502)
      }

      let redirectUrl: URL
      try {
        redirectUrl = new URL(location, targetUrl)
      } catch {
        return c.json({ error: `Nieprawidłowy Location: ${location}` }, 502)
      }

      if (!isAllowedTarget(redirectUrl)) {
        console.warn(
          `[proxy] blocked redirect ${targetUrl} -> ${redirectUrl.host} ` +
            `(not in allowlist). user=${c.get('userId')}`,
        )
        return c.json(
          {
            error:
              `Proxy zablokowało redirect do niedozwolonego hosta: ${redirectUrl.host}. ` +
              `Dodaj go do PROXY_ALLOWED_HOSTS jeśli chcesz dopuścić.`,
            target: targetUrl,
          },
          403,
        )
      }

      try {
        const upstream2 = await fetch(redirectUrl.toString(), fetchInit)
        // Dalsze redirecty — zwracamy do klienta, nie goniąc dalej.
        if (upstream2.status >= 300 && upstream2.status < 400) {
          return c.json(
            {
              error:
                'Proxy nie podąża za łańcuchem redirectów. ' +
                'Skontaktuj się z administratorem jeśli to wymagane.',
              target: targetUrl,
            },
            502,
          )
        }
        upstream = upstream2
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return c.json(
          { error: `Redirect nie udał się: ${msg}`, target: redirectUrl.toString() },
          502,
        )
      }
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

