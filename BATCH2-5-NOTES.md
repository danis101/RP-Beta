# Batch 2.5: UI zmiany hasła (własne + admin reset)

Backend endpointy istniały od dawna (`/auth/change-password`,
`/admin/users/:id/password`), ale frontend nigdzie ich nie wołał. Zamknięte.

## Co dodane

### 1. Zakładka "Konto" w Ustawieniach (własne hasło)

Nowy komponent `components/settings/AccountSettings.tsx` + nowy tab
w `SettingsView.tsx` (ikona `User`, na dole listy).

Formularz:
- nazwa zalogowanego usera (read-only)
- aktualne hasło
- nowe hasło (min. 8 znaków)
- potwierdzenie nowego hasła
- walidacja: puste pola / za krótkie / niezgodne / takie samo jak stare
- sukces: zielony banner, auto-znika po 5s

### 2. Admin reset hasła innego usera

W `AdminPanel.tsx` każdy wiersz usera dostał przycisk klucza (`KeyRound`).
Klik → inline formularz pod wierszem: pole "nowe hasło" + przycisk "Zmień".
Sukces → zielony badge obok nazwy usera (5s).

Przed wykonaniem: `window.confirm` z ostrzeżeniem że user zostanie
wylogowany ze wszystkich urządzeń.

## Zmiana UX: własne hasło NIE wylogowuje z bieżącej sesji

Wcześniej `POST /auth/change-password` zwracał `{ ok: true }`. Backend
bumpował `session_version`, token w przeglądarce stawał się nieważny,
następny request → 401 → auto-logout. Poprawne, ale szarpie UX.

Teraz backend zwraca `{ ok: true, token: "<nowy-jwt>" }` — nowy token ma
świeży `sv`. Frontend (`changeMyPassword` w `services/sync/client.ts`)
podmienia token w localStorage. Efekt:

- inne sesje (telefon, druga przeglądarka) — padają natychmiast
- ta sesja — pozostaje zalogowana, zero migania UI

To standard (GitHub, Google, Stripe). Admin reset hasła innego usera
zachowuje stare zachowanie — target user zostaje w pełni wylogowany.

## Deployment

Podmień pliki:
- `sync/src/routes/auth.ts`
- `frontend/src/services/sync/client.ts`
- `frontend/src/services/sync/index.ts`
- `frontend/src/components/settings/AccountSettings.tsx` (nowy)
- `frontend/src/components/settings/SettingsView.tsx`
- `frontend/src/components/admin/AdminPanel.tsx`
- `frontend/src/locales/pl.json`
- `frontend/src/locales/en.json`

`docker compose up -d --build`. Po deployu zaloguj się ponownie (podmiana
route auth).

## Test

**Własne hasło (user):**
1. Ustawienia → Konto → formularz.
2. Wpisz złe aktualne hasło → błąd „Aktualne hasło jest nieprawidłowe".
3. Wpisz dobre → zielony banner „Hasło zmienione".
4. Zamknij i otwórz kartę → nadal zalogowany (token podmieniony).
5. Otwórz **drugą** przeglądarkę (albo tryb prywatny), zaloguj się na to
   samo konto, wróć do pierwszej, zmień hasło. W drugiej przeglądarce
   następny request → wylogowany (401, sesja wygasła).

**Admin reset (admin):**
1. Panel admina → ikona klucza przy userze B → wpisz nowe hasło → Zmień.
2. `window.confirm` pyta o potwierdzenie → OK.
3. Zielony badge „Hasło zmienione" obok nazwy B.
4. B w swojej przeglądarce zostaje wylogowany przy następnej akcji.

## Uwagi

- `adminApi.changeUserPassword` już istniał w `services/sync/admin.ts` —
  tylko podpięcie UI było potrzebne.
- `changeMyPassword` dodane do `client.ts` (obok `login`/`logout`/`fetchMe`).
- Wszystkie stringi przez i18n (PL bez polskich znaków, jak reszta projektu;
  EN obok).
- Zero zmian w `AuthContext` — user object (id/username/isAdmin) się nie
  zmienia przy zmianie hasła.

