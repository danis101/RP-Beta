@echo off
setlocal enabledelayedexpansion
REM RP — skrypt startowy (Windows).
REM Jeśli brak .env — tworzy go z losowym JWT_SECRET i domyślnym adminem.
REM Jeśli .env istnieje — używa go jak jest.

cd /d "%~dp0"

if not exist .env (
  echo.
  echo Nie znaleziono .env — generuje nowy plik z losowym JWT_SECRET.
  echo.

  REM Wygeneruj 64-znakowy hex przez PowerShell (kryptograficznie losowy).
  for /f "usebackq delims=" %%S in (`powershell -NoProfile -Command "[System.BitConverter]::ToString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).Replace('-','').ToLower()"`) do set "SECRET=%%S"

  if "!SECRET!"=="" (
    echo BLAD: nie udalo sie wygenerowac sekretu. Sprawdz czy PowerShell dziala.
    pause
    exit /b 1
  )

  (
    echo # Automatycznie wygenerowane przez start.bat
    echo JWT_SECRET=!SECRET!
    echo ADMIN_USERNAME=admin
    echo ADMIN_PASSWORD=admin1
  ) > .env

  echo Utworzono .env z losowym sekretem.
  echo.
  echo UWAGA: haslo admina to na razie "admin1".
  echo Po pierwszym zalogowaniu zmien je w panelu admina (#/admin)
  echo albo edytuj .env i usun katalog data\ zeby zaseedowac od nowa.
  echo.
  pause
)

echo Buduje i uruchamiam RP...
docker compose up -d --build

if errorlevel 1 (
  echo.
  echo Blad podczas uruchamiania. Sprawdz czy Docker Desktop dziala.
  pause
  exit /b 1
)

echo.
echo Gotowe. Aplikacja na: http://localhost:8787
echo Panel admina:        http://localhost:8787/#/admin
echo.
echo Zaloguj sie jako admin (dane z .env), a potem dodaj konta dla innych.
echo.
pause
