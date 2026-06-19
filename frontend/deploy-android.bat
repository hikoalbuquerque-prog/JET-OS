@echo off
echo ============================================
echo   JET OS ^| Build + Sync Android + Hosting
echo ============================================
echo.

cd /d "C:\Users\hikoa\Downloads\Jet OS\frontend"

echo [1/3] Build React + Vite...
call npm run build
if %errorlevel% neq 0 (
    echo.
    echo ERRO no build. Verifique os erros TypeScript acima.
    pause
    exit /b 1
)
echo OK.
echo.

echo [2/3] Sync Capacitor Android...
call npx cap sync android
if %errorlevel% neq 0 (
    echo.
    echo ERRO no cap sync. Verifique se a pasta android/ existe.
    echo Se nao existe: npx cap add android
    pause
    exit /b 1
)
echo OK.
echo.

echo [3/3] Deploy Firebase Hosting...
call firebase deploy --only hosting
if %errorlevel% neq 0 (
    echo.
    echo ERRO no deploy. Verifique login: firebase login
    pause
    exit /b 1
)

echo.
echo ============================================
echo   CONCLUIDO COM SUCESSO
echo ============================================
echo   Web:     https://jet-os-1.web.app
echo   Android: abrir Android Studio para gerar APK
echo            npx cap open android
echo ============================================
echo.
pause
