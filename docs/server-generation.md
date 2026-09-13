# Generowanie odpowiedzi na serwerze

## Cel i stan

Telefon wysyła polecenie rozpoczęcia generowania, a serwer prowadzi je i zapisuje wynik niezależnie od połączenia przeglądarki. Po wybudzeniu frontend odczytuje bieżący stan. Nie potrzebujemy aplikacji natywnej do osiągnięcia tego celu.

Stan na 2026-09-13: **frontend podłączony do zadań tekstowych**. Dotyczy generacji i regeneracji tekstu przez skonfigurowany profil API, przy wyłączonych narzędziach i automatycznych podsumowaniach, bez multimodalnego wejścia. Regeneracja od starszej wiadomości użytkownika zachowuje ścieżkę przeglądarkową. Obrazy, wyszukiwanie i podsumowania wymagają przeniesienia całego workflow; niczego nie wyłączamy automatycznie. Interfejs pokazuje, gdzie trwa wykonanie. Runtime Bun/Docker wymaga sprawdzenia na serwerze.

## Ustalenia z przeglądu kodu

- `frontend/src/App.tsx`: buduje prompt, wybiera warianty i fragment historii, uruchamia model, wykonuje narzędzia, dopisuje odpowiedź i zapisuje rozmowę.
- `frontend/src/lib/chatCompatibility.ts`: porządkuje dopiero gotowe żądanie, po dołączeniu dodatkowych wiadomości. Zachować tę kolejność.
- `frontend/src/lib/toolRegistry/generateImage.ts`: refiner → mostek obrazów → upload bloba; zapisuje prompt umożliwiający regenerację obrazu bez ponownego refinera.
- Wyszukiwanie dodaje wyniki do kolejnego wywołania modelu. Przeniesienie samego pierwszego streamu nie zapewni ciągłości tego łańcucha.
- `sync/src/proxy.ts`: uwierzytelnione proxy z ograniczeniem adresów i timeoutem; obecnie nie jest wykonawcą trwałych zadań.
- `sync/src/routes/entities.ts`: zapisuje całą encję z optimistic locking. Wynik zadania musi być dopisany do aktualnego stanu rozmowy, a nie nadpisywać go kopią sprzed generowania.
- WebSocket powiadamia o zmianach. Samo utrzymanie WebSocketu nie zapewnia działania po uśpieniu telefonu.

## Etapy do wdrażania i sprawdzania osobno

1. **Wspólny odczyt odpowiedzi — wykonany.** Wydzielenie istniejącego parsera SSE, reasoning i typów callbacków z części przeglądarkowej. Dotychczasowe żądania, prompty, narzędzia i sposób zapisu pozostają takie same. Docker kopiuje moduł wspólny do etapu budowania i obrazu serwera.
2. **Trwałe zadanie tekstowe — zaimplementowane, do weryfikacji na Bun/Docker.** Addytywna tabela SQLite, rozpoczęcie/odczyt/anulowanie zadania, identyfikator ponowienia oraz transakcyjny zapis wyniku do właściwej rozmowy. Testy SQLite i wykonawcy uruchomiono lokalnie w Node 24 z kontrolowanym strumieniem, bez modeli i usług zewnętrznych.
3. **Podłączenie frontendu — wykonane dla tekstu, czeka na test wdrożenia.** Start zadania, postęp, odczyt po powrocie do rozmowy, osobny Stop i prezentacja zachowanego wyniku przy błędzie/konflikcie/przerwaniu. Logika obserwacji jest w `useGenerationJob`, poza App.tsx.
4. **Narzędzia i obrazy.** Przenieść cały obecny łańcuch, wraz z refinerem, wynikiem wyszukiwania, obsługą odpowiedzi mostka, blobami i regeneracją na zapisanym prompcie. Zachować filtrowanie narzędzi i kontrolę uprawnień przed wykonaniem.
5. **Domknięcie migracji.** Dwa urządzenia, edycje/usunięcia podczas generowania, przerwanie procesu i rekoncyliacja stanu. Dopiero po tych testach usuwać zastąpione ścieżki wykonania. Podsumowania wymagają osobnego uwzględnienia; nie przenosić przy okazji błędu granicy podsumowania.

## Zasady projektowe dla kolejnego etapu

