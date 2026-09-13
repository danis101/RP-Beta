import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

/**
 * Proxy dla developmentu — rozwiązuje problem CORS dla LLM, SearXNG i mostka obrazów.
 *
 * Przeglądarka woła `/llm-proxy/...`, `/searxng-proxy/...` lub `/images-proxy/...`
 * (ten sam origin co Vite), a Vite (Node) przesyła żądanie do docelowego serwera,
 * który podajemy w nagłówku `X-LLM-Target`, `X-SearXNG-Target` lub `X-Image-Target`.
 *
 * Dzięki temu frontend działa z backendem w sieci lokalnej bez konfigurowania CORS.
 * W produkcji (Tauri) adapter łączy się bezpośrednio.
 */

interface ProxyRoute {
  prefix: string
  header: string
}

const PROXY_ROUTES: ProxyRoute[] = [
  { prefix: '/llm-proxy', header: 'x-llm-target' },
  { prefix: '/searxng-proxy', header: 'x-searxng-target' },
  { prefix: '/images-proxy', header: 'x-image-target' },
]

const SKIP_REQ_HEADERS = ['host', 'origin', 'referer', 'connection']
const SKIP_RESP_HEADERS = ['transfer-encoding', 'connection', 'content-length']

/**
 * Wyciąga czytelny powód błędu fetch z undici.
 * `fetch failed` sam w sobie nic nie mówi — `cause` zawiera zwykle
 * ENOTFOUND / ECONNREFUSED / ETIMEDOUT / self-signed itp.
 */
function describeFetchError(err: unknown): { message: string; cause?: string; code?: string } {
  if (!(err instanceof Error)) {
    return { message: String(err) }
  }
  const message = err.message
  const cause = (err as Error & { cause?: unknown }).cause
  if (cause instanceof Error) {
    const causeWithCode = cause as Error & { code?: string }
    return { message, cause: cause.message, code: causeWithCode.code }
  }
  if (cause !== undefined) {
    return { message, cause: String(cause) }
  }
  return { message }
}

function proxyPlugin(): Plugin {
  return {
    name: 'proxy-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''

        const route = PROXY_ROUTES.find((r) => url.startsWith(r.prefix))
        if (!route) {
          next()
          return
        }

        const targetBase = req.headers[route.header] as string | undefined
        if (!targetBase) {
          res.statusCode = 400
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: `Missing ${route.header} header` }))
          return
        }

        const path = url.replace(route.prefix, '')
        const cleanBase = targetBase.replace(/\/+$/, '')
        const targetUrl = cleanBase + path

        // Przekazujemy nagłówki z pominięciem tych, które łamią proxy.
        const headers = new Headers()
        for (const [key, value] of Object.entries(req.headers)) {
          const lower = key.toLowerCase()
          if (SKIP_REQ_HEADERS.includes(lower)) continue
          if (lower.startsWith('x-llm-target') || lower.startsWith('x-searxng-target') || lower.startsWith('x-image-target')) continue
          if (typeof value === 'string') headers.set(key, value)
          else if (Array.isArray(value)) headers.set(key, value.join(', '))
        }

        try {
          const fetchInit: RequestInit = {
            method: req.method,
            headers,
            redirect: 'follow',
          }

          if (req.method !== 'GET' && req.method !== 'HEAD') {
            const chunks: Buffer[] = []
            for await (const chunk of req as unknown as AsyncIterable<Buffer>) {
              chunks.push(chunk)
            }
            if (chunks.length > 0) {
              fetchInit.body = Buffer.concat(chunks)
            }
          }

          const upstream = await fetch(targetUrl, fetchInit)

          res.statusCode = upstream.status
          for (const [key, value] of upstream.headers.entries()) {
            const lower = key.toLowerCase()
            if (SKIP_RESP_HEADERS.includes(lower)) continue
            res.setHeader(key, value)
          }

          if (upstream.body) {
            const reader = (upstream.body as ReadableStream<Uint8Array>).getReader()
            try {
              while (true) {
                const { done, value } = await reader.read()
                if (done) break
                res.write(value)
              }
            } finally {
              reader.releaseLock()
            }
          }

          res.end()
        } catch (err) {
          const info = describeFetchError(err)

          // Celowy log w konsoli Vite — od razu widać, KTÓRY adres padł i dlaczego.
          console.error(
            `[proxy] ${req.method} ${route.prefix}${path} -> ${targetUrl} failed: ${info.message}${info.cause ? ` (${info.cause})` : ''}`,
          )

          // Podpowiedź operatorska: 127.0.0.1/localhost gdy Vite działa w WSL
          // oznacza WSL, nie Windows — mostek na hoście trzeba wołać po IP LAN.
          const isLoopback = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(cleanBase)
          const hint = isLoopback
            ? ' (Jeśli Vite działa w WSL, a mostek na Windows — użyj adresu IP hosta w sieci LAN, nie localhost/127.0.0.1.)'
            : ''

          res.statusCode = 502
          res.setHeader('content-type', 'application/json')
          res.end(
            JSON.stringify({
              error: `Proxy error: ${info.message}${info.cause ? ` (${info.cause})` : ''}${hint}`,
              target: targetUrl,
              method: req.method,
              code: info.code,
            }),
          )
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), proxyPlugin()],
  server: {
    port: 5173,
    fs: {
      allow: [fileURLToPath(new URL('.', import.meta.url)), fileURLToPath(new URL('../shared', import.meta.url))],
    },
  },
})
