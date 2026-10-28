#!/usr/bin/env sh
# Поднимает бэкенд в фоне для API-тестов в CI (на любом Debian/Alpine-образе с python3).
# Остановиться при первой ошибке
set -e
# Переходим в папку backend (относительно этого скрипта)
cd "$(dirname "$0")/../../backend"
# Ставим зависимости; новые Debian запрещают pip вне venv без --break-system-packages, старые не знают этот флаг — тогда вторая попытка без него
python3 -m pip install -q --break-system-packages -r requirements.txt 2>/dev/null \
  || python3 -m pip install -q -r requirements.txt
# Запускаем сервер в фоне с отдельной базой; вывод — в /tmp/backend.log
STRINGART_DB="${STRINGART_DB:-/tmp/stringart-ci.db}" nohup python3 -m uvicorn app.main:app --port 8000 > /tmp/backend.log 2>&1 &
# До 60 попыток раз в секунду
for i in $(seq 1 60); do
  # Сервер отвечает на /api/health
  if python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health')" 2>/dev/null; then
    # Готов — выходим успешно
    echo "backend is up"; exit 0
  fi
  # Ждём секунду
  sleep 1
done
# Не дождались — печатаем журнал сервера и выходим с ошибкой
echo "backend did not start"; cat /tmp/backend.log; exit 1
