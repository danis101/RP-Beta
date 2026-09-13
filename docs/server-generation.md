# Generowanie odpowiedzi na serwerze

## Cel i stan

Telefon wysyła polecenie rozpoczęcia generowania, a serwer prowadzi je i zapisuje wynik niezależnie od połączenia przeglądarki. Po wybudzeniu frontend odczytuje bieżący stan. Nie potrzebujemy aplikacji natywnej do osiągnięcia tego celu.

Stan na 2026-09-13: **tekst, wyszukiwanie, obrazy, vision, podsumowania i generowanie od starszych wiadomości są podłączone do serwera**. Użytkownik potwierdził wcześniejsze etapy, w tym obrazy. Najnowsze trzy ścieżki wymagają testu wdrożenia. Nie trzeba wyłączać automatycznych podsumowań. Frontend nadal przygotowuje wejście; dopiero przyjęte zadanie działa niezależnie od przeglądarki. MockAdapter pozostaje lokalnym trybem demonstracyjnym. Stare funkcje przeglądarkowe pozostawiono do osobnego sprzątania po testach wdrożenia.

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
3. **Podłączenie frontendu — tekst potwierdzony na wdrożeniu.** Start zadania, postęp, odczyt po powrocie do rozmowy, osobny Stop i prezentacja zachowanego wyniku przy błędzie/konflikcie/przerwaniu. Logika obserwacji jest w `useGenerationJob`, poza App.tsx.
4. **Narzędzia i obrazy — zaimplementowane, obrazy czekają na test wdrożenia.** Refiner, mostek, zapis bloba oraz regeneracja dokładnie na zapisanym prompcie działają w zadaniu. Zachowano pierwszy warunek dostępności narzędzia, osobny profil refinera i kolejność wywołań.
5. **Pozostałe ścieżki — zaimplementowane.** Podsumowania, vision i starszy wpis użytkownika. Retencja zadań jest podłączona do GC. Domknięcie: test wdrożenia na dwóch urządzeniach, porządki w starych funkcjach i kolejka zapisów rozmowy.

## Zasady projektowe dla kolejnego etapu

- Zadanie ma właściciela, ID rozmowy, operację (nowa odpowiedź / wariant), ID docelowej wiadomości oraz własny identyfikator. Nigdy nie korzysta z aktualnie otwartego widoku jako identyfikatora miejsca zapisu.
- Przyjęcie zadania i klucz ponowienia są zapisane przed odpowiedzią HTTP. Ponowienie po utracie odpowiedzi nie uruchamia drugiej generacji. Jedna aktywna odpowiedź/obraz oraz osobno jedno aktywne podsumowanie na rozmowę; inne rozmowy nie są blokowane.
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

Zapisany profil dostarcza adres, model i parametry samplera. Snapshot wywołania zostaje w bazie; klucze API modelu, refinera i SearXNG są używane tylko w pamięci. Opcjonalne `webSearch: true` i `image` włączają odpowiednie narzędzia zgodnie z zapisanymi ustawieniami. Deklaracje pochodzą z serwera. Multimodalne wejście jest obsługiwane przez referencje do własnych blobów lub obrazowe data URL.

Timeout jest taki jak dotychczas dla długich POST: `PROXY_TIMEOUT_POST_MS`, domyślnie **600 000 ms (10 minut)**. Nie dodano limitu 60 sekund. Wykonawca stosuje istniejącą politykę adresów i przekierowań przez prywatne wywołanie handlera proxy, bez dodatkowego połączenia HTTP. Rozłączenie telefonu nie anuluje tego wykonania.

Postęp jest zapisywany najwyżej co 500 ms przy napływie fragmentów; zakończenie zapisuje całość. Po restarcie zadania queued/running otrzymują stan interrupted i nie są automatycznie ponawiane. Anulowanie zachowuje ostatni checkpoint. Usunięcie konta anuluje jego aktywne zadania, a SQLite usuwa rekordy zadań przez FK.

Zmieniona/usunięta wiadomość docelowa lub nowa wiadomość dodana podczas zwykłej generacji powoduje stan conflict. Wygenerowany tekst pozostaje w zadaniu, bez nadpisania ręcznych zmian lub odtworzenia usuniętej treści. Inne zmiany rozmowy są zachowane przy transakcyjnym zapisie wyniku.

Obserwator odczytuje stan aktywnego zadania co 1,5 s, bez aktywnego zadania co 10 s, dodatkowo po powrocie do widocznej karty/online. Wyłączenie streamingu w profilu ukrywa podgląd tokenów; serwer nadal odbiera stream i zapisuje wynik. Utrata odpowiedzi na POST nie powoduje automatycznego ponowienia ani przejścia na generację w przeglądarce. Wynik trafia do rozmowy tylko przez serwer, a frontend scala odczytaną wersję. Wynik ostatniego nieudanego zadania można rozwinąć nad polem wpisywania; nie jest dopisywany jako nowa wiadomość do promptu.

