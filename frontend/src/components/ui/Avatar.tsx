import { useEffect, useState } from 'react'
import { getBlobUrl, isBlobId } from '../../lib/blobCache'

interface AvatarProps {
  /**
   * Zrodlo obrazu. Trzy przypadki:
   *   - data:image/...  -> stary format inline (base64 z poprzednich wersji)
   *   - 64-znakowy hex  -> sha256 bloba (nowy format, /blobs/:sha)
   *   - undefined       -> gradient z inicjalem
   */
  src?: string
  name: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeMap = {
  sm: 'h-9 w-9 rounded-[10px]',
  md: 'h-12 w-12 rounded-[14px]',
  lg: 'h-24 w-24 rounded-2xl',
}

/**
 * Awatar postaci/persony.
 *
 * Obsluguje trzy zrodla:
 *   1. Base64 data URL (stare karty sprzed migracji na bloby) - renderuje bezposrednio.
 *   2. Blob sha256 (nowe karty) - fetchuje przez /blobs/:sha z JWT i tworzy blob URL.
 *   3. Brak - gradient z inicjalem.
 *
 * Podczas fetchowania bloba pokazuje gradient z inicjalem (bez mrugania).
 */
export default function Avatar({ src, name, size = 'md', className = '' }: AvatarProps) {
  const sizeClass = sizeMap[size]
  const [resolvedSrc, setResolvedSrc] = useState<string | undefined>(
    src && !isBlobId(src) ? src : undefined,
  )
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)

    if (!src) {
      setResolvedSrc(undefined)
      return
    }

    if (!isBlobId(src)) {
      // Base64 lub inny URL - renderujemy jak jest.
      setResolvedSrc(src)
      return
    }

    // Blob - fetch asynchronicznie.
    let cancelled = false
    setResolvedSrc(undefined)

    void getBlobUrl(src)
      .then((url) => {
        if (!cancelled) setResolvedSrc(url)
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn('[Avatar] nie udalo sie pobrac bloba:', err)
          setFailed(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [src])

  // Fallback: brak src, nieudany fetch, albo czekamy na blob.
  if (!resolvedSrc || failed) {
    return (
      <div
        className={`${sizeClass} flex items-center justify-center bg-gradient-to-br from-accent/40 to-accent/10 font-semibold text-white ${className}`}
      >
        {name.charAt(0).toUpperCase()}
      </div>
    )
  }

  return <img src={resolvedSrc} alt={name} className={`${sizeClass} object-cover ${className}`} />
}
