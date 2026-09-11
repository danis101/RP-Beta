# Batch 2: token usuniętego konta + wersjonowanie sesji

Zamknięte P1 #4 z review.

## Problem

`authMiddleware` weryfikował tylko podpis i datę wygaśnięcia JWT. Brak usera
w bazie = `isAdmin=false`, ale requesty nadal przechodziły. Skutki:

- Usunięcie konta nie odbierało dostępu jego aktywnemu tokenowi (do 30 dni).
- Admin nie mógł unieważnić sesji usera po zmianie hasła.
- WS łączył się na podstawie samego podpisu tokenu — token usuniętego konta
  mógł dostawać eventy.

## Fix

**Nowe pole `users.session_version`** (INTEGER NOT NULL DEFAULT 1). Migracja
addytywna w `db.ts` przez istniejącą funkcję `ensureColumn` — starsze bazy
dostaną kolumnę automatycznie przy pierwszym starcie.

**Token niesie `sv`** (session_version w chwili wystawienia). `createToken`
dostało trzeci argument.

**Middleware sprawdza:**
1. Podpis + exp (jak wcześniej).
2. User **istnieje** w bazie — jeśli nie, 401 „Konto nie istnieje".
3. `token.sv === user.session_version` — jeśli nie, 401 „Sesja wygasła".

Wspólna funkcja `verifySession(token)` obsługuje i HTTP, i WS. Stare tokeny
bez `sv` są odrzucane (wymusza jednorazowy relogin po deployu).

**Bump `session_version`:**
- `POST /auth/change-password` (własne hasło usera)
- `PATCH /admin/users/:id/password` (admin reset hasła innego usera)

**Delete konta (`DELETE /admin/users/:id`):**
- Kasuje wiersz w `users` → każdy kolejny request = 401 (bo user nie istnieje).
- `closeAllForUser(targetId)` zamyka wszystkie aktywne WS tego usera
  (kod 4001, reason "session ended").

## Wpływ na UX

**Po deployu:** każdy user zostanie **raz wylogowany** (stary token bez `sv`
zostanie odrzucony). Logujesz się ponownie, wszystko wraca.

**Zmiana hasła** (jeśli podłączysz UI): wylogowanie ze wszystkich urządzeń.
Trzeba zalogować się nowym hasłem. Standardowe zachowanie (GitHub, Google).

**Admin reset hasła:** user traci wszystkie sesje natychmiast.

**Usunięcie konta:** user traci dostęp do HTTP i WS natychmiast.

## Deployment

Podmień pliki:
- `sync/src/db.ts`
- `sync/src/auth.ts`
- `sync/src/routes/auth.ts`
- `sync/src/routes/admin.ts`
- `sync/src/ws.ts`
- `sync/src/index.ts`

Frontend — **bez zmian**. `onUnauthorized` w `client.ts` już reaguje na 401
(czyszczenie tokenu + logout). Nowe kody 401 („Sesja wygasła", „Konto nie
istnieje") zostaną obsłużone tą samą ścieżką.

`docker compose up -d --build`. **Po deployu zaloguj się ponownie.**

## Test

1. Zaloguj się → działa (nowy token z `sv: 1`).
2. Wygeneruj obraz / wyślij wiadomość → działa.
3. Admin panel → zmień hasło usera B → user B zostaje wylogowany przy
   następnym requeście (DevTools Network pokaże 401).
4. Admin panel → usuń konto C → konto C natychmiast traci HTTP i WS
   (DevTools WS pokaże close 4001).
5. Restart serwera → sesje trwają (sv w bazie nie zmienił się).
6. Wpisz w DevTools Console na koncie:
   ```js
   localStorage.setItem('rp-sync-token', 'garbage')
```

Odśwież → auto-logout (401 z backendu, `onUnauthorized` czyści token).

## Uwagi do przyszłości

- **Global logout** (przycisk „wyloguj ze wszystkich urządzeń") — można
dorobić jako `POST /auth/logout-all` bumpujący `sv`. Nie dodane teraz,
bo zwykłe `logout` (client-side clear) wystarcza dla codziennego użycia.
- **Lista aktywnych sesji** (IP, user-agent, ostatnia aktywność) — wymaga
osobnej tabeli `sessions` z per-token trackingiem. Nie jest to teraz
potrzebne, ale gdyby user zgubił telefon — bez tego nie może zobaczyć
z jakich urządzeń jest zalogowany.
- **Rotacja JWT_SECRET** — bump wszystkich `session_version` unieważnia
wszystkie sesje, ale zmiana sekretu i tak jest szybsza (podpis się nie
zgadza). Jedno i drugie działa.

## Stan po Batch 1 + Batch 2

**Zamknięte P1:**

- ✅ SSRF proxy (Batch 0)
- ✅ Cache ustawień per-user (Batch 1)
- ✅ GC ochrona świeżych blobów (Batch 1)
- ✅ Token usuniętego konta + wersjonowanie sesji (Batch 2)

**Otwarte P1:**

- ⏳ Merge rozmów gubi edycje/usunięcia — wymaga redesignu protokołu (Batch 3)

**Otwarte P2 (na później):**

- Filtr 3s WS zbyt szeroki / nie rozróżnia urządzeń
- Brak kolejki PUT dla rozmów
- CardEditor stale `_serverUpdatedAt`
- Toggles narzędzi nie blokują tool calls w OpenAIAdapter
- Summary oznacza za dużo wiadomości
- `saveBlob` race przy równoległych uploadach

