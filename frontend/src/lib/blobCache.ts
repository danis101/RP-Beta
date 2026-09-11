/**
 * Cache blobow z serwera sync.
 *
 * Problem: obrazy na serwerze sa pod /blobs/:sha i wymagaja JWT w naglowku
 * Authorization. Zwykly <img src="/blobs/..."> nie wysle tego naglowka.
 *
 * Rozwiazanie: fetch z JWT, konwersja na blob URL, cache w Map.
 * Ten sam sha = ten sam blob URL, nie ma duplikatow.
 *
 * Bezpieczenstwo: blob URL nie jest publiczny (tylko w tej karcie),
 * autoryzacja caly czas wymagana przy fetchu z serwera.
 */

import { useEffect, useState } from 'react'
import { getToken } from '../services/sync/client'
import { syncUrl } from '../services/sync/config'

const urlCache = new Map<string, Promise<string>>()
const dataUrlCache = new Map<string, Promise<string>>()

/** Heurystyka: sha256 w formacie hex (64 znaki). */
const SHA256_RE = /^[a-f0-9]{64}$/

export function isBlobId(src: string | undefined): src is string {
  if (!src) return false
  return SHA256_RE.test(src)
}

async function fetchBlob(sha256: string): Promise<Blob> {
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  const resp = await fetch(syncUrl(`/blobs/${sha256}`), { headers })
  if (!resp.ok) {
    throw new Error(`Blob ${sha256}: HTTP ${resp.status}`)
  }
  return await resp.blob()
}

/**
 * Zwraca blob URL dla danego sha256. Kolejne wywolania dla tego samego
 * sha dostaja ten sam URL (cache).
 */
export async function getBlobUrl(sha256: string): Promise<string> {
  const cached = urlCache.get(sha256)
  if (cached) return cached

  const promise = (async (): Promise<string> => {
    const blob = await fetchBlob(sha256)
    return URL.createObjectURL(blob)
  })()

  urlCache.set(sha256, promise)

  promise.catch(() => {
    urlCache.delete(sha256)
  })

  return promise
}

/**
 * Zwraca data URL (base64) dla danego sha256. Uzywane przy wysylaniu
 * obrazu do LLM (vision) - LLM wymaga inline base64, nie blob URL.
 */
export async function getBlobAsDataUrl(sha256: string): Promise<string> {
  const cached = dataUrlCache.get(sha256)
  if (cached) return cached

  const promise = (async (): Promise<string> => {
    const blob = await fetchBlob(sha256)
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error ?? new Error('FileReader error'))
      reader.readAsDataURL(blob)
    })
  })()

  dataUrlCache.set(sha256, promise)

  promise.catch(() => {
    dataUrlCache.delete(sha256)
  })

  return promise
}

/**
 * Wyczyscic wszystkie cache. Wywolywane przy logout.
 */
export function clearBlobCache(): void {
  for (const p of urlCache.values()) {
    p.then((url) => URL.revokeObjectURL(url)).catch(() => {
      /* ignore */
    })
  }
  urlCache.clear()
  dataUrlCache.clear()
}

/**
 * React hook: rozwiazuje `src` (sha256 bloba albo bezposredni URL/base64)
 * na URL gotowy do uzycia w <img>.
 *
 * - sha256 -> fetch przez /blobs, blob URL (cache)
 * - data:... -> zwraca jak jest
 * - http(s)://... -> zwraca jak jest
 * - undefined -> undefined
 */
export function useBlobSrc(src: string | undefined): string | undefined {
  const [resolved, setResolved] = useState<string | undefined>(() => {
    if (!src) return undefined
    if (!isBlobId(src)) return src
    return undefined
  })

  useEffect(() => {
    if (!src) {
      setResolved(undefined)
      return
    }
    if (!isBlobId(src)) {
      setResolved(src)
      return
    }

    let cancelled = false
    setResolved(undefined)

    void getBlobUrl(src)
      .then((url) => {
        if (!cancelled) setResolved(url)
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn('[blobCache] nie udalo sie pobrac bloba:', err)
          setResolved(undefined)
        }
      })

    return () => {
      cancelled = true
    }
  }, [src])

  return resolved
}

// === END OF FILE ===
