# Batch 1: cache ustawień per-user + ochrona świeżych blobów

Zamknięte dwa P1 z review.

## 1. Cache ustawień per-user

**Problem:** `rp-settings` to jeden globalny klucz w localStorage na przeglądarkę.
Logout go nie czyścił. Nowy user bez settings na serwerze dostawał auto-PUT
cudzego cache (razem z `apiKey` poprzedniego usera).

**Fix (`frontend/src/context/SettingsContext.tsx`):**
- Klucz zmieniony na `rp-settings:<userId>` — cache jest per-user.
- Stary globalny `rp-settings` jest jednorazowo usuwany przy starcie
  (bez migracji — bezpieczniej nie przypisać cudzych danych pierwszemu
  zalogowanemu userowi).
- Auto-PUT `defaults → serwer` (przy pierwszym loginie) działa dalej, ale
  teraz wgrywa WYŁĄCZNIE defaults/cache tego usera.
- `refreshFromServer` opakowane w `useCallback` — stabilna tożsamość,
  więc efekt App nie re-sie reconnectuje WS przy każdym renderze (fix P2 #7).
- Timer debounce jest czyszczony przy odmontowaniu providera — zaległy PUT
  nie poleci po logout.

**Efekt:**
- A i B na tej samej przeglądarce → zero mieszania ustawień.
- A wraca po wylogowaniu → cache A jest nietknięty.
- Nowy user → defaults + jego własny cache; nigdy cudze `apiKey`.

## 2. Okres ochronny dla świeżych blobów

**Problem:** plik trafia na serwer natychmiast przy wyborze (upload w InputBar,
portret w CardEditor), a referencja dopiero przy zapisie. GC startuje 5s po
starcie i kasuje wszystkie blobki bez referencji. Wybranie zdjęcia i pozostawienie
otwartego edytora w czasie GC = późniejszy zapis wskazuje nieistniejący plik.

**Fix (`sync/src/gc.ts`, `sync/src/config.ts`):**
- Nowy próg `MIN_BLOB_AGE_MS` (domyślnie 1h, konfigurowalny przez
  `GC_MIN_BLOB_AGE_MS` w env). Bloby młodsze niż próg nie są kasowane, nawet
  bez referencji.
- Referencje zbierane per-user (`Map<userId, Set<sha256>>`) — referencja
  innego usera nie chroni mojego sierotę (fix P2 #12).
- `runGarbageCollection` jest teraz `async` i czeka na faktyczne usunięcia.
  Raport (`deletedBlobs`) pokazuje stan po operacji, nie zaraz po wywołaniu.
- Nowe pola w `GcResult`: `protectedYoung`, `failedDeletes`.

**Efekt:**
- Upload → czekaj godzinę → GC → blob chroniony.
- Upload → zapisz kartę → referencja istnieje → blob chroniony na zawsze.
- Upload → porzuć na >1h → GC faktycznie skasuje sierotę (jak wcześniej).

## Deployment

Pliki do podmiany:
- `frontend/src/context/SettingsContext.tsx`
- `sync/src/config.ts`
- `sync/src/gc.ts`

`docker compose up -d --build`.

Opcjonalnie w `.env`:
```

GC_MIN_BLOB_AGE_MS=3600000

```
(domyślnie i tak 1h, więc można pominąć)

## Test

**Cache per-user:**
1. Zaloguj usera A → ustaw coś charakterystycznego (np. w Narzędziach włącz
   generowanie obrazów).
2. Wyloguj, zaloguj B → Narzędzia → toggle powinien być **off** (defaults B).
3. W DevTools → Application → Local Storage: klucz `rp-settings:A` istnieje
   z danymi A, `rp-settings:B` dopiero powstaje.
4. Wyloguj B, zaloguj A → Twój toggle z powrotem włączony.

**GC:**
- Regresja: wygeneruj obraz → pojawia się w dymku (blob nie zniknął).
- Opcjonalnie: na serwerze `docker compose restart rp` w ciągu 1h od wygenerowania
  obrazu, potem `ls /data/blobs/<user-id>/` — plik powinien nadal istnieć.
  (Wcześniej: mógł zostać skasowany przez 5s-po-starcie GC.)

## Co NIE jest zamknięte

Z review P1 zostają:
- Token usuniętego konta nadal działa (middleware + wersja sesji) — Batch 2
- Merge rozmów gubi edycje/usunięcia (wymaga redesignu protokołu) — Batch 3

Z review P2 (na później):
- Filtr 3s WS ignoruje drugie urządzenie (opóźnienie/zbyt szerokie okno)
- Brak kolejki PUT dla rozmów
- CardEditor stale `_serverUpdatedAt`
- Toggles narzędzi nie blokują tool calli w OpenAIAdapter
- Summary oznacza za dużo wiadomości
- `saveBlob` race przy równoległych uploadach tego samego pliku

