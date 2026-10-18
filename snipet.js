// Coletor de Pacotes SSP8 — Snippet do DevTools
// Rodar numa aba do envios.adminml.com (logado): F12 > Sources > Snippets > este snippet > Ctrl+Enter
// Lê os IDs pendentes da aba "IDs" da planilha, busca cada pacote e grava nas abas
// "Historico" e "Processos SC".
(async () => {
  // ======== valores vêm do .env: rode gerar-snippet.ps1 e use o snipet.local.js ========
  const WEBAPP_URL = '__WEBAPP_URL__';
  const TOKEN = '__TOKEN__';
  // ==========================================
  const CONCORRENCIA = 4;   // pacotes buscados ao mesmo tempo
  const LOTE = 50;          // pacotes enviados à planilha por vez
  const ESPERA_MIN = 0;     // espera aleatória antes de cada página (segundos)
  const ESPERA_MAX = 10;
  const TZ = 'America/Sao_Paulo';

  if (!location.hostname.endsWith('adminml.com')) return alert('Abra uma página do envios.adminml.com antes de rodar.');

  // ---------- painel de progresso ----------
  const painel = document.createElement('div');
  painel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:999999;background:#333;color:#fff;' +
    'font:13px/1.4 sans-serif;padding:10px 14px;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.3);max-width:320px';
  document.body.appendChild(painel);
  const msg = t => { painel.textContent = t; console.log('[Coletor] ' + t); };

  // ---------- 1. IDs ----------
  let ids = [];
  msg('Lendo IDs da planilha...');
  try {
    const r = await fetch(`${WEBAPP_URL}?token=${encodeURIComponent(TOKEN)}`);
    const j = await r.json();
    if (!j.ok) throw new Error(j.erro);
    ids = j.ids;
  } catch (e) {
    console.warn('Não consegui ler a planilha:', e);
    const txt = prompt('Não consegui ler os IDs da planilha (' + e.message + ').\nCole os IDs aqui:', '');
    ids = [...new Set(String(txt || '').match(/\d{8,}/g) || [])];
  }
  if (!ids.length) { msg('Nenhum ID pendente na aba IDs.'); setTimeout(() => painel.remove(), 6000); return; }

  // ---------- rótulos (iguais aos da tela) ----------
  const ROTULO_SUB = {
    delivered: 'Entregue', soon_deliver: 'Chegando ao destino', next_destination: 'A caminho do destino',
    for_return: 'Para devolver', inaccessible_address: 'Falha de entrega | Área inacessível',
    ready_to_deliver: 'Pronto para a rota', in_container: 'No carrinho', sorting: 'Para despachar',
    for_return_pickup: 'Para devolver (coleta)', picked_up: 'Coletado'
  };
  const ROTULO_PROC = { init_deliver: 'Em rota de entrega', init_deliver_containerized: 'Em rota de entrega' };
  const ROTULO_STATUS = { on_way: 'Caminho para a estação', ready_to_print: 'Pronto para imprimir' };
  const ZONA = { for_returns: 'Returns', fraud: 'Fraud', damaged: 'Damaged', containerized: 'Containerized',
    missort: 'Missort', problem_solving: 'Problem Solving', dispatch: 'Dispatch', sorting: 'Sorting' };
  const SITUACAO = { inventoried: 'Verificados', pending: 'Pendente' };
  const CLASSIF = { audited: 'Correto', missing: 'Faltante', damaged: 'Avariado' };
  const evento = c => {
    if (c.type === 'tracker') return `No nó (${c.facility_type || ''} ${c.facility_id || ''})`.trim();
    if (c.process && ROTULO_PROC[c.process]) return ROTULO_PROC[c.process];
    if (c.substatus && ROTULO_SUB[c.substatus]) return ROTULO_SUB[c.substatus];
    if (c.substatus) return `${c.status}_${c.substatus}`;
    return ROTULO_STATUS[c.status] || c.status || '';
  };

  // ---------- datas ----------
  const fmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const fmtDia = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
  // datas fora de 2000–2100 (ex.: 18446744011573955000 = "nunca atualizado") ficam em branco
  const toDate = v => {
    if (v === undefined || v === null || v === '') return null;
    const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
    const t = d.getTime();
    return isNaN(t) || t < 946684800000 || t > 4102444800000 ? null : d;
  };
  const dt = v => { try { const d = toDate(v); return d ? fmt.format(d).replace(',', '') : ''; } catch (e) { return ''; } };
  const dia = v => { try { const d = toDate(v); return d ? fmtDia.format(d) : ''; } catch (e) { return ''; } };

  // ---------- leitura de 1 pacote ----------
  async function buscar(id) {
    const r = await fetch(`/logistics/package-management/package/${id}`, { credentials: 'include' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const html = await r.text();
    const i = html.indexOf('window.__PRELOADED_STATE__');
    if (i < 0) throw new Error('dados não encontrados (sessão expirada?)');
    const ini = html.indexOf('{', i), fim = html.indexOf('</script>', ini);
    return JSON.parse(html.slice(ini, fim).trim().replace(/;\s*$/, ''));
  }

  function extrair(id, st) {
    const sd = st.shipmentDetail || {};
    const hist = (sd.checkpoints || []).map(c => ({
      'ID envio': id, 'Data/hora': dt(c.date), 'Evento': evento(c),
      'Status': c.status || '', 'Substatus': c.substatus || '', 'Processo': c.process || c.type || '',
      'Rota': c.route_id ? String(c.route_id) : '', 'Facility': c.facility_id || '',
      'Usuário': c.user ? (c.user.last_name || c.user.first_name || '') : ''
    }));
    const inv = st.historicalInventoryPack || {}, drv = inv.driver || {}, cont = inv.container || {};
    const lab = (sd.labellingHistory || [])[0] || {}, pd = sd.promise_date || {};
    const proc = {
      'ID envio': id,
      'Status atual': sd.substatus ? `${sd.status} / ${sd.substatus}` : (sd.status || ''),
      'Direção': sd.direction || '', 'Tags': (sd.tags || []).join(', '), 'Origem': sd.facility_origin_id || '',
      'Promessa de': dia(pd.from), 'Promessa até': dia(pd.to),
      'Etiquetagem - data': dt(lab.date), 'Etiquetagem - escaneado por': lab.userFullName || '',
      'Inventário - área': ZONA[inv.zone] || inv.zone || '',
      'Inventário - escaneado por': (inv.operator || {}).fullName || '',
      'Inventário - situação': SITUACAO[inv.situation] || inv.situation || '',
      'Inventário - última atualização': dt(inv.update_datetime),
      'Inventário - observação': inv.comment || '',
      'Aduana - transportador': (drv.driverInfo || {}).fullName || '',
      'Aduana - auditor': (drv.operator || {}).fullName || '',
      'Aduana - última atualização': dt(drv.updatedAt),
      'Aduana - classificação': CLASSIF[drv.status] || drv.status || '',
      'Carrinho': String(cont.name || cont.label || cont.containerId || cont.id || cont.clusterId || ''),
      'Carrinho - auditor': (cont.operator || {}).fullName || '',
      'Carrinho - última atualização': dt(cont.updatedAt),
      'Carrinho - classificação': CLASSIF[cont.status] || cont.status || '',
      'Carrinho - dados brutos': Object.keys(cont).length ? JSON.stringify(cont) : '',
      'Erro': ''
    };
    return { hist, proc };
  }

  // ---------- envio para a planilha ----------
  async function enviar(historico, processos) {
    const corpo = JSON.stringify({ token: TOKEN, historico, processos });
    try {
      const r = await fetch(WEBAPP_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: corpo });
      const j = await r.json();
      if (!j.ok) throw new Error(j.erro);
    } catch (e) {
      // sem leitura da resposta; a planilha substitui linhas do mesmo ID, então reenviar não duplica
      await fetch(WEBAPP_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: corpo });
    }
  }

  // ---------- execução ----------
  let feitos = 0, erros = 0;
  const t0 = Date.now();
  for (let i = 0; i < ids.length; i += LOTE) {
    const lote = ids.slice(i, i + LOTE), fila = [...lote];
    const historico = [], processos = [];
    const trabalhador = async () => {
      while (fila.length) {
        const id = fila.shift();
        const espera = Math.round((ESPERA_MIN + Math.random() * (ESPERA_MAX - ESPERA_MIN)) * 1000);
        msg(`Coletando ${feitos}/${ids.length} (erros: ${erros}) — aguardando ${(espera / 1000).toFixed(1)}s para ${id}`);
        await new Promise(r => setTimeout(r, espera));
        try {
          let st;
          try { st = await buscar(id); } catch (e) { await new Promise(r => setTimeout(r, 1500)); st = await buscar(id); }
          const { hist, proc } = extrair(id, st);
          historico.push(...hist); processos.push(proc);
        } catch (e) {
          erros++; processos.push({ 'ID envio': id, 'Erro': e.message });
        }
        feitos++;
        msg(`Coletando ${feitos}/${ids.length} (erros: ${erros})`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCORRENCIA, lote.length) }, trabalhador));
    msg(`Gravando na planilha... ${feitos}/${ids.length}`);
    await enviar(historico, processos);
  }
  msg(`Pronto: ${ids.length} pacote(s) em ${Math.round((Date.now() - t0) / 1000)}s, ${erros} erro(s). Veja a planilha.`);
  setTimeout(() => painel.remove(), 15000);
})();