#!/usr/bin/env bash
# Запуск «Нитеграфа» на macOS/Linux одной командой: ./scripts/start.sh
# Сам ставит зависимости при первом запуске и после обновлений, поднимает бэкенд (8000) и фронтенд (3000).
# Остановка — Ctrl+C.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="${PYTHON:-python3}"

echo "▶ Бэкенд: зависимости"
cd "$ROOT/backend"
[ -d .venv ] || "$PY" -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
# Удаление фона ставится по умолчанию; отключить: WITH_BG=0 ./scripts/start.sh
if [ "${WITH_BG:-1}" = "1" ]; then
  pip install -q -r requirements-bg.txt || {
    echo "⚠ Удаление фона не установилось — приложение запустится без него"
    pip install -q -r requirements.txt
  }
else
  pip install -q -r requirements.txt
fi

echo "▶ Фронтенд: зависимости"
cd "$ROOT/frontend"
npm install --no-audit --no-fund --loglevel=error

cd "$ROOT/backend"
uvicorn app.main:app --port 8000 &
BACK=$!
cd "$ROOT/frontend"
npm run dev &
FRONT=$!
trap 'kill $BACK $FRONT 2>/dev/null; exit 0' INT TERM

echo
echo "✔ Откройте http://localhost:3000   (остановить — Ctrl+C)"
wait
