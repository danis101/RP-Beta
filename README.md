# RP Beta

A self-hosted, messenger-style frontend for roleplay and everyday conversations with language models. Bring your own model endpoint, create or import character cards, and keep your conversations and images on your own server.

**Work in progress, already usable.** Core chat, character management, image generation, and server-backed storage are implemented. The project is under active development; synchronization, conflict handling, and configuration workflows are still being refined. Expect changes and keep backups before updating.

RP is designed for a trusted **LAN or VPN**, with friends able to use the same model and image-generation services. It is not intended to be deployed as a public internet service.

## Features

- **Character-based chat** with streaming replies, editable messages, regenerated response variants, and configurable text formatting.
- **Character cards** with SillyTavern-style V2/V3 data support and PNG/JSON import and export.
- **Personas, lorebooks, and style presets** to customize conversations and their context.
- **Multiple model profiles** for OpenAI-compatible Chat Completions endpoints, including local model servers such as LM Studio.
- **Image attachments and vision** when supported by the selected model.
- **Image generation** through an OpenAI-compatible image bridge, with prompt refinement and image regeneration.
- **Web search** through SearXNG and model tool calls.
- **Conversation summaries and editable long-term memory.**
- **Multiple user accounts**, created and managed by an administrator.
- **Server-backed settings and content**, with WebSocket change notifications and conflict handling under development.
- **Blob storage** for new portraits, avatars, attachments, and generated images. Legacy inline images remain supported.
- **English and Polish UI.**

## How it runs

One Docker container serves both the web interface and the API on port `8787`.

| Component | Stack |
| --- | --- |
| Frontend | React, TypeScript, Vite, Tailwind CSS |
| Backend | Bun, Hono |
| Storage | SQLite and content-addressed image files |
| Updates across devices | WebSocket notifications |
| Authentication | JWT sessions and Argon2id password hashing |

Model inference, SearXNG, and image generation run as **separate services**. They are not bundled with this container. Configure the services you want to use in the app; optional integrations are not required for basic model chat.

## Quick start

You need Docker with Docker Compose, or Docker Desktop.

### 1. Get the project

Clone this repository or download and extract its ZIP. Open a terminal in the project directory containing `docker-compose.yml`.

### 2. Configure the environment

Copy the example configuration:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Edit `.env` and replace the example values:

| Variable | Purpose |
| --- | --- |
| `JWT_SECRET` | A long, random secret used to sign login sessions |
| `ADMIN_USERNAME` | Initial administrator username |
| `ADMIN_PASSWORD` | Initial administrator password, at least 8 characters |

For example, generate a secret on Linux/macOS with:

```bash
openssl rand -hex 32
```

Or in PowerShell:

```powershell
$secretBytes = New-Object byte[] 32
$generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$generator.GetBytes($secretBytes)
$generator.Dispose()
[BitConverter]::ToString($secretBytes).Replace('-', '').ToLowerInvariant()
```

Copy the generated value into `JWT_SECRET`. Keep `.env` private.

### 3. Start the application

```bash
docker compose up -d --build
```

Convenience scripts are also included: `start.sh` for Linux/macOS and `start.bat` for Windows.

### 4. Sign in

Open [http://localhost:8787](http://localhost:8787) and sign in using the administrator credentials from `.env`.

From another device on your LAN or VPN, use the server's IP address instead of `localhost`, for example `http://192.168.1.100:8787`.

The administrator account is initialized when no administrator exists in the database. Once it exists, changing the credentials in `.env` does not reset its password; use the admin panel.

### 5. Connect a model

Open the app settings and configure an AI profile with your model server's base URL, model name, and API key if required. The endpoint must support the OpenAI-compatible Chat Completions API.

Integration requests pass through the RP backend, so service addresses must be reachable **from the container**. A `localhost` address points to the container itself, not automatically to the machine hosting your model. Use an appropriate LAN address or Docker network hostname.

For image generation, configure a compatible image bridge separately. For web search, configure your SearXNG instance.

## User accounts and shared services

Only an administrator can create accounts; there is no public registration. Open the shield icon in the app or visit [the local admin panel](http://localhost:8787/#/admin).

New accounts receive a starter assistant card and a user persona. Accounts can use the same model servers, image bridge, and API credentials when shared intentionally by their owners.

Settings, including AI profiles and any saved API keys, are stored on the RP server and cached in the browser. Treat the database, browser profile, and backups accordingly. This is a trusted-group application, not a hardened multi-tenant service.

## Development status

The application is usable, but some workflows still need attention:

- **Concurrent editing:** conflict handling is implemented, but simultaneous edits to the same conversation may lose edits or restore deleted messages. Prefer one device at a time for editing a conversation; refresh after reconnecting.
- **Settings initialization:** the current browser cache is shared across logins. A new account without server settings can inherit the previously cached configuration. User-scoped caching and explicit initialization are planned.
- **Image cleanup:** uploaded images use blob storage, but cleanup behavior around unsaved uploads is being refined. Keep important source images and backups.
- **API profile preset exchange:** explicit JSON export/import, with optional inclusion of API keys, is planned and is not yet implemented.

Further work includes more predictable saves, synchronization regression tests, and removal of unused code. Existing legacy image fields are retained for compatibility with older data.

## Network access

Use RP on a trusted LAN or through a VPN such as WireGuard or Tailscale. The application does not provide HTTPS itself. A reverse proxy can provide TLS, but TLS alone does not make this version suitable for public exposure.

The integration proxy routes currently accept client-supplied destinations without requiring an RP login. Keep access to the application port restricted to your trusted network.

To change the host port, edit the left side of the mapping in `docker-compose.yml`, for example:

```yaml
ports:
  - "8088:8787"
```

Then run `docker compose up -d` and open the new host port.

## Data and backups

The default Compose configuration stores persistent data in `./data` on the host:

```text
data/
├── rp-sync.sqlite       # Accounts, settings, content, and blob metadata
└── blobs/               # Uploaded image files, organized by user and hash
```

SQLite may also create WAL and shared-memory files. Back up the **whole directory**, not just the main database file. Preserve `.env` separately in a private location.

For a simple consistent backup, stop the application before copying the data. On Linux/macOS:

```bash
docker compose stop
tar -czf "rp-backup-$(date +%Y%m%d-%H%M%S).tar.gz" data/
docker compose start
```

On Windows, stop the application, copy the entire `data` directory to your backup location, then start it again.

To restore, stop the application, preserve the current data elsewhere, restore the complete backed-up `data` directory, and start the application. Keep the database and blob files from the same backup together.

## Updating

Back up your data first. For a Git checkout:

```bash
git pull
docker compose up -d --build
```

For a ZIP installation, update the source files while preserving `.env` and `data`, then rebuild. Implemented schema updates run at backend startup; this beta does not promise compatibility with every future or older release.

Useful commands:

```bash
docker compose ps
docker compose logs --tail=100 rp
```

## Project layout

```text
RP-Beta/
├── frontend/
│   └── src/
│       ├── components/     # Chat, cards, settings, and admin UI
│       ├── context/        # Authentication, settings, and conflict state
│       ├── services/       # Model adapters and backend clients
│       └── lib/            # Prompts, formatting, images, and merge logic
├── sync/
│   └── src/
│       ├── routes/         # Accounts, entities, settings, and blobs
│       ├── db.ts           # SQLite schema
│       ├── proxy.ts        # Requests to external integrations
│       ├── ws.ts           # Change notifications
│       └── gc.ts           # Blob and deleted-entity cleanup
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## License

A project license has not been specified yet.
