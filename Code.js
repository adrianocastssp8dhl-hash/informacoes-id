/**
 * Coletor de Pacotes SSP8 — Apps Script da planilha "Informacoes ID"
 * Versão: 1.1.0 (2026-10-17)
 * Par:    coletor_pacotes_snippet.js 1.0.0+
 *
 * Histórico de versões
 *   1.1.0  2026-10-17  Menu "Nova coleta (limpar tudo)": limpa IDs, Historico e Processos SC
 *                      mantendo cabeçalhos e formatação. Abas crescem sozinhas ao gravar
 *                      mais linhas do que existem.
 *   1.0.0  2026-10-16  Primeira versão: abas IDs/Historico/Processos SC, token, App da Web
 *                      (GET lista IDs pendentes, POST grava substituindo linhas do mesmo ID).
 *
 * Abas:
 *   IDs          -> você cola os IDs na coluna A. Colunas B/C são preenchidas pelo script.
 *   Historico    -> 1 linha por evento do Histórico do pacote
 *   Processos SC -> 1 linha por ID (Etiquetagem, Inventário, Aduana, Auditoria de carrinhos)
 *
 * Instalação: Extensões > Apps Script > cole este arquivo > rode "configurar" uma vez
 * > Implantar > Nova implantação > App da Web (Executar como: Eu / Acesso: Qualquer pessoa).
 */

const ABA_IDS = 'IDs';
const ABA_HIST = 'Historico';
const ABA_PROC = 'Processos SC';

const COLS_IDS = ['ID envio', 'Status coleta', 'Coletado em'];
const COLS_HIST = ['ID envio', 'Data/hora', 'Evento', 'Status', 'Substatus', 'Processo', 'Rota', 'Facility', 'Usuário'];
const COLS_PROC = ['ID envio', 'Status atual', 'Direção', 'Tags', 'Origem', 'Promessa de', 'Promessa até',
  'Etiquetagem - data', 'Etiquetagem - escaneado por',
  'Inventário - área', 'Inventário - escaneado por', 'Inventário - situação', 'Inventário - última atualização', 'Inventário - observação',
  'Aduana - transportador', 'Aduana - auditor', 'Aduana - última atualização', 'Aduana - classificação',
  'Carrinho', 'Carrinho - auditor', 'Carrinho - última atualização', 'Carrinho - classificação', 'Carrinho - dados brutos',
  'Erro', 'Coletado em'];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Pacotes SSP8')
    .addItem('Nova coleta (limpar tudo)', 'novaColeta')
    .addSeparator()
    .addItem('Configurar abas e token', 'configurar')
    .addItem('Mostrar token', 'mostrarToken')
    .addItem('Limpar status (recoletar todos)', 'limparStatus')
    .addToUi();
}

function configurar() {
  const ss = SpreadsheetApp.getActive();
  [[ABA_IDS, COLS_IDS], [ABA_HIST, COLS_HIST], [ABA_PROC, COLS_PROC]].forEach(([nome, cols]) => {
    const sh = ss.getSheetByName(nome) || ss.insertSheet(nome);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('@'); // ID como texto
  });
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TOKEN')) props.setProperty('TOKEN', Utilities.getUuid().replace(/-/g, '').slice(0, 20));
  mostrarToken();
}

function mostrarToken() {
  const t = PropertiesService.getScriptProperties().getProperty('TOKEN');
  SpreadsheetApp.getUi().alert('Token para colar no Snippet:\n\n' + t);
}

/** Limpa IDs, Historico e Processos SC (só o conteúdo, a partir da linha 2). */
function novaColeta() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.alert('Nova coleta',
    'Isso apaga os IDs, o Historico e os Processos SC atuais (os cabeçalhos ficam).\n' +
    'As abas Motivos e Regras Motivo não são alteradas.\n\nContinuar?',
    ui.ButtonSet.YES_NO);
  if (resp !== ui.Button.YES) return;

  const ss = SpreadsheetApp.getActive();
  [[ABA_IDS, COLS_IDS], [ABA_HIST, COLS_HIST], [ABA_PROC, COLS_PROC]].forEach(([nome, cols]) => {
    const sh = ss.getSheetByName(nome);
    if (!sh) return;
    const n = sh.getMaxRows() - 1;
    if (n > 0) sh.getRange(2, 1, n, cols.length).clearContent();
  });
  const shIds = ss.getSheetByName(ABA_IDS);
  shIds.activate();
  shIds.getRange('A2').activate();
  ss.toast('Pronto. Cole os novos IDs na coluna A a partir de A2 e rode o Snippet.', 'Nova coleta', 8);
}

