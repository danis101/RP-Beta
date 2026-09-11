# RP

Frontend i backend dla aplikacji RP w stylu messengera — LLM, karty postaci, lorebooki, generowanie obrazów. Multi-user, dane na własnym serwerze.

## Co to jest

- **Frontend** — React + TypeScript + Tailwind, ciemny motyw, kompatybilny z SillyTavern (karty V2/V3, PNG + JSON).
- **Backend** — Bun + Hono + SQLite. Multi-user, JWT, WebSocket push, bloby content-addressed.
- **Jeden kontener, jeden port** — Hono serwuje zarówno API jak i statyki frontu.

## Szybki start (Docker)

Wymagania: **Docker** + **Docker Compose** (albo Docker Desktop na Windows/Mac).

### 1. Sklonuj / rozpakuj

```bash
git clone https://github.com/TWOJ_USER/rp.git
cd rp
```

albo po prostu rozpakuj ZIP z projektem i wejdź do folderu.

### 2. Skonfiguruj

```
cp .env.example .env
```

Otwórz `.env` i ustaw **trzy rzeczy**:

- `JWT_SECRET` — wygeneruj losowy sekret:

```
# Linux / Mac:
openssl rand -hex 32

# Windows (PowerShell):
-join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
```

Wklej wynik jako wartość `JWT_SECRET`.
- `ADMIN_USERNAME` — nazwa konta administratora (domyślnie `admin`).
- `ADMIN_PASSWORD` — hasło administratora (min. 8 znaków). Możesz je potem zmienić w panelu `#/admin`.

### 3. Uruchom

```
# Linux / Mac:
./start.sh

# Windows:
start.bat

# Albo bezpośrednio:
docker compose up -d --build
```

### 4. Otwórz

- **Aplikacja**: [http://localhost:8787](http://localhost:8787)
- **Panel admina**: [http://localhost:8787/#/admin](http://localhost:8787/#/admin)

Zaloguj się jako `admin` + hasło z `.env`. Wejdź w panel admina i utwórz konta dla innych użytkowników.

**Dostęp z innych urządzeń w sieci lokalnej**: zamiast `localhost` użyj IP maszyny, np. `http://192.168.1.100:8787`.

## Zarządzanie użytkownikami

Konta tworzy **tylko administrator** (publicznej rejestracji nie ma). Po zalogowaniu jako admin:

1. Kliknij ikonę tarczy na dole lewej ramki nawigacji
2. Wpisz nazwę i hasło nowego użytkownika
3. Kliknij „Utwórz"
4. Przekaż login i hasło nowemu użytkownikowi

Nowe konto dostaje automatycznie:

- Kartę **Asystent** (uniwersalna, gotowa do pisania)
- Personę **Użytkownik**

## Dane i backup

Wszystkie dane (baza + obrazy) trzymane są w katalogu `./data/` na hoście:

```
data/
├── rp-sync.sqlite       # baza (użytkownicy, encje, metadane blobów)
└── blobs/               # portrety, awatary, obrazy w konwersacjach
```

### Backup

```
tar czf rp-backup-$(date +%F).tar.gz data/
```

### Odtworzenie

Rozpakuj `data/` z powrotem obok `docker-compose.yml`, odpal kontener.

## Aktualizacja

```
git pull
docker compose up -d --build
```

Migracje bazy są automatyczne przy starcie.

## Zdalny dostęp (VPN)

Serwer nie ma własnego HTTPS — nie wystawiaj go bezpośrednio do internetu. Do zdalnego dostępu użyj VPN (**Tailscale**, **WireGuard**) i połącz się z siecią LAN. Aplikacja działa jak lokalnie.

Alternatywnie jeśli masz zewnętrzny reverse proxy (**Nginx Proxy Manager**), przekieruj domenę na `IP_MASZYNY:8787`. NPM może dodać HTTPS.

## Konfiguracja portu

Domyślnie aplikacja na porcie `8787`. Żeby zmienić:

1. W `docker-compose.yml` zmień `"8787:8787"` na `"TWOJ_PORT:8787"` (lewa strona to port hosta).
2. `docker compose up -d`.

## Struktura projektu

```
rp/
├── sync/                # backend (Bun + Hono)
│   ├── src/
│   │   ├── index.ts     # punkt wejścia, serwuje API + statyki frontu
│   │   ├── db.ts        # SQLite schema
│   │   ├── auth.ts      # JWT + hasła argon2id
│   │   ├── seed.ts      # admin + karta Asystent
│   │   ├── gc.ts        # garbage collector blobów
│   │   └── routes/      # endpointy
│   └── package.json
├── frontend/            # React + Vite
│   ├── src/
│   │   ├── App.tsx      # główny komponent
│   │   ├── services/    # adaptery API (LLM, sync)
│   │   ├── components/  # UI (chat, karty, ustawienia, admin)
│   │   └── lib/         # logika (lorebooki, style, prompty)
│   └── package.json
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## Bezpieczeństwo

- **Hasła**: argon2id (Bun.password).
- **JWT**: HS256, 30 dni. Sekret w `.env` — trzymaj go poza gitem.
- **Klucze API LLM**: trzymane lokalnie w przeglądarce (localStorage), **nie idą na serwer**.
- **Rate limit logowania**: 5 prób / minutę / IP.
- **Bez HTTPS w aplikacji** — użyj VPN albo zewnętrznego reverse proxy (NPM, Caddy).

## Licencja

MIT (albo inna — decyzja twoja).