Pozostają: kolejka wszystkich zapisów rozmowy, sprzątanie starych funkcji i test najnowszego etapu na rzeczywistym backendzie. Test wdrożenia: włączyć automatyczne podsumowania (na próbę niski próg), zamknąć przeglądarkę podczas odpowiedzi i sprawdzić pamięć po powrocie. Sprawdzić ręczne podsumowanie, dalsze pisanie w jego trakcie oraz Stop. Włączyć vision i wysłać obraz do modelu obsługującego obrazy, zamknąć przeglądarkę po przyjęciu zadania. Wygenerować odpowiedź od starszego wpisu user: nowa odpowiedź powinna pojawić się na końcu, z zachowaniem późniejszych wiadomości. Sprawdzić też zwykły tekst, wyszukiwanie i obrazy.

## Automatyczne sprzątanie zadań

GC usuwa `succeeded` po 24 godzinach od `updated_at`, a `failed`, `cancelled`, `interrupted` i `conflict` po 7 dniach. `queued` i `running` nie są usuwane niezależnie od wieku. Przebieg odbywa się 5 sekund po starcie serwera i co 24 godziny, więc rekord znika przy pierwszym przebiegu po upływie okresu. Nie zmienia to timeoutów generacji. Indeks `(status, updated_at)` wspiera wyszukiwanie wygasłych rekordów.

Usuwane są techniczne rekordy wraz ze snapshotami promptów, nie wiadomości, warianty ani pamięć zapisane w rozmowach. Wynik pozostawiony wyłącznie w nieudanym zadaniu można odzyskać przez 7 dni. Sprzątanie zadań odbywa się przed zbieraniem referencji do blobów: obraz bez innych referencji może wtedy zostać usunięty przez dotychczasowy GC. Obrazy należące do żywych rozmów nadal są chronione, z rozdzieleniem właścicieli.

Frontend odczytuje rozmowę także przy pustej liście zadań i po wybudzeniu, aby pokazać opublikowaną odpowiedź po wygaśnięciu jej rekordu. Idempotencja po ID działa w okresie przechowywania zadania; frontend nie ponawia automatycznie POST. SQLite wykorzystuje zwolnione miejsce ponownie, ale plik bazy nie musi od razu zmniejszyć rozmiaru. Nie uruchamiamy blokującego `VACUUM` w codziennym GC.

## Podsumowania, vision i starsza wiadomość

Podsumowanie jest zadaniem `operation: "summary"`. Ręczne uruchomienie najpierw zapisuje rozmowę, a serwer wybiera wiadomości, ostatnią pamięć, kartę, personę i zapisany profil. Automatyczne uruchomienie odbywa się w serwisie po opublikowaniu odpowiedzi (bez callbacku przeglądarki), według dotychczasowego progu. Nie uruchamia się po ręcznym obrazie ani po innym podsumowaniu. Jeżeli podsumowanie już trwa, kolejne nie jest uruchamiane. Prompt, wybór ostatnich N wiadomości, nazwy i nadpisanie modelu podsumowania są zachowane. Odczyt używa streamu serwerowego, z zachowaniem fallbacku reasoning przy pustej treści.

Osobny indeks unikalności dopuszcza jedno aktywne podsumowanie obok jednego aktywnego zadania odpowiedzi/obrazu. Podsumowanie nie blokuje wpisywania. Jego wynik trafia wyłącznie do `longTermMemory`, nigdy jako wiadomość assistant. Przed zapisem porównywane są identyfikatory, role i wybrane treści uchwyconego prefiksu rozmowy, dotychczasowa pamięć i indeks. Późniejsze dopisane wiadomości są zachowywane, a granica podsumowania pozostaje na końcu faktycznie uchwyconej historii. Konflikt zachowuje wynik w zadaniu. Lista zadań zawsze zwraca najpierw aktywne, nawet przy wielu późniejszych zakończonych zadaniach.

Vision zachowuje kolejność części tekst/obraz. Frontend wysyła `image_url.url: "rp-blob:<sha256>"`; serwer odczytuje blob wyłącznie danego użytkownika i dopiero przed wywołaniem modelu konwertuje go na data URL. Snapshot nie duplikuje bajtów obrazu. Starsze załączniki inline są uprzednio wgrywane do magazynu blobów, bez modyfikacji zapisanej historii. API nadal akceptuje poprawny obrazowy data URL w limicie rozmiaru żądania; nie pobiera dowolnych zewnętrznych URL. Model czatu pozostaje modelem aktywnego profilu, tak jak w dotychczasowym wywołaniu App.tsx; nie dodano automatycznego przełączania modeli po nazwie. Aktywne/nieudane zadania chronią referencje załączników przed GC.

Starszy wpis user używa `historyTailId`, wskazującego ostatnią wiadomość całej rozmowy przy starcie. Prompt zawiera historię tylko do wybranego wpisu, według dotychczasowych reguł. Wynik jest dopisywany na końcu całej rozmowy; nic nie jest obcinane. Zmiana/usunięcie wiadomości docelowej lub zmiana końca rozmowy w trakcie generacji powoduje konflikt zamiast publikacji w niewłaściwym miejscu.