- Zadanie ma właściciela, ID rozmowy, operację (nowa odpowiedź / wariant), ID docelowej wiadomości oraz własny identyfikator. Nigdy nie korzysta z aktualnie otwartego widoku jako identyfikatora miejsca zapisu.
- Przyjęcie zadania i klucz ponowienia są zapisane przed odpowiedzią HTTP. Ponowienie po utracie odpowiedzi nie uruchamia drugiej generacji. Jeden aktywny przebieg na rozmowę; inne rozmowy nie muszą być blokowane.
- Snapshot wejścia utrwala gotowy prompt i konfigurację wywołania. Reconnect nie buduje ponownie promptu, nie losuje ponownie zmiennych presetu i nie zmienia kolejności instrukcji. Klucze API i pełna treść promptu nie trafiają do powiadomień o postępie.
- Serwer ma własny kontroler anulowania. Rozłączenie HTTP/WebSocket nie oznacza anulowania zadania. Przycisk Stop wysyła osobne polecenie.
- Stan zadania i częściowa odpowiedź są odczytywalne po reconnect. Postęp ma rosnącą rewizję; zapis fragmentów jest grupowany, a nie wykonywany dla każdego tokena. Wynik końcowy musi być trwały przed oznaczeniem zadania jako zakończonego.
- Końcowy zapis odbywa się transakcyjnie na aktualnej rozmowie. Usuniętej rozmowy lub wiadomości nie odtwarzamy. Przed zmianami sprawdzić też, jak stary frontend zapisujący całe rozmowy współdziała z nowym właścicielem odpowiedzi.
- Operacje zadań sprawdzają właściciela. Bezpośrednie żądania serwera do integracji muszą zachować obecne ograniczenia adresów, przekierowań i czasu; nie omijać ich wraz z rezygnacją z proxy przeglądarkowego.
- Restart Dockera jest innym zdarzeniem niż sen telefonu. Niedokończone zadanie powinno być jawnie oznaczone jako przerwane, z zachowanym zapisanym postępem. Nie obiecywać automatycznego wznowienia generacji modelu od tego samego tokena.
- Po niepewnym wyniku zewnętrznego narzędzia nie uruchamiać go automatycznie ponownie: mogłoby to wygenerować drugi obraz. Osobno zapisywać etap i wynik narzędzia.

## Kontrola pierwszego kroku

- Testy frontendowe ćwiczą rzeczywisty adapter korzystający już ze wspólnego parsera: tekst, reasoning, błędy SSE i deklaracje/odpowiedzi narzędzi.
- Wspólne moduły muszą kompilować się bez Reacta, `localStorage`, kodu logowania i zależności Bun. Korzystają z `Response`, `ReadableStream` i `TextDecoder`.
- Lokalnie dostępne są Node i build frontendu. Docker oraz Bun nie są dostępne do testów runtime; obraz i działanie backendu sprawdza użytkownik na serwerze.

## Otwarte, odłożone: reasoning Ministrala

Bezpośredni test LM Studio zwrócił pusty `reasoning_content` i `reasoning_tokens: 0`; TAVO również nie pokazało reasoning. Nie ustalono, czy zależy to od modelu, szablonu, system promptu czy ustawień LM Studio. Nie wymuszamy reasoning dodatkowymi instrukcjami i nie łączymy tej diagnozy z migracją na serwer.

## API etapu tekstowego

Wszystkie poniższe endpointy wymagają standardowego `Authorization: Bearer <token RP>` i ograniczają dostęp do właściciela zadania.

- `POST /generation-jobs` — przyjmuje zadanie, zwraca HTTP 202 ze stanem. Powtórzenie identycznego żądania z tym samym ID zwraca istniejące zadanie (HTTP 200); inne dane pod tym samym ID zwracają 409.
- `GET /generation-jobs/:id` — stan, rewizja, tekst, reasoning i ewentualny błąd. Nie zwraca promptu ani danych uwierzytelniających.
- `GET /generation-jobs?conversationId=...` — ostatnie 30 zadań tej rozmowy, w tym aktywne.
- `POST /generation-jobs/:id/cancel` — jawne anulowanie; nie zmienia zadania już zakończonego.

Przykład body rozpoczęcia (identyfikatory i wersja muszą odpowiadać zapisanej rozmowie oraz profilowi):

