@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo ==========================================
echo     SAVE ENGENHARIA LOCAL V1
echo ==========================================
echo.
echo Abrindo em http://localhost:8080
start "" http://localhost:8080
where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server 8080
  goto :eof
)
where py >nul 2>nul
if %errorlevel%==0 (
  py -m http.server 8080
  goto :eof
)
echo Python nao encontrado. Instale o Python ou use outro servidor HTTP local.
pause
