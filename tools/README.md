# tools/ — driver autônomo do agente

Scripts para lançar o navegador Electron via Playwright, controlá-lo e
diagnosticar o agente sem precisar copiar/colar logs manualmente.

## claude-test.mjs — roda uma tarefa real e diagnostica

Lança o app com a chave DeepSeek injetada, executa um comando do agente,
espera terminar e despeja: status, passos (ação, auto-avaliação, recovery),
console do app e um screenshot final (`tools/_test_final.png`).

```bash
# pré-requisito: build atual (npm run build)
set DEEPSEEK_API_KEY=sk-...        # Windows cmd
DEEPSEEK_API_KEY=sk-... npm run agent:test -- "abrir a Wikipedia e me dizer o ano de fundação de São Paulo"
# ou direto:
node tools/claude-test.mjs "comando aqui" --key=sk-...
```

Variáveis úteis:
- `TASK_TIMEOUT_MS` — tempo máximo de espera por tarefa (padrão 210000).

## claude-drive.mjs — abre o app e digita um comando (sem rodar, sem API)

Prova de conceito / smoke visual. Gera `tools/_shot_1.png` e `_shot_2.png`.

```bash
node tools/claude-drive.mjs
```

> Os arquivos `_shot_*.png` e `_test_final.png` são artefatos de execução
> (podem ser apagados à vontade).
