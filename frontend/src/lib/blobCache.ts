/**
 * Cache blobow z serwera sync.
 *
 * Problem: obrazy na serwerze sa pod /blobs/:sha i wymagaja JWT w naglowku
 * Authorization. Zwykly <img src="/blobs/..."> nie wysle tego naglowka.
 *
 * Rozwiazanie: fetch z JWT, konwersja na blob URL, cache w Map.
 * Ten sam sha = ten sam blob URL, nie ma duplikatow.
 *
 * Cache:
 *   - W pamieci (Map<string, Promise<string>>) - w czasie zycia strony.
 *   - Blob URL zwalniany przez URL.revokeObjectURL dopiero przy logout
 *     (rzadko) albo nigdy (przegladarka sama sprzata przy unload).
 *
 * Bezpieczenstwo: blob URL nie jest publiczny (tylko w tej karcie),
 * autoryzacja caly czas wymagana przy fetchu z serwera.
 */

import { getToken } from '../services/sync/client'
import { syncUrl } from '../services/sync/config'

const cache = new Map<string, Promise<string>>()

/** Heurystyka: sha256 w formacie hex (64 znaki). */
const SHA256_RE = /^[a-f0-9]{64}$/

export function isBlobId(src: string | undefined): src is string {
  if (!src) return false
  return SHA256_RE.test(src)
}

/**
 * Zwraca blob URL dla danego sha256.
 * Kolejne wywolania dla tego samego sha dostaja ten sam URL (cache).
 * Blad fetcha rzuca wyjatek - komponent powinien pokazac fallback.
 */
export async function getBlobUrl(sha256: string): Promise<string> {
  const cached = cache.get(sha256)
  if (cached) return cached

  const promise = (async (): Promise<string> => {
    const token = getToken()
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`

    const resp = await fetch(syncUrl(`/blobs/${sha256}`), { headers })
    if (!resp.ok) {
      throw new Error(`Blob ${sha256}: HTTP ${resp.status}`)
    }
    const blob = await resp.blob()
    return URL.createObjectURL(blob)
  })()

  cache.set(sha256, promise)

  // Jesli fetch padl - usun z cache zeby kolejne proby mialy szanse.
  promise.catch(() => {
    cache.delete(sha256)
  })

  return promise
}

/**
 * Wyczyscic wszystkie blob URL-e. Wywolywane przy logout albo zamknieciu
 * calej sesji (rzadko). Nie kasujemy cache przy kazdym unmountcie komponentu,
 * bo byloby to marnotrawstwo - te same portrety sa uzywane wielokrotnie.
 */
export function clearBlobCache(): void {
  for (const p of cache.values()) {
    p.then((url) => URL.revokeObjectURL(url)).catch(() => {
      /* ignore */
    })
  }
  cache.clear()
}
