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

## 4. Удаление фона (необязательно)

Галочка «Убрать фон» работает, если поставить дополнительный пакет:

```bash
cd backend
# активируйте .venv, как выше
pip install -r requirements-bg.txt
```

Или запускайте скрипт с переменной: `WITH_BG=1 ./scripts/start.sh` (macOS/Linux),
`set WITH_BG=1 && scripts\start.bat` (Windows).
При первом использовании бэкенд один раз скачает модель (~170 МБ) в вашу домашнюю папку — это займёт
пару минут, дальше фон убирается за 1–3 секунды. Без пакета приложение работает, галочка просто неактивна.

Поиск лица («Выделить лицо») ставится вместе с основными зависимостями (OpenCV).

## 5. Получить обновления

Когда в репозитории появились изменения:

```bash
cd string_art
git pull
```

После этого просто запустите приложение как обычно (`./scripts/start.sh` или `scripts\start.bat`) —
скрипт сам доустановит новые зависимости. Если запускаете вручную, повторите
`pip install -r requirements.txt` в `backend` и `npm install` во `frontend`.

Ваши портреты не пропадут: они хранятся в `backend/data/string_art.db`, а этот файл не входит в Git
и при обновлении не трогается. Новые колонки в базе добавляются автоматически.

Если `git pull` пишет, что у вас есть локальные изменения, которые мешают:

```bash
git stash        # убрать свои правки в сторону
git pull
git stash pop    # вернуть их (если они нужны)
```

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
| Галочка «Убрать фон» неактивна | Не установлен `requirements-bg.txt` (см. раздел 4) |
| «Лицо анфас на фото не найдено» | Поиск работает по лицам анфас; для профиля выберите кадр вручную |
| Открываете с телефона по адресу компьютера | Запускайте фронтенд как `npx next dev -p 3000 -H 0.0.0.0` и откройте `http://<IP-компьютера>:3000` |
