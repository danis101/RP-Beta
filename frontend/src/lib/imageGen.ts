/**
 * Klient mostka ComfyUI (OpenAI-compatible Images API).
 *
 * Wszystko idzie przez /images-proxy na wlasnym origin. Adres mostka
 * w naglowku X-Image-Target.
 *
 * Persystencja: gdy mostek zwroci URL (response_format='url'), jest to
 * zwykle URL tymczasowy (np. /images/view/xyz.png). Pobieramy go raz i
 * konwertujemy na data URL, ktory zapisujemy w wariancie wiadomosci -
 * obraz przetrwa w bazie razem z konwersacja.
 *
 * Diagnostyka: kazdy krok (post do mostka, otrzymany URL, fetch przez proxy,
 * konwersja na base64) loguje sie w konsoli z prefiksem [imageGen].
 * Jesli obraz sie nie wyswietla, w DevTools -> Console zobaczysz dokladnie
 * na ktorym etapie sie to wywalilo.
 */

export type ImageGenResult =
  | { status: 'done'; dataUrl: string; persisted: boolean; originalUrl?: string }
  | { status: 'processing' }
  | { status: 'error'; message: string }

interface GenerateImageOptions {
  baseUrl: string
  responseFormat: 'url' | 'b64_json'
  size?: string
  signal?: AbortSignal
}

function resolveUrl(baseUrl: string, path: string): { url: string; headers: Record<string, string> } {
  const cleanBase = baseUrl.trim().replace(/\/+$/, '')
  return { url: `/images-proxy${path}`, headers: { 'X-Image-Target': cleanBase } }
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'))
    reader.readAsDataURL(blob)
  })
}

/**
 * Buduje URL do pobrania obrazu z mostka przez proxy backendu.
 * Obsluguje:
 *   1) data:...                      -> zwracamy bez zmian
 *   2) absolutny URL zgodny z base   -> strip base, przez proxy
 *   3) relatywny /sciezka            -> przez proxy
 *   4) absolutny URL do innego hosta -> przez proxy z origin tego hosta
 */
function resolveImageFetch(
  imageUrl: string,
  baseUrl: string,
): { url: string; headers: Record<string, string> } {
  const cleanBase = baseUrl.trim().replace(/\/+$/, '')

  if (imageUrl.startsWith(cleanBase)) {
    const path = imageUrl.slice(cleanBase.length) || '/'
    return { url: `/images-proxy${path}`, headers: { 'X-Image-Target': cleanBase } }
  }

  if (imageUrl.startsWith('/')) {
    return { url: `/images-proxy${imageUrl}`, headers: { 'X-Image-Target': cleanBase } }
  }

  try {
    const u = new URL(imageUrl)
    return {
      url: `/images-proxy${u.pathname}${u.search}`,
      headers: { 'X-Image-Target': u.origin },
    }
  } catch {
    return { url: imageUrl, headers: {} }
  }
}

/**
 * Pobiera obraz po URL i konwertuje na data URL.
 * Zwraca null przy bledzie. W DEV loguje szczegolowy powod.
 */
async function fetchAsDataURL(
  imageUrl: string,
  baseUrl: string,
  signal?: AbortSignal,
): Promise<string | null> {
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
      console.warn(
        '[imageGen] proxy zwrocilo nie-obraz:',
        contentType,
        'tresc:',
        text.slice(0, 200),
      )
      return null
    }

    const blob = await resp.blob()
    if (blob.size === 0) {
      console.warn('[imageGen] proxy zwrocilo pusty blob')
      return null
    }

    console.info(
      `[imageGen] obraz pobrany: ${(blob.size / 1024).toFixed(0)} KB binarnie, ~${((blob.size * 4) / 3 / 1024).toFixed(0)} KB jako base64`,
    )

    return await blobToDataURL(blob)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null
    console.error('[imageGen] blad pobierania obrazu:', error)
    return null
  }
}

export async function generateImage(
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

    // b64_json: mostek juz dal nam data URL, zero pracy.
    if (first?.b64_json) {
      console.info('[imageGen] mostek zwrocil b64_json, dlugosc:', first.b64_json.length)
      return {
        status: 'done',
        dataUrl: `data:image/png;base64,${first.b64_json}`,
        persisted: true,
      }
    }

    // url: probujemy pobrac i zapisac jako data URL.
    if (first?.url) {
      const originalUrl: string = first.url
      console.info('[imageGen] mostek zwrocil URL:', originalUrl)

      if (originalUrl.startsWith('data:')) {
        return { status: 'done', dataUrl: originalUrl, persisted: true }
      }

      const dataUrl = await fetchAsDataURL(originalUrl, options.baseUrl, options.signal)
      if (dataUrl) {
        return { status: 'done', dataUrl, persisted: true }
      }

      // Fallback - obraz pozostaje w oryginalnym URL. NIE zadziala w HTTPS
      // (mixed content), ale zwracamy zeby user zobaczyl w UI ze obraz
      // powstal i mial link. ChatBubble pokaze to jako klikalny link.
      console.warn(
        '[imageGen] nie udalo sie pobrac obrazu przez proxy. Fallback na oryginalny URL (moze nie zaladowac sie z powodu mixed content):',
        originalUrl,
      )
      return { status: 'done', dataUrl: originalUrl, persisted: false, originalUrl }
    }
  }

  return { status: 'error', message: 'Mostek zwrocil nieoczekiwany format odpowiedzi.' }
}
