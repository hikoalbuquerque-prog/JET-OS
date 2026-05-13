@echo off
REM deploy_guard.bat — Sequência completa de deploy do JET Guard
REM Execute na raiz do projeto: deploy_guard.bat

echo.
echo ===========================================
echo   JET Guard — Deploy completo
echo ===========================================

REM ── 1. Firestore Rules ───────────────────────────────────────────
echo.
echo [1/4] Publicando Firestore Rules...
firebase deploy --only firestore:rules
if %errorlevel% neq 0 ( echo ERRO nas rules & exit /b 1 )
echo       OK

REM ── 2. Build frontend ────────────────────────────────────────────
echo.
echo [2/4] Build do frontend...
call npm run build
if %errorlevel% neq 0 ( echo ERRO no build & exit /b 1 )
echo       OK

REM ── 3. Hosting ───────────────────────────────────────────────────
echo.
echo [3/4] Deploy Firebase Hosting...
firebase deploy --only hosting
if %errorlevel% neq 0 ( echo ERRO no hosting & exit /b 1 )
echo       OK

REM ── 4. Cloud Functions ───────────────────────────────────────────
echo.
echo [4/4] Deploy Cloud Functions...
firebase deploy --only functions:sendDailyGuardReport,functions:testGuardReport
if %errorlevel% neq 0 ( echo ERRO nas functions & exit /b 1 )
echo       OK

echo.
echo ===========================================
echo   Deploy concluido com sucesso!
echo ===========================================
echo.
echo Proximos passos:
echo   1. Confirme que functions/.env.guard existe com BOT_TOKEN e CHAT_ID
echo   2. Crie um usuario com role Guard no painel de usuarios
echo   3. Para migrar dados do Sheets:
echo      node migrar_guard_sheets_firestore.js
echo.
