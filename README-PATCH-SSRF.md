# Patch: SSRF w proxy (/llm-proxy, /searxng-proxy, /images-proxy)

## Co było nie tak

Endpointy proxy w `sync/src/index.ts` były rejestrowane **przed** jakimkolwiek
middleware auth. Handler brał URL z nagłówka (`X-LLM-Target` itd.), sprawdzał
tylko że jest to poprawny `http(s)://`, i przekazywał żądanie 1:1 do celu
(`redirect: 'follow'`, dowolne nagłówki i body). To otwarty SSRF relay — każdy
z dostępem do portu 8787 mógł kazać serwerowi wysłać żądanie pod dowolny adres.

## Co teraz działa

**1. Auth na proxy**
Nowy `proxyAuthMiddleware` wymaga zalogowanego usera RP. JWT idzie w dedykowanym
nagłówku `X-RP-Auth: Bearer <token>` (nie `Authorization`, bo ten nadal niesie
klucz API do LM Studio / SearXNG). Nagłówek jest usuwany z żądania forwardowanego
do celu.

**2. Allowlista targetów**
Domyślnie dozwolone są **tylko adresy prywatne**:
- `localhost`, `*.localhost`
- `127.*`, `10.*`, `192.168.*`, `172.16-31.*`, `169.254.*`
- `::1`, `fe80::/10`, `fc00::/7`
- `*.local`, `*.lan`, `*.home`, `*.internal`

Publiczne IP i domeny są blokowane. Aby je dopuścić, wpisz je jawnie w `.env`:

```

PROXY_ALLOWED_HOSTS=192.168.100.80,192.168.100.81:8040,pc.ibnz.eu

```

Gdy ta zmienna jest ustawiona, wchodzą **tylko** hosty z listy (prywatne też —
lista jest wyłączna). Puste = fallback na regułę „tylko prywatne”.

**3. Redirecty**
`redirect: 'manual'`. Proxy nie idzie w ciemno za `Location`. Jeśli upstream
zwróci 3xx, sprawdzamy `Location` względem allowlisty i robimy **jeden** hop
ręcznie. Dalsze redirecty zwracamy jako błąd — nie budujemy otwartego łańcucha.

## Frontend — co się zmieniło

Trzy miejsca wołające proxy dodają teraz `X-RP-Auth`:

- `frontend/src/services/api/OpenAIAdapter.ts` — metoda `resolve()`
- `frontend/src/lib/tools.ts` — `searchWeb()`
- `frontend/src/lib/imageGen.ts` — `resolveUrl()` + `resolveImageFetch()`

Wszystkie importują `getToken` z `services/sync/client`. Zero zmian w protokole
— klient dalej wysyła `X-LLM-Target`, tylko dodatkowo z tokenem.

## Deployment

1. **Podmień pliki**:
   - `sync/src/config.ts`
   - `sync/src/auth.ts`
   - `sync/src/proxy.ts`
   - `sync/src/index.ts`
   - `frontend/src/services/api/OpenAIAdapter.ts`
   - `frontend/src/lib/tools.ts`
   - `frontend/src/lib/imageGen.ts`

2. **Dodaj do `.env` (opcjonalnie)**:
```

PROXY_ALLOWED_HOSTS=

```
Zostaw puste jeśli wszystko co używasz jest w LAN/VPN. Wpisz listę jeśli
wołasz coś publicznego.

3. **Rebuild**:
```

docker compose up -d --build

```

4. **Test**:
- Wyślij wiadomość → LLM odpowiada (proxy działa z auth).
- Wygeneruj obraz → obraz się pojawia.
- Websearch → działa.
- Wyloguj się → wyślij wiadomość → błąd 401 z proxy (auth działa).
- W DevTools ustaw `X-LLM-Target: http://example.com` (publiczne) i wyślij →
  błąd 403 z komunikatem o allowliście.

## Jeśli coś pada po wdrożeniu

**„Cel proxy niedozwolony: ..."** — host nie pasuje do prywatnego regexu i nie
ma go w `PROXY_ALLOWED_HOSTS`. Dodaj do `.env`.

**„Brak tokenu autoryzacji proxy"** — frontend nie dodał `X-RP-Auth`. Sprawdź
czy pliki frontendu zostały podmienione i zbudowane.

**„Proxy zablokowało redirect do niedozwolonego hosta"** — mostek/LLM zwraca
302 na publiczny host. Dodaj ten host do `PROXY_ALLOWED_HOSTS` (jeśli to
zamierzone) albo skonfiguruj usługę tak, żeby nie robiła redirectów.

## Otwarte na przyszłość

- **Rate limit na proxy** — obecnie brak; przy większej liczbie userów warto
dorzucić `checkRateLimit` per user/IP.
- **UI do zarządzania allowlistą** — teraz tylko env.
- **Klucze API do usług w bazie per user** — `Authorization` do LM Studio nadal
idzie z frontendu; jeśli kiedyś userzy nie będą ufać swoim przeglądarkom,
można przenieść to na serwer (osobny temat).

