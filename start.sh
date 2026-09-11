#!/usr/bin/env bash
# RP — skrypt startowy (Linux / macOS).
# Sprawdza .env, buduje obrazy, uruchamia kontenery.

set -e

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo ""
  echo "Brak pliku .env."
  echo "Skopiuj .env.example jako .env i uzupełnij wartości:"
  echo ""
  echo "  cp .env.example .env"
  echo "  # wygeneruj sekret: openssl rand -hex 32"
  echo "  # wpisz go w .env jako JWT_SECRET, ustaw też ADMIN_PASSWORD"
  echo ""
  exit 1
fi

if grep -q "change-me-generate-your-own" .env; then
  echo ""
  echo "UWAGA: JWT_SECRET w .env ma domyślną wartość."
  echo "Wygeneruj własny: openssl rand -hex 32"
  echo ""
  exit 1
fi

echo "Buduję i uruchamiam RP..."
docker compose up -d --build

echo ""
echo "Gotowe. Aplikacja na: http://localhost:8787"
echo "Panel admina:        http://localhost:8787/#/admin"
echo ""
echo "Zaloguj się jako admin (dane z .env), a potem dodaj konta dla innych."
