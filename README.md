# Coletor de Pacotes SSP8 — "Informacoes ID"

Automação que coleta, a partir de uma lista de IDs de envio, o histórico e os dados de processos de cada pacote no painel interno `envios.adminml.com` e grava tudo em uma planilha Google Sheets.

## Visão geral

O projeto tem duas partes que conversam por HTTP:

```
┌──────────────────────────┐   1. GET  (IDs pendentes)    ┌───────────────────────────┐
│ Snippet (DevTools)       │ ───────────────────────────► │ Apps Script (App da Web)  │
│ snipet.js                │                              │ Code.js                   │
│ roda no navegador logado │   3. POST (histórico +       │ vinculado à planilha      │
│ em envios.adminml.com    │ ───────────────────────────► │                           │
└──────────┬───────────────┘      processos)              └─────────────┬─────────────┘
           │ 2. fetch de cada pacote                                    │
           ▼                                                            ▼
   /logistics/package-management/package/{id}               Planilha "Informacoes ID"
                                                            (abas IDs, Historico, Processos SC)
```

1. O **Snippet** pede ao Apps Script a lista de IDs ainda não coletados.
2. Para cada ID, busca a página do pacote usando a sessão já logada do usuário e extrai o JSON em `window.__PRELOADED_STATE__`.
3. Envia os dados em lotes para o Apps Script, que grava nas abas e marca o status na aba `IDs`.

A coleta roda no navegador do usuário porque o painel exige login. O Apps Script só recebe e grava os dados.

## Arquivos

| Arquivo | Função |
|---|---|
| [Code.js](Code.js) | Apps Script da planilha: menu, abas, token, App da Web (`doGet`/`doPost`). Versão 1.1.0. |
| [snipet.js](snipet.js) | Modelo do snippet do DevTools (com placeholders `__WEBAPP_URL__` e `__TOKEN__`). |
| [gerar-snippet.ps1](gerar-snippet.ps1) | Lê o `.env` e gera o `snipet.local.js` com os valores reais. |
| `.env` / [.env.example](.env.example) | `WEBAPP_URL` e `TOKEN`. O `.env` é local e ignorado pelo git. |
| [.claspignore](.claspignore) | Faz o `clasp push` enviar só `Code.js` e `appsscript.json`. |
| [appsscript.json](appsscript.json) | Manifesto: runtime V8, fuso `America/Sao_Paulo`, App da Web executado como o dono e acesso "qualquer pessoa". |
| [.clasp.json](.clasp.json) | Vínculo do `clasp` com o projeto Apps Script. |
| [CLAUDE.md](CLAUDE.md) | Regras de trabalho para o Claude Code neste repositório. |

## Abas da planilha

| Aba | Conteúdo |
|---|---|
| `IDs` | Entrada: IDs colados na coluna A. O script preenche `Status coleta` (`OK` ou `Erro: ...`) e `Coletado em`. |
| `Historico` | 1 linha por evento (checkpoint) do pacote: data/hora, evento, status, substatus, processo, rota, facility, usuário. |
| `Processos SC` | 1 linha por ID: status atual, direção, tags, origem, promessa de entrega, etiquetagem, inventário, aduana, auditoria de carrinho, erro e data da coleta. |
| `Motivos`, `Regras Motivo` | Abas auxiliares. Não são tocadas por este código (a "Nova coleta" não as altera). |

## Como usar

### Instalação (uma vez)
1. Na planilha: Extensões > Apps Script, cole o conteúdo de `Code.js` (ou use `clasp push`).
2. Rode a função `configurar`. Ela cria as abas com cabeçalhos e gera o **token**.
3. Implantar > Nova implantação > App da Web (Executar como: Eu / Acesso: Qualquer pessoa). Copie a URL.
4. Copie `.env.example` para `.env` e preencha `WEBAPP_URL` e `TOKEN` (menu **Pacotes SSP8 > Mostrar token**).
5. Rode `./gerar-snippet.ps1`. Ele cria o `snipet.local.js`.
6. No Chrome, abra F12 > Sources > Snippets e crie um snippet com o conteúdo de `snipet.local.js`. Repita os passos 5 e 6 sempre que mudar o `.env` ou o `snipet.js`.

### Rotina de coleta
1. Menu **Pacotes SSP8 > Nova coleta (limpar tudo)** para apagar os dados anteriores. Os cabeçalhos ficam.
2. Cole os novos IDs na aba `IDs`, coluna A, a partir de A2.
3. Abra uma página de `envios.adminml.com` já logado.
4. Execute o snippet (Ctrl+Enter). Um painel no canto da tela mostra o progresso.
5. Confira as abas `Historico` e `Processos SC`.

### Menu "Pacotes SSP8"
- **Nova coleta (limpar tudo):** limpa `IDs`, `Historico` e `Processos SC`, com confirmação.
- **Configurar abas e token:** cria abas e cabeçalhos que faltam e gera o token se ainda não existir.
- **Mostrar token:** exibe o token atual.
- **Limpar status (recoletar todos):** apaga `Status coleta` e `Coletado em` para que todos os IDs voltem a ser coletados.

## Comportamento importante

- **Pendentes:** o `GET` devolve só IDs sem status ou com status começando em `Erro`. Com `todos=1` devolve todos. IDs são normalizados para dígitos e precisam ter pelo menos 8.
- **Sem duplicar:** o `POST` remove as linhas existentes dos IDs do lote antes de gravar as novas. Reprocessar ou reenviar não duplica.
- **Concorrência:** a gravação usa `LockService` (espera até 30 s).
- **Lotes e ritmo:** 4 pacotes em paralelo, 50 por envio, espera aleatória de 0 a 10 s antes de cada pacote (configurável no topo do snippet). Há uma nova tentativa após 1,5 s em caso de falha.
- **Fallback:** se não conseguir ler a planilha, o snippet pede os IDs por `prompt`. Se a resposta do `POST` não puder ser lida (CORS), reenvia em `no-cors`.
- **Datas:** fuso `America/Sao_Paulo`. Valores fora de 2000–2100 (como o "nunca atualizado" `1844...`) ficam em branco.
- **Tradução de rótulos:** o snippet converte códigos (`delivered`, `in_container`, `for_returns` etc.) para os textos exibidos na tela do painel. Códigos não mapeados aparecem crus.
- **Abas crescem sozinhas** quando há mais linhas que o tamanho atual.

## Desenvolvimento

- Código em `.js`, que o clasp converte em `.gs`. Apenas sintaxe do Apps Script V8, sem `import`/`export` nem módulos Node.
- Depois de alterar o código: `clasp push`.
- Não rodar `clasp deploy` sem pedido explícito.
- Ao mudar o formato das colunas (`COLS_*` em `Code.js`), mantenha o snippet alinhado: os nomes das chaves em `extrair()` precisam bater com os cabeçalhos.

## Segurança

O App da Web é público (`ANYONE_ANONYMOUS`) e a **única proteção é o token**. Tratar a URL e o token como segredo:

- O token e a URL ficam só no `.env` e no `snipet.local.js`, ambos no `.gitignore`. Edite o modelo `snipet.js`, nunca o `.local`.
- Se o token vazar, apague a propriedade `TOKEN` em Configurações do projeto > Propriedades do script e rode `configurar` para gerar outro. Atualize o snippet.
- O snippet roda com a sessão do usuário no painel; use apenas em máquina confiável.
