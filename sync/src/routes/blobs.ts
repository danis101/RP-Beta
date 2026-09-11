/**
 * Endpointy blobów:
 *   POST   /        — upload (multipart, pole "file"), dedup po sha256
 *   HEAD   /:sha    — sprawdzenie istnienia (klient dedupuje przed uploadem)
 *   GET    /:sha    — pobranie pliku (immutable cache)
 *
 * Bloby są niezmienne (content-addressed), więc nagłówki cache są agresywne.
 * Bezpieczeństwo: każdy blob sprawdza ownership po user_id.
 *
 * Uwaga: Hono nie ma metody `.head()` — HEAD rejestrujemy przez `.on('HEAD', ...)`.
 */

import { Hono } from 'hono'
import { authMiddleware, type AppEnv } from '../auth'
import { findBlob, resolveBlobPath, saveBlob } from '../blobs'
import { MAX_BLOB_BYTES } from '../config'

export const blobsRoutes = new Hono<AppEnv>()

blobsRoutes.use('*', authMiddleware)

function setBlobHeaders(c: any, meta: { mime: string; size: number; sha256: string }) {
  c.header('Content-Type', meta.mime)
  c.header('Content-Length', String(meta.size))
  c.header('ETag', `"${meta.sha256}"`)
  c.header('Cache-Control', 'public, max-age=31536000, immutable')
}

blobsRoutes.post('/', async (c) => {
  const userId = c.get('userId')

  let form: FormData
  try {
    form = await c.req.formData()
  } catch {
    return c.json({ error: 'Oczekiwano multipart/form-data' }, 400)
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return c.json({ error: 'Pole "file" jest wymagane' }, 400)
  }

  if (file.size === 0) {
    return c.json({ error: 'Plik jest pusty' }, 400)
  }

  if (file.size > MAX_BLOB_BYTES) {
    return c.json(
      { error: `Plik przekracza limit ${(MAX_BLOB_BYTES / 1024 / 1024).toFixed(0)} MB` },
      413,
    )
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const mime = file.type || 'application/octet-stream'

  const meta = await saveBlob(userId, bytes, mime)

  return c.json({
    id: meta.sha256,
    sha256: meta.sha256,
    size: meta.size,
    mime: meta.mime,
  })
})

blobsRoutes.on('HEAD', '/:sha', (c) => {
  const userId = c.get('userId')
  const sha = c.req.param('sha')
  const meta = findBlob(userId, sha)
  if (!meta) return c.body(null, 404)

  setBlobHeaders(c, meta)
  return c.body(null, 200)
})

blobsRoutes.get('/:sha', async (c) => {
  const userId = c.get('userId')
  const sha = c.req.param('sha')

  const meta = findBlob(userId, sha)
  if (!meta) return c.json({ error: 'Nie znaleziono bloba' }, 404)

  const path = await resolveBlobPath(userId, sha)
  if (!path) {
    // Metadane są, pliku nie ma — rozjazd między bazą a dyskiem.
    return c.json({ error: 'Plik nie istnieje na dysku' }, 410)
  }

  setBlobHeaders(c, meta)
  return c.body(Bun.file(path).stream())
})
