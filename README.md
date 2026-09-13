# RP Beta

A self-hosted, messenger-style frontend for roleplay and everyday conversations with language models. Bring your own model endpoint, create or import character cards, and keep your conversations and images on your own server.

**Work in progress, already usable.** Core chat, character management, image generation, and server-backed storage are implemented. Synchronization merges messages individually and preserves message deletions across devices. Expect changes and keep backups before updating.

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
- **Multiple user accounts**, created and managed by an administrator, with per-user settings isolation.
- **Session management** — password changes and admin resets invalidate active sessions; per-account session versioning keeps tokens scoped.
- **Server-backed settings and content**, with WebSocket change notifications.
- **Blob storage** for new portraits, avatars, attachments, and generated images, with garbage collection that protects freshly uploaded files. Legacy inline images remain supported.
- **Integration proxy** for model, search, and image services — authenticated, allowlist-scoped, and timeout-bounded.
- **English and Polish UI.**
- **Mobile chat layout** with bottom navigation, a separate conversation list, and a section dropdown in settings.

## How it runs

One Docker container serves both the web interface and the API on port `8787`.

| Component | Stack |
| --- | --- |
| Frontend | React, TypeScript, Vite, Tailwind CSS |
| Backend | Bun, Hono |
| Storage | SQLite and content-addressed image files |
| Updates across devices | WebSocket notifications |
| Authentication | JWT sessions with per-account session versioning, Argon2id password hashing |

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

```
Copy-Item .env.example .env
```

Edit `.env` and replace the example values:

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | A long, random secret used to sign login sessions |
| `ADMIN_USERNAME` | Initial administrator username |
| `ADMIN_PASSWORD` | Initial administrator password, at least 8 characters |

For example, generate a secret on Linux/macOS with:

```
openssl rand -hex 32
```

Or in PowerShell:

```
$secretBytes = New-Object byte[] 32
$generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$generator.GetBytes($secretBytes)
$generator.Dispose()
[BitConverter]::ToString($secretBytes).Replace('-', '').ToLowerInvariant()
```

Copy the generated value into `JWT_SECRET`. Keep `.env` private.

Optional environment variables (sensible defaults built in; set only if you need to change behavior):

| Variable ↕▾ | Default ↕▾ | Purpose ↕▾ |
|---|---|---|
| `PROXY_ALLOWED_HOSTS` | *(empty)* | Comma-separated hosts allowed as integration proxy targets. Empty means private LAN addresses only. Add public hostnames here if your model/image/search services live outside your LAN. |
| `PROXY_TIMEOUT_GET_MS` | `60000` | Timeout for GET requests through the integration proxy (model lists, web search). |
| `PROXY_TIMEOUT_POST_MS` | `600000` | Timeout for POST requests through the integration proxy (chat streaming, image generation). Raise only if your image generator or a cold-start model takes even longer. |
| `GC_MIN_BLOB_AGE_MS` | `3600000` (1h) | Age below which uploaded blobs are protected from garbage collection even without references. |
| ⚙ |  |  |

### 3. Start the application

