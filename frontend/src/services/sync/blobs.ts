/**
 * Klient API dla blobow (portrety, awatary, obrazy w wiadomosciach).
 *
 * POST /blobs  multipart/form-data z polem "file"
 *   -> { id: sha256, sha256, size, mime }
 *
 * Backend jest idempotentny po sha256 - ten sam plik drugi raz = ten sam id,
 * zero duplikatow na dysku.
 */

import { getToken } from './client'
import { syncUrl } from './config'

export interface BlobUploadResult {
  id: string
  sha256: string
  size: number
  mime: string
}

/**
 * Konwertuje Uint8Array na swiezy ArrayBuffer.
 *
 * Powod: TypeScript 5.7+ typuje Uint8Array jako Uint8Array<ArrayBufferLike>,
 * gdzie ArrayBufferLike moze byc SharedArrayBuffer - a BlobPart wymaga
 * konkretnie ArrayBuffer. Kopiowanie przez new ArrayBuffer + set() daje
 * jednoznacznie ArrayBuffer, ktory TS akceptuje wszedzie.
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(ab).set(bytes)
  return ab
}

/**
 * Uploaduje blob z danymi binarnymi (Uint8Array) i zwraca jego sha256.
 * Konwertuje na File zeby poszlo jako multipart.
 */
export async function uploadBlob(bytes: Uint8Array, mime: string, filename = 'blob'): Promise<string> {
  const buffer = toArrayBuffer(bytes)
  const blob = new Blob([buffer], { type: mime })
  const form = new FormData()
  form.append('file', blob, filename)

  // Nie uzywamy `request()` bo ona ustawia Content-Type: application/json.
  // Musimy uzyc fetch bezposrednio z FormData (przegladarka sama ustawi
  // Content-Type: multipart/form-data z odpowiednim boundary).
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  const resp = await fetch(syncUrl('/blobs'), {
    method: 'POST',
    headers,
    body: form,
  })

  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }))
    throw new Error((errBody as { error?: string }).error || `HTTP ${resp.status}`)
  }

  const result = (await resp.json()) as BlobUploadResult
  return result.sha256
}

/**
 * Uploaduje blob z data URL (base64). Uzywane przy imporcie portretow
 * z PNG kart ST, gdzie portret jest inline base64.
 */
export async function uploadBlobFromDataUrl(dataUrl: string): Promise<string> {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl)
  if (!match) {
    throw new Error('Nieprawidlowy data URL')
  }
  const mime = match[1]
  const base64 = match[2]

  // atob -> binarny string -> Uint8Array
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }

  return uploadBlob(bytes, mime, 'upload')
}

/** Uploaduje blob z File (z input[type=file]). */
export async function uploadBlobFromFile(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return uploadBl
