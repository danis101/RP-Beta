# Batch 2.6: natychmiastowe wylogowanie przy unieważnieniu sesji

Domknięcie UX luki z Batch 2: reset hasła / delete konta przez admina
unieważniał token na serwerze, ale **UI** target usera dowiadywał się o tym
dopiero przy następnym requestcie HTTP (F5 albo kliknięcie czegokolwiek).
W praktyce na drugim urządzeniu user mógł siedzieć 10 minut i nie wiedzieć.

## Co dodane

**Backend (`sync/src/ws.ts`):**
- Nowy typ eventu `{ type: 'session.revoked', reason? }`.
- Funkcja `revokeUserSessions(userId, reason)`:
  1. Wysyła event `session.revoked` do wszystkich WS tego usera.
  2. Po 300 ms (daje przeglądarce czas na przetworzenie) zamyka połączenie.
- `closeAllForUser` bez zmian — nadal używane, teraz przez `revokeUserSessions`.

**Backend (`sync/src/routes/admin.ts`):**
- `DELETE /admin/users/:id` → `revokeUserSessions(targetId, 'account deleted')`
  zamiast `closeAllForUser`.
- `PATCH /admin/users/:id/password` → `revokeUserSessions(targetId, 'password changed by admin')`
  po bumpie `session_version`.

**Frontend (`services/sync/client.ts`):**
- Nowy eksport `notifySessionRevoked()` — wywołuje tę samą logikę co 401
  (`setToken(null)` + wszyscy subskrybenci `onUnauthorized`).
- AuthContext już subskrybuje `onUnauthorized` → `clearBlobCache()` + `setUser(null)`.

**Frontend (`services/sync/ws.ts`):**
- Rozpoznaje `session.revoked` w `onmessage`.
- Wywołuje `notifySessionRevoked()`.
- Ustawia lokalny `closed = true` → **przestaje się reconnectingować**.
  Bez tego klient próbowałby wrócić do serwera bez tokenu (bezcelowa pętla).

## Efekt

**Admin reset hasła usera B:**
- B dostaje WS event w milisekundach → natychmiastowe wylogowanie do ekranu
  logowania. Zero czekania na F5 czy kliknięcie.

**Admin delete konta C:**
- C dostaje WS event → logout. WS zamyka się po 300 ms (jeśli jeszcze żyje).
- Kolejne próby połączenia HTTP z tokenem C → 401 (konto nie istnieje).

**Własna zmiana hasła (self):**
- Bez zmian — token jest podmieniany na nowy z nowym `sv`, sesja trwa.
- Inne urządzenia użytkownika dostaną 401 przy następnym requestcie (bo ich
  `sv` się nie zgadza). Pełne „natychmiastowe" wylogowanie wszystkich sesji
  przy self-change wymagałoby śledzenia per-token (osobna tabela `sessions`),
  ale to nie jest teraz krytyczne — self-change jest świadomą akcją usera.

## Deployment

Podmień pliki:
- `sync/src/ws.ts`
- `sync/src/routes/admin.ts`
- `frontend/src/services/sync/client.ts`
- `frontend/src/services/sync/ws.ts`
- `frontend/src/services/sync/index.ts`

`docker compose up -d --build`.

## Test

**Admin reset hasła:**
1. Zaloguj B w drugiej przeglądarce (albo trybie prywatnym).
2. Zaloguj admina w pierwszej → panel admina → ikona klucza przy B → nowe hasło → Zmień.
3. W drugiej przeglądarce (B) ekran **natychmiast** przeskakuje do logowania.
   DevTools → Network → WS → powinien być widoczny frame `{"type":"session.revoked",...}`
   tuż przed close 4001.

**Admin delete konta:**
1. Zaloguj C w drugiej przeglądarce.
2. Admin usuwa C.
3. C natychmiast wylogowany. Kolejne próby logowania → „Nieprawidłowe dane logowania".

**Regresja — własna zmiana hasła:**
1. Zalogowany user → Ustawienia → Konto → zmiana hasła.
2. Zielony banner, **pozostaje zalogowany**, żadne WS nie zostało zamknięte.

## Co NIE jest objęte

- **Self-change z drugiej sesji** — user zmienia hasło na urządzeniu A,
  urządzenie B dowie się przy następnym requestcie (401). Pełne natychmiastowe
  wymagałoby per-token session tracking (tabela `sessions` w bazie, ID sesji
  w JWT, dedykowany event broadcast per sesja). To osobny temat, jeśli będzie
  potrzebny.
- **Force logout z admin panelu** (bez zmiany hasła) — endpoint
  `POST /admin/users/:id/logout` byłby trywialny do dodania (bump sv +
  revokeUserSessions), ale nie ma jeszcze UI. Na życzenie.

