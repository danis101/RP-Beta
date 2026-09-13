/**
 * Klient mostka ComfyUI (OpenAI-compatible Images API).
 *
 * Wszystko idzie przez /images-proxy na wlasnym origin. Adres mostka
 * w naglowku X-Image-Target, JWT sync w X-RP-Auth (wymagane przez proxy).
 *
 * Zwraca Blob (nie data URL) - to caller decyduje co zrobic: upload do
 * /blobs jako blob, trzymac w pamieci itd. Dzieki temu imageGen.ts jest
 * wolny od logiki sync poza samym tokenem uwierzytelniajacym proxy.
 *
 * Diagnostyka: kazdy krok (post do mostka, otrzymany URL, fetch przez proxy)
 * loguje sie w konsoli z prefiksem [imageGen].
 */



export type ImageGenResult =
  | { status: 'done'; blob: Blob }
  | { status: 'processing' }
  | { status: 'error'; message: string }

interface GenerateImageOptions {
  baseUrl: string
  responseFormat: 'url' | 'b64_json'
  size?: string
  signal?: AbortSignal
}

export function createImageGenerator(getToken: () => string | null, fetch: typeof globalThis.fetch) {
/** Wspolne naglowki proxy: target + JWT sync. */
function proxyAuthHeaders(targetBase: string): Record<string, string> {
  const headers: Record<string, string> = { 'X-Image-Target': targetBase }
  const token = getToken()
  if (token) headers['X-RP-Auth'] = `Bearer ${token}`
  return headers
}

function resolveUrl(baseUrl: string, path: string): { url: string; headers: Record<string, string> } {
  const cleanBase = baseUrl.trim().replace(/\/+$/, '')
  return { url: `/images-proxy${path}`, headers: proxyAuthHeaders(cleanBase) }
}

/**
 * Buduje URL do pobrania obrazu z mostka przez proxy backendu.
 * Obsluguje:
 *   1) absolutny URL zgodny z base   -> strip base, przez proxy
 *   2) relatywny /sciezka            -> przez proxy
 *   3) absolutny URL do innego hosta -> przez proxy z origin tego hosta
 */
function resolveImageFetch(
  imageUrl: string,
  baseUrl: string,
): { url: string; headers: Record<string, string> } {
  const cleanBase = baseUrl.trim().replace(/\/+$/, '')

  if (imageUrl.startsWith(cleanBase)) {
    const path = imageUrl.slice(cleanBase.length) || '/'
    return { url: `/images-proxy${path}`, headers: proxyAuthHeaders(cleanBase) }
  }

  if (imageUrl.startsWith('/')) {
    return { url: `/images-proxy${imageUrl}`, headers: proxyAuthHeaders(cleanBase) }
  }

  try {
    const u = new URL(imageUrl)
    return {
      url: `/images-proxy${u.pathname}${u.search}`,
      headers: proxyAuthHeaders(u.origin),
    }
  } catch {
    return { url: imageUrl, headers: {} }
  }
}

async function fetchAsBlob(
  imageUrl: string,
  baseUrl: string,
  signal?: AbortSignal,
): Promise<Blob | null> {
  const { url, headers } = resolveImageFetch(imageUrl, baseUrl)
  console.info('[imageGen] pobieram obraz przez proxy:', url, 'cel:', headers['X-Image-Target'])

  try {
    const resp = await fetch(url, { headers, signal })
    console.info('[imageGen] odpowiedz proxy:', resp.status, resp.headers.get('content-type'))

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      console.warn('[imageGen] proxy zwrocilo blad:', resp.status, text.slice(0, 300))
      return null
    }

    const contentType = resp.headers.get('content-type') || ''
    if (!contentType.startsWith('image/')) {
      const text = await resp.text().catch(() => '')
      console.warn('[imageGen] proxy zwrocilo nie-obraz:', contentType, text.slice(0, 200))
      return null
    }

    const blob = await resp.blob()
    if (blob.size === 0) {
      console.warn('[imageGen] proxy zwrocilo pusty blob')
      return null
    }

    console.info(`[imageGen] obraz pobrany: ${(blob.size / 1024).toFixed(0)} KB`)
    return blob
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null
    console.error('[imageGen] blad pobierania obrazu:', error)
    return null
  }
}

function base64ToBlob(b64: string, mime = 'image/png'): Blob {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  // TS 5.7: Uint8Array<ArrayBufferLike> nie pasuje do BlobPart, kopiujemy.
  const ab = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(ab).set(bytes)
  return new Blob([ab], { type: mime })
}

async function generateImage(
  prompt: string,
  options: GenerateImageOptions,
): Promise<ImageGenResult> {
  if (!prompt.trim()) return { status: 'error', message: 'Pusty prompt.' }
  if (!options.baseUrl.trim()) return { status: 'error', message: 'Nie ustawiono adresu backendu generowania obrazow.' }

  const { url, headers: proxyHeaders } = resolveUrl(options.baseUrl, '/images/generations')
  console.info('[imageGen] POST', url, 'target:', proxyHeaders['X-Image-Target'])

  const body: Record<string, unknown> = {
    prompt,
    n: 1,
    response_format: options.responseFormat,
  }
  if (options.size) body.size = options.size

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...proxyHeaders,
      },
      body: JSON.stringify(body),
      signal: options.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { status: 'error', message: 'Przerwano.' }
    }
    return { status: 'error', message: error instanceof Error ? error.message : String(error) }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return { status: 'error', message: `Mostek: ${response.status} ${text.slice(0, 600)}` }
  }

  const data = await response.json().catch(() => null)

  if (data && data.status === 'processing') {
    return { status: 'processing' }
  }

  console.info('[imageGen] surowa odpowiedz mostka:', data)

  const items = data?.data
  if (Array.isArray(items) && items.length > 0) {
    const first = items[0]

    // b64_json: mostek dal nam base64, konwertujemy na Blob.
    if (first?.b64_json) {
      console.info('[imageGen] mostek zwrocil b64_json, dlugosc:', first.b64_json.length)
      return { status: 'done', blob: base64ToBlob(first.b64_json) }
    }

    // url: pobieramy przez proxy i zwracamy Blob.
    if (first?.url) {
      const originalUrl: string = first.url
      console.info('[imageGen] mostek zwrocil URL:', originalUrl)

      const blob = await fetchAsBlob(originalUrl, options.baseUrl, options.signal)
      if (blob) {
        return { status: 'done', blob }
      }

      return {
        status: 'error',
        message: 'Nie udalo sie pobrac obrazu z mostka przez proxy.',
      }
    }
  }

  return { status: 'error', message: 'Mostek zwrocil nieoczekiwany format odpowiedzi.' }
}

// === END OF FILE ===


return generateImage
}
