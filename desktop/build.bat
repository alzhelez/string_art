@rem Отключаем вывод самих команд в консоль (@ — и эту строку тоже не показывать)
@echo off
rem Сборка Нитеграф.exe на своём компьютере (Windows). Нужны Python 3.11+, Node.js 20+,
rem для установщика — Inno Setup 6 (https://jrsoftware.org/isdl.php). Запуск: desktop\build.bat
rem Переключаем консоль на UTF-8, чтобы русские сообщения отображались правильно
chcp 65001 >nul
rem Переменные, заданные дальше, не «утекут» в консоль после завершения скрипта
setlocal
rem Переходим в корень репозитория (папка скрипта + ..), /d — даже если это другой диск
cd /d "%~dp0\.."

rem Шаг 1: собрать фронтенд в статические файлы
echo [1/4] Фронтенд...
rem Заходим в папку frontend (popd вернёт обратно)
pushd frontend
rem Чистая установка зависимостей строго по package-lock.json
call npm ci || goto :error
rem Статическая сборка для программы (frontend/out)
call npm run build:desktop || goto :error
rem Возвращаемся в корень
popd

rem Шаг 2: Python-пакеты для сборки (бэкенд, pywebview, PyInstaller)
echo [2/4] Python-пакеты...
rem Устанавливаем зависимости программы
python -m pip install -r desktop\requirements-desktop.txt || goto :error

rem Шаг 3: собрать Nitegraf.exe
echo [3/4] PyInstaller...
rem Сборка по описанию nitegraf.spec, без вопросов о перезаписи
python -m PyInstaller desktop\nitegraf.spec --noconfirm || goto :error

rem Шаг 4: установщик
echo [4/4] Установщик...
rem Стандартный путь к компилятору Inno Setup
set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
rem Inno Setup установлен
if exist "%ISCC%" (
  rem Собираем установщик
  "%ISCC%" desktop\installer.iss || goto :error
  rem Сообщаем, где результат
  echo Готово: dist\Nitegraf-Setup.exe и папка dist\Nitegraf
  rem Иначе — Inno Setup не установлен
) else (
  rem Без Inno Setup остаётся просто папка с программой
  echo Inno Setup не найден — установщик пропущен. Программа: dist\Nitegraf\Nitegraf.exe
)
rem Успешное завершение
exit /b 0

rem Сюда переходим при любой ошибке (goto :error)
:error
rem Сообщение об ошибке
echo Сборка не удалась.
rem Код ошибки 1
exit /b 1
