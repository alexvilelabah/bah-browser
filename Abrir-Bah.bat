@echo off
title Bah
REM Vai para a pasta onde este .bat está (funciona em qualquer PC, qualquer caminho).
cd /d "%~dp0"

REM Garantir que o Node.js esteja no PATH (caso o launcher seja chamado sem o PATH atualizado)
if not exist "node_modules\.bin\electron.cmd" (
    echo Dependencias nao instaladas. Rodando npm install...
    call npm install
)

if not exist "node_modules\electron\dist\electron.exe" (
    echo Binario do Electron nao encontrado. Baixando Electron...
    call node node_modules\electron\install.js
    if errorlevel 1 (
        echo Falha ao baixar o Electron. Verifique a internet e tente de novo.
        pause
        exit /b 1
    )
)

REM Sempre recompila antes de abrir. O app roda o dist\main\main.js; se o src mudou
REM e o dist ficou velho, correcoes de login/sessao nao entram no navegador.
echo Compilando app...
call npm run build
if errorlevel 1 (
    echo Falha ao compilar. Corrija o erro acima e tente de novo.
    pause
    exit /b 1
)

REM Abrir o navegador (processo proprio/detached — desligamento limpo grava a sessao).
REM Caminho absoluto via %~dp0 = funciona seja double-clicando ou chamando de qualquer lugar.
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