## Obrazy i bridgev2

Frontend nadal buduje dokładnie ten sam kompaktowy kontekst refinera (karta, persona, wybrany fragment historii, wymagany styl). Przesyła `image: {refinerProfileId, refinerMessages}` jako gotowy snapshot. Serwer wykonuje refiner bez narzędzi, używając jego zapisanego profilu i samplera, następnie wysyła prompt do mostka i zapisuje blob przed opublikowaniem wariantu. Reasoning fallback refinera jest zachowany.

Ręczny obraz używa `operation: "image"`, `mode: "append"`; regeneracja `mode: "regenerate"` i `image: {prompt}`. Backend sprawdza, czy prompt jest dokładnie taki jak w wybranym zapisanym wariancie. Regeneracja nie wymaga ponownego refinera ani włączonego toggle narzędzia modelu. Ręczny obraz można dodać po dowolnej ostatniej wiadomości, także do pustej rozmowy. Konflikt/Stop nie nadpisuje istniejącego wariantu. Zapisany wynik nieudanego zadania można otworzyć w panelu nad polem wpisywania. GC chroni obrazy zachowane w nieudanych/aktywnych zadaniach żywej rozmowy.

Przejrzany mostek: `F:\AI\ComfyUI_windows_portable_nvidia\bridgev2\bridgeimggen.py`. Zwykle zwraca URL `/cdn/...` lub base64. Po 60 próbach historii ComfyUI (około 60 sekund; komentarz 45s jest nieaktualny) zwraca `processing` z `prompt_id`, lecz nie udostępnia endpointu odbioru wyniku po tym zdarzeniu.

Przygotowano osobną poprawkę `bridgev2-wait.patch`: żądania z nagłówkiem `X-RP-Image-Wait-Seconds` mogą dłużej oczekiwać na ten sam `prompt_id`. Bez nagłówka pozostaje dotychczasowe 60 prób, więc TAVO zachowuje dotychczasowy limit. RP wysyła czas wynikający z `PROXY_TIMEOUT_POST_MS` z zapasem 30 sekund (domyślnie 570 sekund). Zastosowanie poprawki i restart mostka są osobnym krokiem poza wdrożeniem Dockera RP. Jeżeli mimo tego mostek zwróci `processing`, zadanie zachowuje prompt i jawnie informuje o braku gotowego obrazu; nie uruchamia drugiej generacji. Stop przerywa odbiór po stronie RP, ale nie obiecuje usunięcia już uruchomionego zadania z kolejki ComfyUI.

Poprawkę zastosowano za zgodą użytkownika do powyższego lokalnego pliku mostka 2026-09-13. Kopia: `bridgeimggen.py.before-rp-wait-20260913-142904.bak` w tym samym katalogu. Sprawdzono składnię Pythona oraz domyślny, poprawny, niepoprawny i nadmierny nagłówek oczekiwania. Proces mostka nie był restartowany.

Workflow zachowuje sekwencyjne wykonanie żądań wyszukiwania i najwyżej jeden dodatkowy przebieg modelu. Nie wykonuje tool calls zwróconych w drugim przebiegu. Wyniki są dołączane w dotychczasowym formacie do zamrożonego promptu, a następnie normalizowane wspólnym `shared/llm/chatCompatibility.ts`. Gotowy wariant otrzymuje źródła zgodnie z `webSearchShowResults`. Podczas pracy nie powstaje tymczasowa wiadomość assistant: postęp jest częścią zadania, a odpowiedź publikowana jest tylko raz.

Addytywna migracja dodaje `workflow_json` do istniejącej tabeli zadań. Zawiera etap (`model`, `web-search`, `follow-up`) i ostatnie wyniki narzędzia; są zachowywane również przy konflikcie, Stop i restarcie. Nie ma automatycznego powtórzenia narzędzia po restarcie. Uprawnienie do wyszukiwania jest ponownie odczytywane z zapisanych ustawień przed wykonaniem. Cooldown jest koordynowany per użytkownik serwera. Żądania nadal przechodzą przez dotychczasową politykę proxy, allowlistę i timeouty.

Testy obserwatora w `frontend/tests/generation-observer.test.cjs` uruchamiają rzeczywisty hook z kontrolowanym hostem efektów i siecią: reconnect, utrata POST, Stop, wyścigi odczytów i zmiana rozmowy. Nie zastępują testu Reacta w przeglądarce ani wdrożenia mobilnego.

Lokalny test bez Dockera/Bun: `node --test sync/tests/generation.node.cjs` z katalogu projektu (Node 24, zależności frontendowe z TypeScript). Uruchamia właściwy kod store/runner na SQLite przez cienki adapter Node; nie zastępuje testu routingu Hono i runtime Bun.
