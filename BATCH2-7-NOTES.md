# Batch 2.7: timeouty proxy + listModels

Krótki patch defensywny. Powód: na serwerze widoczne `502 134s` obok `502 2ms`
— Bun/undici domyślnie czeka ~135s zanim odda błąd połączenia, a polling
statusu API (co 60s) w tym czasie startuje kolejne sprawdzenie. Efekt:
nagromadzenie wiszących requestów, mylące logi, UI pokazuje „coraz więcej" 502.

## Co dodane

**`sync/src/config.ts`:**
- Nowa stała `PROXY_TIMEOUT_MS` (domyślnie 15_000 ms). Konfigurowalna przez env.
- Log przy starcie: `[config] PROXY_TIMEOUT_MS=15000 ms`.

**`sync/src/proxy.ts`:**
- `AbortSignal.timeout(PROXY_TIMEOUT_MS)` w `fetchInit`. Timeout dotyczy
  zarówno głównego fetch, jak i (jednego) redirect-hopu.
- Rozróżnienie timeout vs inny błąd: `isTimeout` w odpowiedzi JSON,
  czytelny komunikat w logu (`Timeout po 15000 ms`).
- Regresja — cała reszta proxy bez zmian (auth, allowlist, manual redirect).

**`frontend/src/lib/apiStatus.ts`:**
- Nowa stała `CHECK_TIMEOUT_MS = 8000`. Timeout krótszy niż interwał pollu
  (60s), więc kolejne ticki nie nakładają się.
- AbortController + `setTimeout` — nawet jeśli fetch nie dostanie aborcji,
  po 8s check jest przerywany i raportowany jako `offline / Timeout`.
- `cleanup()` czyszczący timer we wszystkich ścieżkach (sukces/błąd/abort).

## Efekt

**Przed:** przy niedostępnym LM Studio widzisz `502 134s`. Polling co 60s
startuje nowe sprawdzenie zanim poprzednie się skończy. Po 3 minutach masz
6 wiszących requestów, każdy za 2 minuty. Log się zapycha.

**Po:** 502 za 15s (backend) albo 8s (front abortuje wcześniej).
Zero nakładania. Kolejny tick startuje dopiero po zakończeniu poprzedniego
(check trwa max 8s, interwał 60s).

**W UI:** kropka statusu zmienia się na „offline" w ≤8s od nieudanego
sprawdzenia, zamiast wieszać się do 2 minut.

## Deployment

Podmień:
- `sync/src/config.ts`
- `sync/src/proxy.ts`
- `frontend/src/lib/apiStatus.ts`

`docker compose up -d --build`.

Opcjonalnie w `.env` (jeśli LM Studio potrzebuje dłużej na load modelu
po idle, np. 60-90s na dużych wagach):
```

PROXY_TIMEOUT_MS=60000

```

Domyślnie 15s jest OK dla ciepłego modelu. Zimny load po idle = 502.
Można wtedy zwiększyć.

## Diagnostyka LM Studio

Skoro w logach widać przeplot `200 3ms` i `502 134s`/`502 2ms` — LM Studio
**odpowiada, ale niestabilnie**. Sprawdź:

1. `curl -m 5 http://192.168.100.75:1234/v1/models` z serwera (Docker host).
   Jeśli wisi — problem sieci między kontenerem a LM Studio (firewall, VLAN).
   Jeśli szybko — LM Studio throttluje albo unloaduje model po idle.

2. LM Studio → Server → „Serve on Local Network" — włączone?
   (Domyślnie słucha tylko na `127.0.0.1`, LAN wymaga włączonej opcji.)

3. LM Studio → Settings → „Unload model on idle" — jeśli włączone (np. po 60 min),
   pierwszy request po idle ładuje model (może >2 min dla dużych wag) — z
   timeoutem 15s dostaniesz 502. Rozwiązanie: podnieś `PROXY_TIMEOUT_MS` na
   60000 lub wyłącz unload przy testach.

## Uwagi

- Nie zmienia to zachowania w zdrowym scenariuszu — 502 nadal leci, tylko
  szybciej. Zero regresji dla requestów które odpowiadają w <15s.
- Timeout jest per-request, nie per-sesja. SSE streaming nadal działa normalnie
  (połączenie otwarte → dane płyną → dopiero po zamknięciu klient odbiera koniec).
- Jeśli kiedyś pojawi się narzekanie „obraz generuje się 40s i mam 502" —
  obraz generation idzie przez ten sam proxy, dostanie timeout 15s. Trzeba
  wtedy podnieść `PROXY_TIMEOUT_MS` do 60000. Alternatywa: osobny timeout
  dla `/images-proxy` (nie zrobione, żeby nie komplikować).

