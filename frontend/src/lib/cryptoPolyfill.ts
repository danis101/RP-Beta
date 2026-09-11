/**
 * Polyfill dla `crypto.randomUUID()`.
 *
 * `crypto.randomUUID()` jest dostępne WYŁĄCZNIE w secure context:
 *   - https://...
 *   - http://localhost
 *   - http://127.0.0.1
 * NIE działa dla `http://192.168.x.x` ani `http://<dowolne-ip>`.
 *
 * Ponieważ aplikacja jest projektowana do uruchamiania w LAN po HTTP
 * (typowo `http://192.168.1.100:8787`), bez tego polyfillu KAŻDE użycie
 * `crypto.randomUUID()` rzuca `TypeError: crypto.randomUUID is not a function`
 * i aplikacja pokazuje szary ekran (błąd przy pierwszym renderze).
 *
 * Rozwiązanie: jeśli `crypto.randomUUID` nie istnieje, dokładamy własną
 * implementację UUID v4 opartą o `crypto.getRandomValues()`, które JEST
 * dostępne w każdej przeglądarce i w każdym kontekście (secure lub nie).
 *
 * Plik musi być zaimportowany jako PIERWSZY w `main.tsx` — zanim dojdzie
 * do jakiegokolwiek wywołania `crypto.randomUUID()` w kodzie aplikacji.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// Guard dla środowisk bez `crypto` w ogóle (bardzo stare przeglądarki, egzotyczne
// sandboxy). W praktyce nowoczesne przeglądarki zawsze mają `crypto`.
if (typeof crypto === 'undefined') {
  // Skrajny fallback — nieidealny kryptograficznie, ale aplikacja działa.
  // Wszystkie wspierane przeglądarki mają `crypto`, więc to nigdy się nie odpali.
  ;(globalThis as any).crypto = {
    randomUUID: () => {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        const v = c === 'x' ? r : (r & 0x3) | 0x8
        return v.toString(16)
      })
    },
  }
} else if (typeof crypto.randomUUID !== 'function') {
  // Standardowa ścieżka: mamy `crypto`, ale nie mamy `randomUUID`
  // (np. HTTP po IP, Firefox w trybie prywatnym w starych wersjach, itp.).
  ;(crypto as any).randomUUID = function randomUUID(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16))

    // Ustawiamy bity zgodnie z RFC 4122 §4.4 (wersja 4, wariant 1):
    //   - bajt 6: górne 4 bity = 0100 (wersja 4)
    //   - bajt 8: górne 2 bity = 10   (wariant 1)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80

    const hex: string[] = []
    for (let i = 0; i < 16; i++) {
      hex.push(bytes[i].toString(16).padStart(2, '0'))
    }
    const s = hex.join('')

    // Format 8-4-4-4-12
    return (
      s.slice(0, 8) +
      '-' +
      s.slice(8, 12) +
      '-' +
      s.slice(12, 16) +
      '-' +
      s.slice(16, 20) +
      '-' +
      s.slice(20)
    )
  }

  if (import.meta.env.DEV) {
    console.info(
      '[cryptoPolyfill] crypto.randomUUID nie było dostępne (insecure context — HTTP po IP). ' +
        'Zainstalowano polyfill oparty o crypto.getRandomValues.',
    )
  }
}

export {}
