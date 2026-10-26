@echo off
rem Zapusk "Nitegraf" na Windows: dvoinoi shchelchok po etomu failu ili scripts\start.bat v konsoli.
rem Otkroyutsya dva okna (backend i frontend). Ostanovit' - zakryt' eti okna.
setlocal
cd /d "%~dp0..\backend"
if not exist .venv (
  python -m venv .venv || (echo Python ne najden. Ustanovite Python 3.11+ s python.org & pause & exit /b 1)
)
call .venv\Scripts\activate.bat
rem Udalenie fona stavitsya po umolchaniyu; otklyuchit': set WITH_BG=0 pered zapuskom
if "%WITH_BG%"=="0" goto base
pip install -q -r requirements-bg.txt && goto deps_done
echo WARNING: background removal was not installed, starting without it
:base
pip install -q -r requirements.txt || (pause & exit /b 1)
:deps_done
start "Nitegraf backend" cmd /k ".venv\Scripts\activate.bat && uvicorn app.main:app --port 8000"

cd /d "%~dp0..\frontend"
call npm install --no-audit --no-fund --loglevel=error || (pause & exit /b 1)
start "Nitegraf frontend" cmd /k "npm run dev"

timeout /t 8 >nul
start http://localhost:3000