```
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

If your services are on public hostnames (rather than private LAN IPs), add them to `PROXY_ALLOWED_HOSTS` in `.env`. The proxy refuses public hosts by default to prevent the server from being used as an open relay.

## User accounts and shared services

Only an administrator can create accounts; there is no public registration. Open the shield icon in the app or visit [the local admin panel](http://localhost:8787/#/admin).

Administrator actions in the panel:

- **Create an account.** New accounts receive a starter assistant card and a user persona.
- **Reset a password.** The target user is signed out from all devices immediately.
- **Delete an account.** All of the account's entities, blobs, and active sessions are removed.

Users manage their own password from **Settings → Account**. Changing it invalidates the user's other active sessions (other devices stay signed out until re-login); the current session remains active.

Per-user data:

- Settings, AI profiles, and any saved API keys are stored **per account** on the RP server and cached in the browser under a per-user key. Different accounts on the same browser do not share configuration.
- Accounts can share the same model servers, image bridge, and API credentials when their owners configure them to point at the same backends.

Treat the database, browser profile, and backups accordingly. This is a trusted-group application, not a hardened multi-tenant service.

## Development status

The application is usable and suitable for a trusted group on a LAN or VPN. Known limitations, all tracked for future work:

- **Concurrent message editing:** conflicting edits to the same message use per-message last-write-wins, with the server copy winning equal timestamps. Deleted messages stay deleted across devices. This does not combine the text of two competing edits; device clock differences can affect which edit wins.
- **Conversation settings on conflict:** persona, style, and lorebook selection on a conversation use a preference for the local value only when it is set. Clearing a setting on one device may revive the value from another device on the next merge. Per-field versioning is planned.
- **Conversation save queue:** each conversation change triggers an independent PUT. Rapid edits on slow networks may benefit from a save queue and a visible saving/error indicator; this is planned.
- **API profile preset exchange:** explicit JSON export/import, with optional inclusion of API keys, is not yet implemented. Configure each profile manually per account for now.
- **Background generation:** text generation/regeneration and web search use durable server jobs when image tools and automatic summaries are disabled and the prompt has no multimodal content. The UI reconnects after phone sleep or reload. Images, automatic summaries, and regeneration from an older user turn still use the browser workflow; a visible notice identifies that path.
- **Ministral reasoning — open, deferred:** a direct LM Studio API test returned empty `reasoning_content` and zero `reasoning_tokens`; TAVO also showed no separate reasoning. Whether this depends on model behavior, its chat template, the system prompt, or LM Studio settings remains unresolved. The frontend supports dedicated reasoning fields and leading `[THINK]` / `<think>` blocks; no prompt is added to force reasoning.
- **Summarizer boundary:** the summarizer marks the current message count as processed; messages appended during summarization may be skipped in the next cycle. Message-ID based tracking is planned.
- **Large `App.tsx`:** logic for saving, generation, and image handling is scheduled to be extracted into dedicated modules.

Existing legacy image fields (`portrait`, `avatar`, `data`) are retained for compatibility with older data and will not be removed without a migration.

The staged server-generation migration is tracked in [the implementation notes](docs/server-generation.md). Shared response parsing, prompt normalization and search formatting are in `shared/llm`; the UI connects to durable text and search jobs. Image workflows are the next stage.

## Network access

Use RP on a trusted LAN or through a VPN such as WireGuard or Tailscale. The application does not provide HTTPS itself. A reverse proxy can provide TLS, but TLS alone does not make this version suitable for public exposure.

The integration proxy (`/llm-proxy`, `/searxng-proxy`, `/images-proxy`) requires an authenticated RP session and only forwards requests to allowlisted destinations:

- Private LAN addresses (`10.*`, `172.16-31.*`, `192.168.*`, `127.*`, link-local) are allowed by default.
- Public hostnames and IPs are refused unless explicitly listed in `PROXY_ALLOWED_HOSTS`.
- Redirects are not followed automatically; a single redirect hop is allowed only to another allowlisted target.

Keep access to the application port restricted to your trusted network anyway. RP is not a hardened service against hostile traffic.

To change the host port, edit the left side of the mapping in `docker-compose.yml`, for example:

```
ports:
  - "8088:8787"
```

Then run `docker compose up -d` and open the new host port.

## Data and backups

The default Compose configuration stores persistent data in `./data` on the host:

```
data/
├── rp-sync.sqlite       # Accounts, settings, content, and blob metadata
└── blobs/               # Uploaded image files, organized by user and hash
```

SQLite may also create WAL and shared-memory files. Back up the **whole directory**, not just the main database file. Preserve `.env` separately in a private location.

For a simple consistent backup, stop the application before copying the data. On Linux/macOS:

```
docker compose stop
tar -czf "rp-backup-$(date +%Y%m%d-%H%M%S).tar.gz" data/
docker compose start
```

On Windows, stop the application, copy the entire `data` directory to your backup location, then start it again.

To restore, stop the application, preserve the current data elsewhere, restore the complete backed-up `data` directory, and start the application. Keep the database and blob files from the same backup together.

## Updating

Back up your data first. For a Git checkout:

```
git pull
docker compose up -d --build
```

For a ZIP installation, update the source files while preserving `.env` and `data`, then rebuild. Implemented schema updates run at backend startup; this beta does not promise compatibility with every future or older release.

Useful commands:

```
docker compose ps
docker compose logs --tail=100 rp
```

## Project layout

```
RP-Beta/
├── frontend/
│   └── src/
│       ├── components/     # Chat, cards, settings, admin, and account UI
│       ├── context/        # Authentication, settings, and conflict state
│       ├── services/       # Model adapters and backend clients
│       └── lib/            # Prompts, formatting, images, and merge logic
├── sync/
│   └── src/
│       ├── routes/         # Accounts, entities, settings, and blobs
│       ├── auth.ts         # JWT, session versioning, and password hashing
│       ├── db.ts           # SQLite schema
│       ├── proxy.ts        # Authenticated, allowlisted integration proxy
│       ├── ws.ts           # Change notifications and session revocation
│       └── gc.ts           # Blob and deleted-entity cleanup
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## License

A project license has not been specified yet.