function limparStatus() {
  const sh = SpreadsheetApp.getActive().getSheetByName(ABA_IDS);
  const n = sh.getLastRow() - 1;
  if (n > 0) sh.getRange(2, 2, n, 2).clearContent();
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function tokenOk_(t) {
  return t && t === PropertiesService.getScriptProperties().getProperty('TOKEN');
}

/** GET ?token=...&todos=1  -> lista de IDs (pendentes, ou todos com todos=1) */
function doGet(e) {
  const p = e.parameter || {};
  if (!tokenOk_(p.token)) return json_({ ok: false, erro: 'token inválido' });
  const sh = SpreadsheetApp.getActive().getSheetByName(ABA_IDS);
  const n = sh.getLastRow() - 1;
  if (n < 1) return json_({ ok: true, ids: [] });
  const vals = sh.getRange(2, 1, n, 2).getDisplayValues();
  const ids = [...new Set(vals
    .filter(r => r[0] && (p.todos === '1' || !r[1] || String(r[1]).startsWith('Erro')))
    .map(r => String(r[0]).replace(/\D/g, ''))
    .filter(id => id.length >= 8))];
  return json_({ ok: true, ids });
}

/** POST {token, historico:[{...}], processos:[{...}]} -> grava substituindo linhas dos mesmos IDs */
function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  if (!tokenOk_(body.token)) return json_({ ok: false, erro: 'token inválido' });

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActive();
    const agora = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm:ss');
    const processos = body.processos || [];
    const historico = body.historico || [];
    const idsLote = new Set(processos.map(p => String(p['ID envio'])));

    substituir_(ss.getSheetByName(ABA_HIST), COLS_HIST, idsLote, historico.map(h => COLS_HIST.map(c => h[c] ?? '')));
    substituir_(ss.getSheetByName(ABA_PROC), COLS_PROC, idsLote,
      processos.map(p => COLS_PROC.map(c => c === 'Coletado em' ? agora : (p[c] ?? ''))));

    // marca status na aba IDs
    const shIds = ss.getSheetByName(ABA_IDS);
    const n = shIds.getLastRow() - 1;
    if (n > 0) {
      const rng = shIds.getRange(2, 1, n, 3);
      const vals = rng.getDisplayValues();
      const porId = {};
      processos.forEach(p => porId[String(p['ID envio'])] = p['Erro'] ? 'Erro: ' + p['Erro'] : 'OK');
      let mudou = false;
      vals.forEach(r => {
        const id = String(r[0]).replace(/\D/g, '');
        if (porId[id]) { r[1] = porId[id]; r[2] = agora; mudou = true; }
      });
      if (mudou) rng.setValues(vals);
    }
    return json_({ ok: true, gravados: processos.length, eventos: historico.length });
  } finally {
    lock.releaseLock();
  }
}

/** Remove as linhas cujos IDs estão no lote e adiciona as novas (reprocessar não duplica). */
function substituir_(sh, cols, idsLote, novas) {
  const n = sh.getLastRow() - 1;
  let manter = [];
  if (n > 0) {
    const atuais = sh.getRange(2, 1, n, cols.length).getValues();
    manter = atuais.filter(r => !idsLote.has(String(r[0])));
    if (manter.length !== atuais.length) {
      sh.getRange(2, 1, n, cols.length).clearContent();
      if (manter.length) sh.getRange(2, 1, manter.length, cols.length).setValues(manter);
    } else {
      manter = atuais;
    }
  }
  if (novas.length) {
    const ini = manter.length + 2;
    const falta = ini + novas.length - 1 - sh.getMaxRows();
    if (falta > 0) sh.insertRowsAfter(sh.getMaxRows(), falta);
    sh.getRange(ini, 1, novas.length, 1).setNumberFormat('@');
    sh.getRange(ini, 1, novas.length, cols.length).setValues(novas);
  }
}