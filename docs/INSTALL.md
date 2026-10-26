# Установка, обновление и запуск

Инструкция для компьютера с Windows, macOS или Linux. Всё делается один раз; дальше — только
«получить обновления» и «запустить».

## 1. Что нужно установить заранее

| Программа | Версия | Где взять | Как проверить |
|-----------|--------|-----------|---------------|
| Git | любая свежая | https://git-scm.com/downloads | `git --version` |
| Python | 3.11, 3.12 или 3.13 | https://www.python.org/downloads/ | `python --version` (на macOS/Linux — `python3 --version`) |
| Node.js | 20 или 22 (LTS) | https://nodejs.org/ | `node --version` |

На Windows при установке Python отметьте галочку **Add python.exe to PATH**.

## 2. Скачать проект с GitHub (один раз)

Откройте терминал (на Windows — «Командная строка» или PowerShell), перейдите в папку, где будет лежать проект,
и выполните:

```bash
git clone https://github.com/alzhelez/string_art.git
cd string_art
```

Появится папка `string_art` со всем кодом.

> Без Git: на странице репозитория **Code → Download ZIP**, распаковать. Но тогда обновления придётся
> скачивать заново целиком, поэтому лучше через Git.

## 3. Запуск

### Одной командой

- **macOS / Linux:** `./scripts/start.sh`
- **Windows:** двойной щелчок по `scripts\start.bat` (или `scripts\start.bat` в консоли)

Скрипт сам создаст виртуальное окружение Python, поставит зависимости бэкенда и фронтенда и запустит
оба сервера. Первый запуск занимает несколько минут, следующие — секунды. Откройте
**http://localhost:3000**. Остановить: `Ctrl+C` (macOS/Linux) или закрыть два окна консоли (Windows).

### Вручную, в двух терминалах

Терминал 1 — бэкенд:

```bash
cd backend
python -m venv .venv
# Windows:      .venv\Scripts\activate
# macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --port 8000
```

Терминал 2 — фронтенд:

```bash
cd frontend
npm install
npm run dev
```

Откройте **http://localhost:3000** — это приложение. Адрес http://localhost:8000, который пишет бэкенд, —
служебный (API), в браузере он просто перекинет на 3000.

## 4. Удаление фона

Скрипты запуска (`start.bat`, `start.sh`) ставят удаление фона автоматически. Если запускаете вручную,
установите его отдельно (в папке `backend`, с активированным `.venv`):

```bash
pip install -r requirements-bg.txt
```

При первом запуске бэкенд сам, в фоне, скачивает модель (~170 МБ) в домашнюю папку. В окне бэкенда это
видно по строкам «Удаление фона: загружаем модель…» и «Удаление фона: модель готова». Пока модель
грузится, приложение работает как обычно, а под галочкой «Убрать фон» написано, что идёт загрузка.
Дальше фон убирается за 1–3 секунды.

Не хотите ставить удаление фона — запускайте с `set WITH_BG=0` перед `scripts\start.bat`
(macOS/Linux: `WITH_BG=0 ./scripts/start.sh`); галочка будет неактивна, остальное работает.

Поиск лица («Выделить лицо») ставится вместе с основными зависимостями (OpenCV).

## 5. Получить обновления

1. Остановите приложение: закройте окна бэкенда и фронтенда (Windows) или нажмите `Ctrl+C` (macOS/Linux).
2. Перейдите в папку проекта и заберите изменения:

   ```bash
   cd C:\string_art        # macOS/Linux: cd ~/string_art (или где лежит проект)
   git pull
   ```

3. Запустите как обычно: `scripts\start.bat` (Windows) или `./scripts/start.sh` (macOS/Linux).
   Скрипт сам доустановит новые зависимости Python и Node.js.

Если запускаете вручную, после `git pull` повторите установку зависимостей:

```bash
cd backend
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cd ..\frontend                   # macOS/Linux: cd ../frontend
npm install
npm run dev
```

Ваши портреты не пропадут: они хранятся в `backend/data/string_art.db`, а этот файл не входит в Git
и при обновлении не трогается. Новые колонки в базе добавляются автоматически.

Если `git pull` пишет, что у вас есть локальные изменения, которые мешают:

```bash
git stash        # убрать свои правки в сторону
git pull
git stash pop    # вернуть их (если они нужны)
```

Если правки не нужны и хочется ровно то, что на GitHub: `git fetch` и `git reset --hard origin/main`
(база с портретами при этом не пострадает).

Посмотреть, что изменилось: `git log --oneline -10`.

## 6. Резервная копия

Скопируйте файл `backend/data/string_art.db` — в нём все проекты, фото и прогресс плетения.

## 7. Автотесты

| Набор | Команда |
|-------|---------|
| Python | `cd backend && python -m pytest` |
| TypeScript, юнит | `cd frontend && npm test` |
| Playwright (сам поднимает серверы) | `cd frontend && npx playwright install chromium && npm run test:e2e` |
| Java | бэкенд запущен → `cd autotests/java && mvn test`, отчёт `mvn allure:serve` |
| Go | бэкенд запущен → `cd autotests/go && go test -v ./...` |
| Ruby | бэкенд запущен → `ruby autotests/ruby/api_test.rb` |
| C# | бэкенд запущен → `cd autotests/csharp && dotnet test` |

На GitHub все наборы запускаются автоматически при каждом `git push` — результаты во вкладке **Actions**.

## 8. Частые проблемы

| Симптом | Что сделать |
|---------|-------------|
| `python` не найден (Windows) | Переустановите Python с галочкой «Add to PATH» или используйте `py` вместо `python` |
| `Address already in use` / порт 8000 или 3000 занят | Закройте прошлый запуск или другой сервер на этом порту |
| На странице «Сервер не отвечает» | Не запущен бэкенд — проверьте окно/терминал с `uvicorn` |
| Галочка «Убрать фон» неактивна, подсказка про `requirements-bg.txt` | Удаление фона не установлено — см. раздел 4 и перезапустите бэкенд |
| Под «Убрать фон» написано «Нет связи с бэкендом» | Бэкенд не запущен или упал — посмотрите его окно, перезапустите и обновите страницу |
| Под «Убрать фон» ошибка загрузки модели | Модель скачивается с GitHub. Проверьте интернет (и VPN/прокси, если GitHub недоступен), перезапустите бэкенд |
| В окне фронтенда `Failed to proxy … socket hang up` / `ECONNRESET` | Бэкенд не ответил вовремя или перезапускался. В новой версии долгие операции идут в фоне — обновитесь (`git pull`) |
| «Лицо анфас на фото не найдено» | Поиск работает по лицам анфас; для профиля выберите кадр вручную |
| Открываете с телефона по адресу компьютера | Запускайте фронтенд как `npx next dev --webpack -p 3000 -H 0.0.0.0` и откройте `http://<IP-компьютера>:3000` |
| На http://localhost:8000 пусто или `404 Not Found` | Это адрес API, а не приложения. Приложение — **http://localhost:3000** (в новой версии 8000 сам перекидывает туда) |
| `Turbopack is not supported on this platform` или `next-swc… is not a valid Win32 application` | Обновитесь (`git pull`): фронтенд теперь запускается через `npm run dev`, где используется webpack — ему нативный модуль не нужен. Запускайте именно `npm run dev`, а не `npx next dev` |
| Что-то странное после обновления фронтенда | Переустановите пакеты начисто: удалите папку `frontend\node_modules` (Windows: `rmdir /s /q node_modules`, macOS/Linux: `rm -rf node_modules`) и выполните `npm install` |