```json
{
  "id": "unikalny-identyfikator-ponowienia",
  "conversationId": "id-rozmowy",
  "targetMessageId": "id-ostatniej-wiadomosci-user",
  "mode": "append",
  "expectedUpdatedAt": 123456789,
  "profileId": "id-zapisanego-profilu-api",
  "messages": [
    { "role": "system", "content": "Gotowy prompt, z zachowaną kolejnością bloków." },
    { "role": "user", "content": "Wiadomość użytkownika." }
  ]
}
```

`regenerate` wskazuje istniejącą wiadomość assistant i dodaje jej nowy wariant. Frontend najpierw kończy zapis wiadomości użytkownika i przekazuje gotowy prompt po obecnej normalizacji. Backend nie odbudowuje promptu i nie losuje ponownie zmiennych presetu. Jeśli zapis przed regeneracją zmieni historię przez merge, trzeba przejrzeć rozmowę i ponowić generację; nie wysyłamy promptu dla innej wersji wiadomości.

Zapisany profil dostarcza adres, model i parametry samplera. Snapshot wywołania zostaje w bazie; klucz API jest używany tylko w pamięci i nie jest kopiowany do zadania. Ten etap zawsze odbiera wewnętrzny stream tekstowy; nie oferuje jeszcze obsługi narzędzi, obrazów ani multimodalnego wejścia. Przesłane wywołania narzędzi są odrzucane.

Timeout jest taki jak dotychczas dla długich POST: `PROXY_TIMEOUT_POST_MS`, domyślnie **600 000 ms (10 minut)**. Nie dodano limitu 60 sekund. Wykonawca stosuje istniejącą politykę adresów i przekierowań przez prywatne wywołanie handlera proxy, bez dodatkowego połączenia HTTP. Rozłączenie telefonu nie anuluje tego wykonania.

Postęp jest zapisywany najwyżej co 500 ms przy napływie fragmentów; zakończenie zapisuje całość. Po restarcie zadania queued/running otrzymują stan interrupted i nie są automatycznie ponawiane. Anulowanie zachowuje ostatni checkpoint. Usunięcie konta anuluje jego aktywne zadania, a SQLite usuwa rekordy zadań przez FK.

Zmieniona/usunięta wiadomość docelowa lub nowa wiadomość dodana podczas zwykłej generacji powoduje stan conflict. Wygenerowany tekst pozostaje w zadaniu, bez nadpisania ręcznych zmian lub odtworzenia usuniętej treści. Inne zmiany rozmowy są zachowane przy transakcyjnym zapisie wyniku.

Obserwator odczytuje stan aktywnego zadania co 1,5 s, bez aktywnego zadania co 10 s, dodatkowo po powrocie do widocznej karty/online. Wyłączenie streamingu w profilu ukrywa podgląd tokenów; serwer nadal odbiera stream i zapisuje wynik. Utrata odpowiedzi na POST nie powoduje automatycznego ponowienia ani przejścia na generację w przeglądarce. Wynik trafia do rozmowy tylko przez serwer, a frontend scala odczytaną wersję. Wynik ostatniego nieudanego zadania można rozwinąć nad polem wpisywania; nie jest dopisywany jako nowa wiadomość do promptu.

Pozostają: retencja starych zadań, kolejka wszystkich zapisów rozmowy, migracja narzędzi/podsumowań i test długiej generacji na rzeczywistym backendzie. Test wdrożenia: wyłączyć oba narzędzia i automatyczne podsumowania, wysłać tekst, poczekać na komunikat o wykonaniu na serwerze, wygasić ekran lub odświeżyć stronę, sprawdzić pojedynczą odpowiedź i reasoning (jeśli model je zwraca), następnie regenerację wariantu i Stop. Osobno sprawdzić dotychczasowe gen/regen obrazu.

Testy obserwatora w `frontend/tests/generation-observer.test.cjs` uruchamiają rzeczywisty hook z kontrolowanym hostem efektów i siecią: reconnect, utrata POST, Stop, wyścigi odczytów i zmiana rozmowy. Nie zastępują testu Reacta w przeglądarce ani wdrożenia mobilnego.

Lokalny test bez Dockera/Bun: `node --test sync/tests/generation.node.cjs` z katalogu projektu (Node 24, zależności frontendowe z TypeScript). Uruchamia właściwy kod store/runner na SQLite przez cienki adapter Node; nie zastępuje testu routingu Hono i runtime Bun.
