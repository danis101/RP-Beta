# Batch: per-conversation image style

Feature: użytkownik wybiera styl obrazu dla konkretnej konwersacji. Styl idzie
do refinera jako twarda dyrektywa `[STYLE: <wartość>]`. Lista styli jest
definiowana przez usera w Settings (zero hardkodowania — każdy mostek ma inną).

## Nowe pola

**`AppSettings.imageGenCustomStyles: string[]`** — lista styli zdefiniowana
przez usera. Edytowana w `ToolsSettings` (textarea, jeden per linia, dedup przy
blur). Puste = dropdown w menu konwersacji nieaktywny.

**`Conversation.imageStyleId?: string`** — wybrany styl dla tej konkretnej
konwersacji. Pusty/undefined = auto (refiner decyduje).

**`RefineContext.imageStyleDirective?: string`** — wartość z konwersacji,
przekazywana do `refineImagePrompt`. Refiner dostaje ją jako sekcję
`## WYMAGANY STYL` w user message.

**`ToolContext.imageStyleDirective?: string`** — dla `generateImageTool`,
przekazywana z App.tsx.

## UI

**Menu ⋮ w ChatView** — nowa pozycja "Styl obrazu" (ikona `Wand2`), widoczna
tylko gdy `imageGenEnabled`. Obok badge z aktywną wartością (jeśli ustawiona).

**`ImageStyleDialog.tsx`** (nowy) — modal z listą styli z Settings +
pole custom. Trzy akcje: Auto (wyczyść), Zapisz, Anuluj.

**Nagłówek czatu** — badge `Styl: <wartość>` przy statusie postaci gdy styl
jest ustawiony dla konwersacji.

## Decyzje projektowe

- **Zero hardkodowania listy** — user definiuje co jego mostek akceptuje.
- **Zero parsowania z promptu refinera** — to byłby fragile coupling.
- **Jeden dropdown per konwersacja** (nie globalny w Settings) — bo scena się
  zmienia między rozmowami (jedna rozmowa fantasy, druga portretowa).
- **Tylko STYLE, bez FORMAT** — format jest bardziej zależny od sceny niż od
  preferencji usera. Można dorobić później jeśli będzie potrzeba.
- **Refiner prompt ma sekcję "WYMAGANY STYL OD USERA"** — model wie co
  zrobić gdy dostanie dyrektywę. Zero walidacji w kodzie.

## Deployment

Podmień pliki:
- `frontend/src/types.ts`
- `frontend/src/context/SettingsContext.tsx`
- `frontend/src/lib/refiner.ts`
- `frontend/src/lib/toolRegistry/types.ts`
- `frontend/src/lib/toolRegistry/generateImage.ts`
- `frontend/src/components/chat/ImageStyleDialog.tsx` (nowy)
- `frontend/src/components/chat/ChatView.tsx`
- `frontend/src/components/settings/ToolsSettings.tsx`
- `frontend/src/locales/pl.json`
- `frontend/src/locales/en.json`

`docker compose up -d --build`.

**Uwaga o App.tsx:** trzeba dodać:
1. Handler `handlePickImageStyle` (analogiczny do `handlePickStyle`)
2. Props do `<ChatView>`: `availableImageStyles={settings.imageGenCustomStyles}`,
   `activeImageStyleId={activeConversation.imageStyleId}`,
   `onPickImageStyle={handlePickImageStyle}`
3. W `handleGenerateImage` i w `toolCtx` (finishCompletion) przekazać
   `imageStyleDirective: activeConversation.imageStyleId`

Fragmenty do wklejenia w App.tsx:

```tsx
// Handler (obok handlePickStyle):
const handlePickImageStyle = (styleId: string | undefined) => {
  if (!activeConversation) return
  const updated: Conversation = { ...activeConversation, imageStyleId: styleId }
  setConversations((prev) => prev.map((c) => (c.id === activeId ? updated : c)))
  persistConversation(updated)
}
```

```
// ChatView props (obok activeStyleId):
availableImageStyles={settings.imageGenCustomStyles}
activeImageStyleId={activeConversation.imageStyleId}
onPickImageStyle={handlePickImageStyle}
```

```
// handleGenerateImage — w refineImagePrompt ctx:
{
  character: activeCharacter,
  persona: activePersona,
  history: activeConversation.messages,
  contextMessages,
  imageStyleDirective: activeConversation.imageStyleId,
}
```

```
// finishCompletion — w toolCtx:
imageStyleDirective: activeConversation?.imageStyleId,
```

## Test

1. Settings → Narzędzia → Generowanie obrazów → "Własne style obrazu":
wpisz kilka (np. Realistic / Anime / Fantasy), jeden per linia, kliknij poza.
2. Otwórz czat → menu ⋮ → "Styl obrazu" → wybierz "Anime" → Zapisz.
3. W nagłówku pojawia się badge `Styl: Anime`.
4. Wygeneruj obraz (różdżką albo tool callem) → w logach mostka widać
`[STYLE: Anime]` na początku promptu.
5. Menu ⋮ → Styl obrazu → Auto → Zapisz → badge znika, mostek dostaje
prompt bez wymuszonego stylu.

## Znane ograniczenia

- Brak edycji listy styli przez UI poza textarea (bez drag&drop, bez osobnych
wierszy). Świadomie — lista jest mała i rzadko zmieniana.
- Styl nie jest przekazywany do `regenerateImage` (regeneracja różdżki używa
tego samego promptu co oryginał, więc tag już w nim jest).
- i18n: klucze dodane w PL i EN. Diakrytyki w kodzie bez ogonków (konwencja),
w UI tak jak reszta projektu.

