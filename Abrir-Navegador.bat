@echo off
title Navegador Inteligente
REM Vai para a pasta onde este .bat está (funciona em qualquer PC, qualquer caminho).
cd /d "%~dp0"

REM Garantir que o Node.js esteja no PATH (caso o launcher seja chamado sem o PATH atualizado)
if not exist "node_modules\.bin\electron.cmd" (
    echo Dependencias nao instaladas. Rodando npm install...
    call npm install
)

REM Build se ainda nao foi feito (primeira execucao)
if not exist "dist\renderer\index.html" (
    echo Compilando pela primeira vez...
    call npx tsc -p tsconfig.main.json
    call npx vite build
)

REM Abrir o navegador
start "" /B npx electron .
