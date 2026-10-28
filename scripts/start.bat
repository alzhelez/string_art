@rem Otklyuchaem vyvod samikh komand v konsol' (@ - i etu stroku tozhe ne pokazyvat')
@echo off
rem Zapusk "Nitegraf" na Windows: dvoinoi shchelchok po etomu failu ili scripts\start.bat v konsoli.
rem Otkroyutsya dva okna (backend i frontend). Ostanovit' - zakryt' eti okna.
rem (Kommentarii zdes' latinicei: konsol' Windows bez "chcp 65001" iskazhaet russkie bukvy v .bat)
rem Peremennye skripta ne vyidut za ego predely
setlocal
rem Perekhodim v papku backend (papka skripta + ..\backend), /d - dazhe na drugom diske
cd /d "%~dp0..\backend"
rem Esli virtual'nogo okruzheniya Python eshche net
if not exist .venv (
  rem Sozdayom ego; esli Python ne ustanovlen - podskazka i vykhod
  python -m venv .venv || (echo Python ne najden. Ustanovite Python 3.11+ s python.org & pause & exit /b 1)
)
rem Aktiviruem okruzhenie: dal'she python i pip - iz .venv
call .venv\Scripts\activate.bat
rem Udalenie fona stavitsya po umolchaniyu; otklyuchit': set WITH_BG=0 pered zapuskom
rem Esli WITH_BG=0 - propuskaem ustanovku udaleniya fona
if "%WITH_BG%"=="0" goto base
rem Stavim zavisimosti vmeste s udaleniem fona; udalos' - idyom dal'she
pip install -q -r requirements-bg.txt && goto deps_done
rem Ne udalos' (naprimer, net interneta k onnxruntime) - preduprezhdaem i stavim bez nego
echo WARNING: background removal was not installed, starting without it
rem Metka: ustanovka osnovnykh zavisimostei
:base
rem Osnovnye zavisimosti; oshibka - pauza, chtoby uvidet' tekst, i vykhod
pip install -q -r requirements.txt || (pause & exit /b 1)
rem Metka: zavisimosti gotovy
:deps_done
rem Zapuskaem backend v otdel'nom okne (cmd /k - okno ne zakryvaetsya)
start "Nitegraf backend" cmd /k ".venv\Scripts\activate.bat && uvicorn app.main:app --port 8000"

rem Perekhodim v papku frontend
cd /d "%~dp0..\frontend"
rem Stavim paket Node.js (tikho, bez audita i reklamy)
call npm install --no-audit --no-fund --loglevel=error || (pause & exit /b 1)
rem Zapuskaem frontend v otdel'nom okne
start "Nitegraf frontend" cmd /k "npm run dev"

rem Zhdyom 8 sekund, poka servery zapustyatsya
timeout /t 8 >nul
rem Otkryvaem prilozhenie v brauzere po umolchaniyu
start http://localhost:3000
