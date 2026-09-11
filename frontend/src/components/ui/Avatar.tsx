import { useBlobSrc } from '../../lib/blobCache'

interface AvatarProps {
  /**
   * Zrodlo obrazu. Trzy przypadki:
   *   - data:image/...  -> stary format inline (base64)
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
 * Logika rozwiazywania zrodla (blob vs base64) jest w useBlobSrc.
 */
export default function Avatar({ src, name, size = 'md', className = '' }: AvatarProps) {
  const sizeClass = sizeMap[size]
  const resolvedSrc = useBlobSrc(src)

  if (!resolvedSrc) {
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

// === END OF FILE ===
