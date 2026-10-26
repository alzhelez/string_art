#!/usr/bin/env sh
# Поднимает бэкенд в фоне для API-тестов в CI (на любом Debian/Alpine-образе с python3).
set -e
cd "$(dirname "$0")/../../backend"
python3 -m pip install -q --break-system-packages -r requirements.txt 2>/dev/null \
  || python3 -m pip install -q -r requirements.txt
STRINGART_DB="${STRINGART_DB:-/tmp/stringart-ci.db}" nohup python3 -m uvicorn app.main:app --port 8000 > /tmp/backend.log 2>&1 &
for i in $(seq 1 60); do
  if python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health')" 2>/dev/null; then
    echo "backend is up"; exit 0
  fi
  sleep 1
done
echo "backend did not start"; cat /tmp/backend.log; exit 1
