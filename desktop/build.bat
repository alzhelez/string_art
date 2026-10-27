@echo off
rem Сборка Нитеграф.exe на своём компьютере (Windows). Нужны Python 3.11+, Node.js 20+,
rem для установщика — Inno Setup 6 (https://jrsoftware.org/isdl.php). Запуск: desktop\build.bat
chcp 65001 >nul
setlocal
cd /d "%~dp0\.."

echo [1/4] Фронтенд...
pushd frontend
call npm ci || goto :error
call npm run build:desktop || goto :error
popd

echo [2/4] Python-пакеты...
python -m pip install -r desktop\requirements-desktop.txt || goto :error

echo [3/4] PyInstaller...
python -m PyInstaller desktop\nitegraf.spec --noconfirm || goto :error

echo [4/4] Установщик...
set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if exist "%ISCC%" (
  "%ISCC%" desktop\installer.iss || goto :error
  echo Готово: dist\Nitegraf-Setup.exe и папка dist\Nitegraf
) else (
  echo Inno Setup не найден — установщик пропущен. Программа: dist\Nitegraf\Nitegraf.exe
)
exit /b 0

:error
echo Сборка не удалась.
exit /b 1
