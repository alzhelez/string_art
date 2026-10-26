@echo off
rem Zapusk "Nitegraf" na Windows: dvoinoi shchelchok po etomu failu ili scripts\start.bat v konsoli.
rem Otkroyutsya dva okna (backend i frontend). Ostanovit' - zakryt' eti okna.
setlocal
cd /d "%~dp0..\backend"
if not exist .venv (
  python -m venv .venv || (echo Python ne najden. Ustanovite Python 3.11+ s python.org & pause & exit /b 1)
)
call .venv\Scripts\activate.bat
set REQ=requirements.txt
if "%WITH_BG%"=="1" set REQ=requirements-bg.txt
pip install -q -r %REQ% || (pause & exit /b 1)
start "Nitegraf backend" cmd /k ".venv\Scripts\activate.bat && uvicorn app.main:app --port 8000"

cd /d "%~dp0..\frontend"
call npm install --no-audit --no-fund --loglevel=error || (pause & exit /b 1)
start "Nitegraf frontend" cmd /k "npx next dev -p 3000"

timeout /t 8 >nul
start http://localhost:3000
