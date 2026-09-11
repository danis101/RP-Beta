# RP Frontend

Frontend pod RP w formie messengera. Ciemny motyw, portrety postaci, karty, historia, tool calls.

## Stack

- React 18 + TypeScript
- Vite
- Tailwind CSS 3

## Start

```bash
npm install
npm run dev
```

## Architektura

- `src/components/ui` — komponenty bazowe (Avatar, dymki, przyciski)
- `src/components/chat` — lista konwersacji i widok czatu
- `src/components/layout` — lewa ramka nawigacji
- `src/services/api` — **warstwa adapterów API**

- `types.ts` — wspólny interfejs `ApiAdapter`
- `MockAdapter.ts` — lokalny mock, działa od razu
- `OpenAIAdapter.ts` — przygotowany szkielet pod prawdziwe API (pola `baseUrl`, `apiKey`, `model`)
- `src/data/mock.ts` — przykładowe konwersacje

## Wizja docelowa (nie teraz)

1. Podpięcie prawdziwego adaptera OpenAI (LLM, txt2img/img2img przez OpenAI-compatible API, multimodal).
2. Karty postaci: pełny CRUD, system prompt modularny jak w TAVO (JSON, bloczki, wstrzykiwanie).
3. Tool calls: generowanie obrazów, websearch.
4. Pakowanie jako desktop (Tauri) na Windows/Linux, potem Android.
5. Opcjonalny serwer synchronizacji w Dockerze.

Cała logika API jest odseparowana od UI — podpięcie nowego adaptera nie wymaga zmian w widokach.

