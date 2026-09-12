# RP Frontend

Interfejs React + TypeScript + Vite + Tailwind CSS. Instrukcje uruchomienia całej aplikacji i aktualne ograniczenia są w [głównym README](../README.md).

## Praca lokalna

Polecenia wykonuj w katalogu `frontend`:

```bash
npm ci
npm run dev
```

Pełna aplikacja wymaga backendu. Sam serwer Vite nie zastępuje logowania, synchronizacji ani proxy integracji.

## Sprawdzenie zmian

```bash
npm test
npm run build
```

Testy obejmują scalanie rozmów i dostępność narzędzi. Build sprawdza TypeScript i tworzy `dist`.

Do sprawdzania układu bez backendu, po wykonaniu builda:

```bash
node tests/mobile-preview.cjs
```

Otwórz `http://127.0.0.1:5173` i zaloguj się jako `test` / `test`. Podgląd używa przykładowych danych w pamięci; nie sprawdza rzeczywistej synchronizacji ani generowania AI. Po zmianach ponownie wykonaj build i odśwież stronę. Zakończ podgląd przez Ctrl+C.

## Struktura

- `src/App.tsx` — koordynacja widoków, zapisywania i generowania.
- `src/components` — czat, karty, ustawienia i pozostałe widoki.
- `src/context` — stan logowania, ustawień i konfliktów.
- `src/services` — adaptery modeli oraz komunikacja z backendem.
- `src/lib` — formatowanie, obrazy, prompty i scalanie rozmów.
- `tests` — testy regresji i izolowany podgląd UI.
