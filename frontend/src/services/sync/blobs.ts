/**
 * Klient API dla blobow (portrety, awatary, obrazy w wiadomosciach).
 *
 * POST /blobs  multipart/form-data z polem "file"
 *   -> { id: sha256, sha256, size, mime }
 *
 * Backend jest idempotentny po sha256 - ten sam plik drugi raz = ten sam id,
 * zero duplikatow na dysku.
 */

import { request } from './client'

export interface BlobUploadResult {
  id: string
  sha256: string
  size: number
  mime: string
}

/**
 * Uploaduje blob z danymi binarnymi (Uint8Array) i zwraca jego sha256.
 * Konwertuje na File żeby poszło jako multipart.
 */
export async function uploadBlob(bytes: Uint8Array, mime: string, filename = 'blob'): Promise<string> {
  const blob = new Blob([bytes], { type: mime })
  const form = new FormData()
  form.append('file', blob, filename)

  // Nie uzywamy `request()` bo ona ustawia Content-Type: application/json.
  // Musimy uzyc fetch bezposrednio z FormData (przegladarka sama ustawi
  // Content-Type: multipart/form-data z odpowiednim boundary).
  const { getToken } = await import('./client')
  const { syncUrl } = await import('./config')

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
  return uploadBlob(bytes, file.type || 'application/octet-stream', file.name)
}

// suppress unused - re-export uzywany przez inne moduly
void request
