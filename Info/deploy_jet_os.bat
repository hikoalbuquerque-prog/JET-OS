@echo off
REM ============================================================================
REM JET OS — Script de Deploy Automático (Windows)
REM ============================================================================
REM Uso: deploy_jet_os.bat [frontend|functions|all]
REM ============================================================================

setlocal enabledelayedexpansion
cd /d "C:\Users\hikoa\Downloads\Jet OS"

echo.
echo ╔═══════════════════════════════════════════════════════════════════════╗
echo ║                        JET OS — Deploy Script                         ║
echo ║                                                                       ║
echo ║                Status: Pronto para produção (v2.0)                   ║
echo ║                Região: southamerica-east1 (São Paulo)                ║
echo ╚═══════════════════════════════════════════════════════════════════════╝
echo.

if "%1"=="" (
    echo Uso: deploy_jet_os.bat [frontend^|functions^|all]
    echo.
    echo Exemplos:
    echo   deploy_jet_os.bat frontend    — Build + deploy do frontend
    echo   deploy_jet_os.bat functions   — Build + deploy das funções
    echo   deploy_jet_os.bat all         — Build + deploy tudo
    echo.
    goto end
)

REM ============================================================================
REM FRONTEND
REM ============================================================================

if "%1"=="frontend" goto deploy_frontend
if "%1"=="all" goto deploy_frontend

:deploy_functions
echo.
echo [FUNCTIONS] Iniciando build...
cd /d "C:\Users\hikoa\Downloads\Jet Os\functions"

if not exist "package.json" (
    echo ❌ ERRO: package.json não encontrado em functions/
    echo Certifique-se de estar em: C:\Users\hikoa\Downloads\Jet OS\functions
    goto end
)

call npm run build
if errorlevel 1 (
    echo ❌ Build falhou!
    goto end
)

echo ✅ Build concluído

echo.
echo [FUNCTIONS] Deploying...
cd /d "C:\Users\hikoa\Downloads\Jet OS"
call firebase deploy --only functions

if errorlevel 1 (
    echo ❌ Deploy das funções falhou!
    goto end
)

echo ✅ Deploy das funções concluído

if "%1"=="functions" goto success
goto success

:deploy_frontend
echo.
echo [FRONTEND] Iniciando build...
cd /d "C:\Users\hikoa\Downloads\Jet Os\frontend"

if not exist "package.json" (
    echo ❌ ERRO: package.json não encontrado em frontend/
    echo Certifique-se de estar em: C:\Users\hikoa\Downloads\Jet OS\frontend
    goto end
)

call npm run build
if errorlevel 1 (
    echo ❌ Build falhou!
    goto end
)

echo ✅ Build concluído

echo.
echo [FRONTEND] Deploying...
cd /d "C:\Users\hikoa\Downloads\Jet OS"
call firebase deploy --only hosting

if errorlevel 1 (
    echo ❌ Deploy do frontend falhou!
    goto end
)

echo ✅ Deploy do frontend concluído

if "%1"=="frontend" goto success
goto deploy_functions

:success
echo.
echo ╔═══════════════════════════════════════════════════════════════════════╗
echo ║                      ✅ DEPLOY CONCLUÍDO!                            ║
echo ║                                                                       ║
echo ║  App: https://jet-os-7.web.app                                       ║
echo ║  Firebase: https://console.firebase.google.com/project/jet-os-7      ║
echo ║  Logs: https://console.firebase.google.com/project/jet-os-7/logs    ║
echo ╚═══════════════════════════════════════════════════════════════════════╝
echo.
pause

:end
exit /b
