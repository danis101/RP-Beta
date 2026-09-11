/**
 * Minimalny hash-routing. Bez React Router — dla dwóch tras nie warto
 * ciągnąć zależności. Wystarczy nam #/admin jako osobny widok.
 *
 * Użycie:
 *   const route = useHashRoute()   // '' | 'admin'
 */

import { useEffect, useState } from 'react'

function readHash(): string {
  const h = window.location.hash.replace(/^#\/?/, '')
  return h.split('?')[0]
}

export function useHashRoute(): string {
  const [route, setRoute] = useState<string>(() => readHash())

  useEffect(() => {
    const handler = () => setRoute(readHash())
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  return route
}
