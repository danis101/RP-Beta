interface AvatarProps {
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
 * Awatar postaci. Jeśli brak portretu — gradient z inicjałem.
 * Docelowo: zdjęcie z karty postaci.
 */
export default function Avatar({ src, name, size = 'md', className = '' }: AvatarProps) {
  const sizeClass = sizeMap[size]

  if (src) {
    return <img src={src} alt={name} className={`${sizeClass} object-cover ${className}`} />
  }

  return (
    <div
      className={`${sizeClass} flex items-center justify-center bg-gradient-to-br from-accent/40 to-accent/10 font-semibold text-white ${className}`}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  )
}
