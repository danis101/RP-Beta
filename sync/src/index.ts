/**
 * RP Sync - backend + serwowanie statykow frontendu.
 *
 * Stack: Bun + Hono + bun:sqlite.
 * Auth: JWT (HS256), hasla argon2id, konta tworzone przez admina.
 * Realtime: WebSocket push o zmianach encji i ustawien.
 * Bloby: content-addressed (sha256), dedup per-user, GC co 24h.
 * Proxy: /llm-proxy, /searxng-proxy, /images-proxy - posredniczy do uslug HTTP
 *        (LM Studio, SearXNG, mostek ComfyUI) z HTTPS strony.
 *
 * W trybie produkcyjnym (Docker) serwuje tez statyki frontendu z ./public.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { upgradeWebSocket, websocket } from 'hono/bun'
import { serveStatic } from 'hono/bun'
import { existsSync } from 'node:fs'
import { authRoutes } from './routes/auth'
import { blobsRoutes } from './routes/blobs'
import { createEntityRoutes } from './routes/entities'
import { adminRoutes } from './routes/admin'
import { settingsRoutes } from './routes/settings'
import { makeProxyHandler } from './proxy'
import { verifyToken, type AppEnv } from './auth'
import { register, unregister, connectionStats } from './ws'
import { PORT } from './config'
import { seedAdminIfNeeded } from './seed'
import { startGcLoop } from './gc'

import './db'

const app = new Hono<AppEnv>()

app.use('*', logger())
app.use(
  '*',
  cors({
    origin: '*',
    allowHeaders: [
      'Authorization',
      'Content-Type',
      'X-LLM-Target',
      'X-SearXNG-Target',
      'X-Image-Target',
    ],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
    exposeHeaders: ['Content-Length', 'Content-Type', 'ETag', 'Retry-After'],
  }),
)

app.get('/health', (c) => {
  return c.json({
    ok: true,
    version: '0.3.2',
    ws: connectionStats(),
    time: new Date().toISOString(),
  })
})

// --- Proxy do uslug zewnetrznych ---
app.all('/llm-proxy/*', makeProxyHandler('/llm-proxy', 'x-llm-target'))
app.all('/searxng-proxy/*', makeProxyHandler('/searxng-proxy', 'x-searxng-target'))
app.all('/images-proxy/*', makeProxyHandler('/images-proxy', 'x-image-target'))

// --- API ---
app.route('/auth', authRoutes)
app.route('/admin', adminRoutes)
app.route('/settings', settingsRoutes)
app.route('/blobs', blobsRoutes)
app.route('/characters', createEntityRoutes('character', 'portraitBlobId'))
app.route('/personas', createEntityRoutes('persona', 'avatarBlobId'))
app.route('/conversations', createEntityRoutes('conversation'))
app.route('/styles', createEntityRoutes('style'))
app.route('/lorebooks', createEntityRoutes('lorebook'))

// --- WebSocket ---
app.use('/ws', async (c, next) => {
  const token = c.req.query('token') ?? ''
  const payload = await verifyToken(token)
  if (!payload) {
    return c.text('Nieautoryzowany', 401)
  }
  c.set('userId', payload.sub)
  c.set('username', payload.username)
  c.set('isAdmin', false)
  await next()
})

app.get(
  '/ws',
  upgradeWebSocket((c) => {
    const userId = c.get('userId') as string | undefined

    return {
      onOpen(_evt, ws) {
        if (!userId) {
          ws.close(4001, 'unauthorized')
          return
        }
        register(userId, ws)
        try {
          ws.send(JSON.stringify({ type: 'hello', userId }))
        } catch {
          /* ignore */
        }
      },
      onClose(_evt, ws) {
        if (userId) unregister(userId, ws)
      },
      onError(_evt, ws) {
        if (userId) unregister(userId, ws)
      },
    }
  }),
)

// --- Statyki frontendu (produkcja) ---
const PUBLIC_DIR = './public'

if (existsSync(PUBLIC_DIR)) {
  app.use('/*', serveStatic({ root: PUBLIC_DIR }))
  app.get('*', serveStatic({ path: `${PUBLIC_DIR}/index.html` }))
  console.log(`[rp-sync] serwuje statyki z ${PUBLIC_DIR}`)
} else {
  console.log('[rp-sync] brak katalogu ./public - tryb API-only (dev)')
}

app.get('/', (c) => c.json({ name: 'rp-sync', version: '0.3.2' }))

app.notFound((c) => c.json({ error: 'Nie znaleziono' }, 404))

app.onError((err, c) => {
  console.error('[error]', err)
  return c.json({ error: err.message || 'Blad serwera' }, 500)
})

async function bootstrap(): Promise<void> {
  await seedAdminIfNeeded()
  startGcLoop()
  console.log(`[rp-sync] startuje na porcie ${PORT}`)
}

void bootstrap()

export default {
  port: PORT,
  fetch: app.fetch,
  websocket,
}
