// ══════════════════════════════════════════════════════════════
//  MÓDULO MENSALISTAS — Planos Mensais de Clientes
//  Arquivo: mensalistas.js  |  Requer: supabaseClient.js, crm.js
// ══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
//  Estado
// ──────────────────────────────────────────────────────────────
let _mens_planos           = [];
let _mens_clientes         = [];
let _mens_produtos         = [];
let _mens_planoEntregaAtual = null;
let _mens_nomeRestaurante  = '';
let _mens_itensExtras      = [];   // Itens avulsos adicionados na baixa de entrega

// ──────────────────────────────────────────────────────────────
//  HELPERS DE TIPO (unidades vs kg)
//  obs é armazenado como JSON: {"t":"kg","n":"nota do usuario"}
//  Para retrocompatibilidade: se obs não for JSON válido, trata como nota texto
// ──────────────────────────────────────────────────────────────
function _mensObs(plano) {
  try { return JSON.parse(plano.obs || 'null') || {}; } catch { return { n: plano.obs || '' }; }
}
function _mensGetTipo(plano)  { return _mensObs(plano).t || 'un'; }
function _mensGetNota(plano)  { return _mensObs(plano).n || ''; }
function _mensEncodeObs(tipo, nota) {
  return JSON.stringify({ t: tipo, n: nota || '' });
}

// Armazenagem: unidades = valor inteiro; kg = valor * 10 (precisão 0,1 kg)
function _mensKgToInt(kg)   { return Math.round(parseFloat(kg) * 1000); }
function _mensIntToKg(n)    { return (n / 1000).toFixed(3); }
// Formata kg removendo zeros desnecessários, ex: 0,543 kg | 1,500 → 1,5 kg
function _mensFmtKg(n) {
  const kg = n / 1000;
  // Até 3 casas, sem zeros à direita
  let s = kg.toFixed(3).replace(/\.?0+$/, '');
  // Garante ao menos 1 casa decimal para clareza
  if (!s.includes('.')) s = s + ',0';
  return s.replace('.', ',') + ' kg';
}

function _mensFmtQtd(valorInt, tipo) {
  if (tipo === 'kg') return _mensFmtKg(valorInt);
  return valorInt + (valorInt === 1 ? ' unid.' : ' unids.');
}

// ──────────────────────────────────────────────────────────────
//  INIT — chamado por showTab('mensalistas')
// ──────────────────────────────────────────────────────────────
async function initMensalistas() {
  await Promise.all([
    _mensCarregarClientes(),
    _mensCarregarProdutos(),
    _mensCarregarNomeRestaurante(),
  ]);
  await mensCarregarPlanos();
}

async function _mensCarregarClientes() {
  const { data } = await supa.from('clientes').select('id, nome, telefone').order('nome');
  _mens_clientes = data || [];
}

async function _mensCarregarProdutos() {
  const { data } = await supa.from('produtos').select('id, nome, categoria_slug, preco').order('nome');
  _mens_produtos = data || [];
}

async function _mensCarregarNomeRestaurante() {
  try {
    const { data } = await supa.from('configuracoes').select('nome_restaurante').maybeSingle();
    _mens_nomeRestaurante = data?.nome_restaurante || 'RESTAURANTE';
  } catch(e) { _mens_nomeRestaurante = 'RESTAURANTE'; }
}

// ──────────────────────────────────────────────────────────────
//  CARREGAR E RENDERIZAR PLANOS
// ──────────────────────────────────────────────────────────────
async function mensCarregarPlanos() {
  const loading = document.getElementById('mens-loading');
  if (loading) loading.style.display = 'flex';

  try {
    const { data, error } = await supa
      .from('planos_mensalistas')
      .select('*, clientes(id, nome, telefone)')
      .order('created_at', { ascending: false });

    if (error) { console.warn('mensCarregarPlanos:', error.message); return; }
    _mens_planos = data || [];
    _mensRenderKPIs();
    mensRenderPlanos();
  } catch(e) { console.warn('mensCarregarPlanos:', e.message); }
  finally { if (loading) loading.style.display = 'none'; }
}

function _mensRenderKPIs() {
  const total   = _mens_planos.length;
  const ativos  = _mens_planos.filter(p => p.ativo).length;
  const receita = _mens_planos.reduce((s, p) => s + (p.valor_plano || 0), 0);

  // Itens restantes: soma de unidades + kg separados para exibição
  const itensPorTipo = _mens_planos.reduce((acc, p) => {
    const tipo = _mensGetTipo(p);
    if (tipo === 'kg') acc.kg += (p.quantidade_restante || 0);
    else acc.un += (p.quantidade_restante || 0);
    return acc;
  }, { un: 0, kg: 0 });

  let itensTxt = '';
  if (itensPorTipo.un > 0 && itensPorTipo.kg > 0)
    itensTxt = `${itensPorTipo.un} un + ${_mensFmtKg(itensPorTipo.kg)}`;
  else if (itensPorTipo.kg > 0)
    itensTxt = `${_mensFmtKg(itensPorTipo.kg)}`;
  else
    itensTxt = String(itensPorTipo.un);

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('mens-kpi-total',   total);
  set('mens-kpi-ativos',  ativos);
  set('mens-kpi-receita', `Gs ${Math.round(receita).toLocaleString('es-PY')}`);
  set('mens-kpi-itens',   itensTxt);
}

function mensRenderPlanos() {
  const cont = document.getElementById('mens-lista-planos');
  if (!cont) return;

  const filtro  = (document.getElementById('mens-filtro-status')?.value || 'todos');
  const busca   = (document.getElementById('mens-busca')?.value || '').toLowerCase().trim();

  let planos = _mens_planos.filter(p => {
    if (filtro === 'ativo'   && !p.ativo) return false;
    if (filtro === 'inativo' &&  p.ativo) return false;
    if (busca) {
      const nome     = (p.clientes?.nome || '').toLowerCase();
      const tel      = (p.clientes?.telefone || '').toLowerCase();
      const produto  = (p.produto_nome || '').toLowerCase();
      if (!nome.includes(busca) && !tel.includes(busca) && !produto.includes(busca)) return false;
    }
    return true;
  });

  if (!planos.length) {
    cont.innerHTML = `
      <div style="text-align:center;color:#aaa;padding:40px">
        <div style="font-size:2rem;margin-bottom:8px">📋</div>
        <div>${t('mens.nenhum_plano', 'Nenhum plano mensal registrado ainda.')}</div>
      </div>`;
    return;
  }

  cont.innerHTML = planos.map(p => {
    const tipo         = _mensGetTipo(p);
    const qtdTotal     = p.quantidade_total || 0;
    const qtdRest      = p.quantidade_restante || 0;
    const pct          = qtdTotal > 0 ? Math.round((qtdRest / qtdTotal) * 100) : 0;
    const barColor     = pct > 50 ? '#1a7a2e' : pct > 20 ? '#f39c12' : '#e74c3c';
    const statusColor  = p.ativo ? '#1a7a2e' : '#9ca3af';
    const dataFim      = p.data_fim
      ? new Date(p.data_fim + 'T12:00:00').toLocaleDateString('es-PY')
      : t('geral.indeterminado', 'Indeterminado');
    const vencendo     = p.data_fim && new Date(p.data_fim) < new Date(Date.now() + 7 * 86400000);
    const fmtRest      = _mensFmtQtd(qtdRest, tipo);
    const fmtTotal     = _mensFmtQtd(qtdTotal, tipo);
    const esgotado     = qtdRest <= 0 && p.ativo;

    return `
      <div style="background:#fff;border:1.5px solid ${p.ativo ? '#d1fae5' : '#e5e7eb'};border-radius:14px;padding:16px;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,0.05)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:1rem;margin-bottom:2px">${p.clientes?.nome || '—'}</div>
            <div style="color:#6b7280;font-size:0.82rem">${p.clientes?.telefone || ''}</div>
            <div style="font-weight:600;font-size:0.9rem;margin-top:6px;color:#111">
              ${tipo === 'kg' ? '⚖️' : '📦'} ${p.produto_nome}
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <span style="background:${p.ativo ? '#dcfce7' : '#f3f4f6'};color:${statusColor};padding:3px 11px;border-radius:10px;font-size:0.73rem;font-weight:700">
              ${p.ativo ? '● ' + t('geral.ativo', 'ATIVO') : '○ ' + t('geral.inativo', 'INATIVO')}
            </span>
            <div style="font-size:0.75rem;color:${vencendo && p.ativo ? '#e74c3c' : '#9ca3af'};margin-top:5px">
              ${vencendo && p.ativo ? '⚠️ ' : ''}${t('geral.vence', 'Vence:')} ${dataFim}
            </div>
            <div style="font-weight:700;color:#1a7a2e;font-size:0.95rem;margin-top:3px">
              Gs ${Math.round(p.valor_plano || 0).toLocaleString('es-PY')}
            </div>
          </div>
        </div>

        <div style="margin-top:12px">
          <div style="display:flex;justify-content:space-between;font-size:0.82rem;margin-bottom:5px">
            <span style="color:#555">${t('mens.saldo_itens', 'Saldo:')} <b style="color:#111">${fmtRest}</b> de ${fmtTotal}</span>
            <span style="color:${barColor};font-weight:700">${pct}%</span>
          </div>
          <div style="background:#f0f0f0;border-radius:6px;height:9px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${barColor};border-radius:6px;transition:width 0.4s"></div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;font-size:0.78rem;color:#6b7280">
            <span>💰 Valor restante: <b style="color:#2980b9">Gs ${Math.round(
              p.valor_restante != null
                ? p.valor_restante
                : (p.quantidade_total > 0 ? (p.valor_plano / p.quantidade_total) * qtdRest : 0)
            ).toLocaleString('es-PY')}</b></span>
            <span style="color:#bbb">de Gs ${Math.round(p.valor_plano || 0).toLocaleString('es-PY')}</span>
          </div>
        </div>

        <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap">
          ${p.ativo && qtdRest > 0 ? `
          <button onclick="mensAbrirEntrega(${p.id})"
            style="flex:2;padding:9px;background:#1a7a2e;color:#fff;border:none;border-radius:9px;cursor:pointer;font-size:0.83rem;font-weight:700;min-width:120px">
            ${tipo === 'kg' ? '⚖️' : '📦'} ${t('mens.registrar_entrega', 'Registrar Entrega')}
          </button>` : ''}
          ${esgotado || !p.ativo || vencendo ? `
          <button onclick="mensAbrirModalRenovacao(${p.id})"
            style="flex:2;padding:9px;background:#2980b9;color:#fff;border:none;border-radius:9px;cursor:pointer;font-size:0.83rem;font-weight:700;min-width:120px">
            🔄 ${t('mens.renovar_plano', 'Renovar Plano')}
          </button>` : ''}
          <button onclick="mensAbrirModalPlano(${p.id})"
            style="flex:1;padding:9px;background:#3498db;color:#fff;border:none;border-radius:9px;cursor:pointer;font-size:0.83rem;font-weight:600;min-width:70px"
            title="${t('mens.editar_plano', 'Editar plano')}">
            ✏️
          </button>
          ${(!esgotado && p.ativo && !vencendo) ? `
          <button onclick="mensAbrirModalRenovacao(${p.id})"
            style="flex:0 0 40px;padding:9px;background:#dbeafe;color:#2980b9;border:none;border-radius:9px;cursor:pointer;font-size:0.9rem;font-weight:700"
            title="${t('mens.renovar_plano', 'Renovar plano')}">
            🔄
          </button>` : ''}
          <button onclick="mensVerHistorico(${p.id})"
            style="flex:1;padding:9px;background:#9b59b6;color:#fff;border:none;border-radius:9px;cursor:pointer;font-size:0.83rem;font-weight:600;min-width:70px">
            📋
          </button>
          <button onclick="mensEnviarWhatsAppAviso(${p.id})"
            style="flex:0 0 40px;padding:9px;background:#dcfce7;color:#25d366;border:none;border-radius:9px;cursor:pointer;font-size:0.9rem;font-weight:700"
            title="${t('mens.whatsapp_aviso', 'Avisar cliente pelo WhatsApp')}">
            💬
          </button>
          <button onclick="mensExcluirPlano(${p.id})"
            style="flex:0 0 40px;padding:9px;background:#fee2e2;color:#e74c3c;border:none;border-radius:9px;cursor:pointer;font-size:0.9rem;font-weight:700"
            title="${t('mens.excluir_plano', 'Excluir plano')}">
            🗑️
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// ──────────────────────────────────────────────────────────────
//  MODAL NOVO / EDITAR PLANO
// ──────────────────────────────────────────────────────────────
function mensToggleTipoPlano() {
  const tipo  = document.getElementById('mens-plano-tipo')?.value || 'un';
  const label = document.getElementById('mens-plano-qtd-label');
  const input = document.getElementById('mens-plano-qtd');
  if (tipo === 'kg') {
    if (label) label.textContent = 'Peso total contratado (kg) *';
    if (input) { input.placeholder = 'Ex: 5.250'; input.step = '0.001'; input.min = '0.001'; }
  } else {
    if (label) label.textContent = 'Qtd Total de Itens *';
    if (input) { input.placeholder = 'Ex: 22'; input.step = '1'; input.min = '1'; }
  }
}

function mensAbrirModalPlano(id = null, renovacao = false) {
  const p    = id ? _mens_planos.find(p => p.id === id) : null;
  const tipo = p ? _mensGetTipo(p) : 'un';
  const nota = p ? _mensGetNota(p) : '';

  const _mset = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  _mset('mens-plano-id',         p?.id || '');
  _mset('mens-plano-cli-id',     p?.cliente_id || '');
  _mset('mens-plano-renovacao',  renovacao ? '1' : '');
  _mset('mens-plano-produto',    p?.produto_nome || '');
  _mset('mens-plano-valor',      p?.valor_plano || '');
  // NOVO: na renovação, o ciclo começa de novo — data de início hoje e data
  // fim em branco (o usuário define o novo vencimento), em vez de manter as
  // datas do ciclo anterior.
  _mset('mens-plano-ini',        renovacao ? new Date().toISOString().split('T')[0] : (p?.data_inicio || new Date().toISOString().split('T')[0]));
  _mset('mens-plano-fim',        renovacao ? '' : (p?.data_fim || ''));
  _mset('mens-plano-nota',       nota);

  // Tipo
  const selTipo = document.getElementById('mens-plano-tipo');
  if (selTipo) selTipo.value = tipo;

  // Quantidade — exibir em unidade display (kg ou int)
  const qtdInput = document.getElementById('mens-plano-qtd');
  if (qtdInput) {
    if (tipo === 'kg') {
      qtdInput.value = p ? _mensIntToKg(p.quantidade_total) : '';
    } else {
      qtdInput.value = p?.quantidade_total || '';
    }
  }
  mensToggleTipoPlano();

  const chkAtivo = document.getElementById('mens-plano-ativo');
  // NOVO: renovar sempre reativa o plano (útil para renovar um plano
  // esgotado/inativo/vencido sem precisar reativar manualmente antes)
  if (chkAtivo) chkAtivo.checked = renovacao ? true : (p ? p.ativo : true);

  // Popula select de clientes
  const selCli = document.getElementById('mens-plano-cli-sel');
  if (selCli) {
    selCli.innerHTML = `<option value="">${t('mens.selecione_cliente', '— Selecione o cliente —')}</option>` +
      _mens_clientes.map(c =>
        `<option value="${c.id}" ${p?.cliente_id === c.id ? 'selected' : ''}>${c.nome}${c.telefone ? ' · ' + c.telefone : ''}</option>`
      ).join('');
    selCli.onchange = () => {
      document.getElementById('mens-plano-cli-id').value = selCli.value;
    };
  }

  // Popula select de produtos
  const selProd = document.getElementById('mens-plano-prod-sel');
  if (selProd) {
    selProd.innerHTML = `<option value="">${t('mens.selecione_cardapio', '— Selecione do cardápio —')}</option>` +
      _mens_produtos.map(pr =>
        `<option value="${pr.nome}" ${p?.produto_nome === pr.nome ? 'selected' : ''}>${pr.nome}${pr.categoria_slug ? ' · ' + pr.categoria_slug : ''}</option>`
      ).join('');
    selProd.onchange = () => {
      if (selProd.value) document.getElementById('mens-plano-produto').value = selProd.value;
    };
  }

  // Título e botão do modal / info de renovação
  const titulo   = document.getElementById('mens-plano-titulo');
  const btnSalvar = document.getElementById('mens-plano-btn-salvar');
  const infoRenov = document.getElementById('mens-renov-info');

  if (renovacao && p) {
    const saldoFmt = _mensFmtQtd(p.quantidade_restante, tipo);
    const saldoValorFmt = Math.round(
      p.valor_restante != null ? p.valor_restante
        : (p.quantidade_total > 0 ? (p.valor_plano / p.quantidade_total) * p.quantidade_restante : 0)
    ).toLocaleString('es-PY');
    if (titulo) titulo.innerHTML = `🔄 ${t('mens.renovar_plano', 'Renovar Plano')}`;
    if (btnSalvar) btnSalvar.innerHTML = `🔄 ${t('mens.renovar_e_cobrar', 'Renovar e Cobrar')}`;
    if (infoRenov) {
      infoRenov.style.display = 'block';
      infoRenov.innerHTML = `
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;font-size:0.82rem;color:#1e40af;margin-bottom:14px">
          🔄 <b>${t('mens.renovando_plano', 'Renovando o plano de')} ${p.clientes?.nome || ''}.</b><br>
          ${t('mens.renovacao_reinicia', 'Isso inicia um novo ciclo: o saldo abaixo é substituído pelos valores novos que você definir (não é somado).')}<br>
          ${saldoFmt !== '0' ? `${t('mens.saldo_atual_antes', 'Saldo atual antes da renovação:')} <b>${saldoFmt}</b> (Gs ${saldoValorFmt}).` : ''}
        </div>`;
    }
  } else if (p) {
    if (titulo) titulo.innerHTML = `✏️ ${t('mens.editar_plano', 'Editar Plano')}`;
    if (btnSalvar) btnSalvar.innerHTML = t('mens.salvar_plano', 'Salvar Plano');
    if (infoRenov) {
      const saldoFmt = _mensFmtQtd(p.quantidade_restante, tipo);
      infoRenov.style.display = 'block';
      infoRenov.innerHTML = `
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;font-size:0.82rem;color:#1e40af;margin-bottom:14px">
          ${t('mens.renovacao_info', '<b>Ajuste manual:</b> Ao modificar a quantidade total, o saldo restante será ajustado proporcionalmente.<br>Saldo atual: <b>{qtd}</b>.<br>Para iniciar um novo ciclo do zero, use o botão 🔄 Renovar na lista de planos.').replace('{qtd}', saldoFmt)}
        </div>`;
    }
  } else {
    if (titulo) titulo.innerHTML = `📋 ${t('mens.plano_mensalista', 'Plano Mensalista')}`;
    if (btnSalvar) btnSalvar.innerHTML = t('mens.salvar_plano', 'Salvar Plano');
    if (infoRenov) infoRenov.style.display = 'none';
  }

  const _mmp = document.getElementById('modal-mens-plano');
  if (_mmp) { _mmp.style.cssText += ';position:fixed!important;top:0;left:0;width:100%;height:100%;z-index:9999;'; _mmp.style.display = 'flex'; }
  setTimeout(() => document.getElementById('mens-plano-cli-sel')?.focus(), 100);
}

// Atalho para abrir o modal já em modo renovação
function mensAbrirModalRenovacao(id) {
  if (!id) return;
  mensAbrirModalPlano(id, true);
}

async function mensSalvarPlano() {
  const id           = document.getElementById('mens-plano-id').value;
  const cliente_id   = parseInt(document.getElementById('mens-plano-cli-id').value) || null;
  const produto_nome = document.getElementById('mens-plano-produto').value.trim();
  const tipo         = document.getElementById('mens-plano-tipo')?.value || 'un';
  const qtdRaw       = document.getElementById('mens-plano-qtd').value;
  const nota         = document.getElementById('mens-plano-nota')?.value.trim() || '';
  const valor        = parseFloat(document.getElementById('mens-plano-valor').value) || 0;
  const data_ini     = document.getElementById('mens-plano-ini').value || null;
  const data_fim     = document.getElementById('mens-plano-fim').value || null;
  const ativo        = document.getElementById('mens-plano-ativo')?.checked ?? true;

  // Converter para inteiro de armazenamento
  const qtd_total = tipo === 'kg'
    ? _mensKgToInt(qtdRaw)
    : (parseInt(qtdRaw) || 0);

  if (!cliente_id)    { alert(t('mens.alerta_cliente', 'Selecione o cliente.')); return; }
  if (!produto_nome)  { alert(t('mens.alerta_produto', 'Insira o produto/item do plano.')); return; }
  // Quantidade é opcional — 0 significa plano apenas por valor/saldo
  if (valor <= 0)     { alert(t('mens.alerta_valor', 'Insira o valor do plano.')); return; }

  const renovacao = document.getElementById('mens-plano-renovacao')?.value === '1';
  const planoAtual = id ? _mens_planos.find(p => p.id == id) : null;

  // NOVO: dinheiro novo que está efetivamente entrando agora.
  // - Renovação: sempre o valor CHEIO do novo ciclo (é um novo pagamento).
  // - Plano novo: o valor cheio.
  // - Edição normal de plano existente: só a diferença, se o valor subiu
  //   (reforço/recarga de saldo). Se não mudou ou caiu, não há dinheiro
  //   novo entrando, então não pedimos forma de pagamento nem lançamos
  //   nada no caixa.
  const valorACobrar = renovacao
    ? valor
    : (planoAtual ? Math.max(0, valor - (planoAtual.valor_plano || 0)) : valor);

  let formaPag = null;
  if (valorACobrar > 0) {
    // Antes, a criação/reforço de um plano de mensalista não gerava
    // nenhum lançamento financeiro — o valor pago pelo cliente não
    // aparecia em lugar nenhum do Financeiro. Agora, igual ao fluxo de
    // quitação de Nota, exigimos caixa aberto e a forma de pagamento.
    if (!_sessaoCaixaAtiva) {
      alert('⚠️ Não há caixa aberto. Abra o caixa antes de registrar o pagamento do plano.');
      return;
    }
    formaPag = await _notasModalFormaPagamento();
    if (!formaPag) return; // cancelou — não salva sem definir a forma de pagamento
  }

  const payload = {
    cliente_id,
    produto_nome,
    quantidade_total: qtd_total,
    valor_plano: valor,
    data_inicio: data_ini,
    data_fim,
    ativo,
    obs: _mensEncodeObs(tipo, nota),
  };

  let error;
  if (id && renovacao) {
    // CORRIGIDO: antes, renovar um plano exigia apagar e criar outro do
    // zero (perdendo o histórico de entregas). Agora, renovar atualiza o
    // MESMO plano (mantém histórico e vínculo com o cliente), mas reinicia
    // o ciclo por completo: saldo passa a ser exatamente a nova quantidade
    // e o novo valor definidos aqui — não é somado ao que sobrou do ciclo
    // anterior.
    payload.quantidade_restante = qtd_total;
    payload.valor_restante      = valor;
    ({ error } = await supa.from('planos_mensalistas').update(payload).eq('id', id));
  } else if (id) {
    if (planoAtual && qtd_total !== planoAtual.quantidade_total) {
      const diferenca = qtd_total - planoAtual.quantidade_total;
      payload.quantidade_restante = Math.max(0, planoAtual.quantidade_restante + diferenca);
    }
    // Atualizar valor_restante proporcionalmente se o valor do plano mudou
    if (planoAtual && valor !== planoAtual.valor_plano && planoAtual.quantidade_total > 0) {
      const percRestante = planoAtual.quantidade_restante / planoAtual.quantidade_total;
      payload.valor_restante = Math.round(valor * percRestante);
    } else if (planoAtual && valor !== planoAtual.valor_plano) {
      payload.valor_restante = valor; // plano só por valor, reseta
    }
    ({ error } = await supa.from('planos_mensalistas').update(payload).eq('id', id));
  } else {
    payload.quantidade_restante = qtd_total;
    payload.valor_restante      = valor;  // saldo inicial = valor total do plano
    ({ error } = await supa.from('planos_mensalistas').insert([payload]));
  }

  if (error) { alert(t('mens.erro_salvar', 'Erro ao salvar: ') + error.message); return; }

  // NOVO: registra a entrada no caixa/financeiro com a forma de pagamento escolhida
  if (valorACobrar > 0 && formaPag) {
    const clienteNome   = _mens_clientes.find(c => c.id === cliente_id)?.nome || 'Cliente';
    const usuario_email = document.getElementById('user-email')?.innerText || 'admin';
    const descricao = renovacao
      ? `Mensalista - Renovação de plano: ${produto_nome} (${clienteNome}) - Forma: ${formaPag}`
      : planoAtual
        ? `Mensalista - Reforço de saldo: ${produto_nome} (${clienteNome}) - Forma: ${formaPag}`
        : `Mensalista - Novo plano: ${produto_nome} (${clienteNome}) - Forma: ${formaPag}`;
    const sucesso = await registrarMovimentacaoCaixa({
      tipo: 'entrada',
      valor: valorACobrar,
      descricao,
      usuario_email,
      sessao_id: _sessaoCaixaAtiva.id,
      forma_pagamento: formaPag,
    });
    if (!sucesso) {
      alert('⚠️ Plano salvo, mas houve erro ao registrar no caixa. Verifique manualmente.');
    }
  }

  fecharModal('modal-mens-plano');
  mensCarregarPlanos();
}

// ──────────────────────────────────────────────────────────────
//  REGISTRAR ENTREGA
// ──────────────────────────────────────────────────────────────
function mensAbrirEntrega(planoId) {
  _mens_planoEntregaAtual = _mens_planos.find(p => p.id === planoId);
  if (!_mens_planoEntregaAtual) return;

  const p    = _mens_planoEntregaAtual;
  const tipo = _mensGetTipo(p);
  const isKg = tipo === 'kg';

  // Limpa itens extras ao abrir
  _mens_itensExtras = [];

  document.getElementById('mens-ent-plano-id').value      = p.id;
  document.getElementById('mens-ent-cliente').textContent  = p.clientes?.nome || '—';
  document.getElementById('mens-ent-tel').textContent      = p.clientes?.telefone || '';
  document.getElementById('mens-ent-produto').textContent  = p.produto_nome;
  document.getElementById('mens-ent-obs').value  = '';

  // Saldo
  const fmtRest  = _mensFmtQtd(p.quantidade_restante, tipo);
  const fmtTotal = _mensFmtQtd(p.quantidade_total, tipo);
  document.getElementById('mens-ent-saldo').textContent = `${fmtRest} de ${fmtTotal} ${t('mens.disponiveis', 'disponíveis')}`;

  // Input de quantidade
  const qtdInput = document.getElementById('mens-ent-qtd');
  const qtdLabel = document.getElementById('mens-ent-qtd-label');
  if (isKg) {
    qtdInput.step  = '0.001';
    qtdInput.min   = '0.001';
    qtdInput.value = '0.500';
    qtdInput.max   = _mensIntToKg(p.quantidade_restante);
    if (qtdLabel) qtdLabel.textContent = 'Peso entregue (kg) *';
  } else {
    qtdInput.step  = '1';
    qtdInput.min   = '1';
    qtdInput.value = '1';
    qtdInput.max   = p.quantidade_restante;
    if (qtdLabel) qtdLabel.textContent = t('mens.qtd_entregue', 'Quantidade entregue *');
  }

  // Valor unitário — exibe e ativa campos bidirecionais kg↔valor
  const elValor = document.getElementById('mens-ent-valor-unit');
  const valorUnit = (p.quantidade_total > 0 && p.valor_plano > 0)
    ? (p.valor_plano / p.quantidade_total)
    : 0;
  if (elValor) {
    if (isKg && valorUnit > 0) {
      // valorUnit está em Gs por unidade interna (1/1000 kg), multiplica por 1000 para Gs/kg
      elValor.textContent = `Gs ${Math.round(valorUnit * 1000).toLocaleString('es-PY')} /kg`;
    } else if (!isKg && valorUnit > 0) {
      elValor.textContent = `Gs ${Math.round(valorUnit).toLocaleString('es-PY')} /un`;
    } else {
      elValor.textContent = '';
    }
  }

  // Armazena valor unitário no input hidden para cálculos bidirecionais
  const _vup = document.getElementById('mens-ent-valor-unit-preco');
  if (_vup) _vup.value = valorUnit;

  // Seta o input de valor correspondente ao peso/qtd default
  _mensAtualizarValorEntrega();

  // Renderiza seção de itens extras
  _mensRenderItensExtras();

  const _mme = document.getElementById('modal-mens-entrega');
  if (_mme) { _mme.style.cssText += ';position:fixed!important;top:0;left:0;width:100%;height:100%;z-index:9999;'; _mme.style.display = 'flex'; }
  setTimeout(() => document.getElementById('mens-ent-qtd')?.focus(), 100);
}

// ──────────────────────────────────────────────────────────────
//  CÁLCULO BIDIRECIONAL KG ↔ VALOR NA ENTREGA
// ──────────────────────────────────────────────────────────────
function _mensAtualizarValorEntrega() {
  const p = _mens_planoEntregaAtual;
  if (!p) return;
  const tipo = _mensGetTipo(p);
  const isKg = tipo === 'kg';
  const valorUnit = parseFloat(document.getElementById('mens-ent-valor-unit-preco')?.value) || 0;
  if (!isKg || valorUnit <= 0) return;

  const qtdRaw = parseFloat(document.getElementById('mens-ent-qtd')?.value) || 0;
  const valorTotal = Math.round(qtdRaw * valorUnit * 1000); // valorUnit é Gs/unidade-interna; qtd é kg
  const elValInput = document.getElementById('mens-ent-valor-input');
  if (elValInput && document.activeElement !== elValInput) {
    elValInput.value = valorTotal > 0 ? valorTotal : '';
  }
}

function _mensAtualizarPesoEntrega() {
  const p = _mens_planoEntregaAtual;
  if (!p) return;
  const tipo = _mensGetTipo(p);
  const isKg = tipo === 'kg';
  const valorUnit = parseFloat(document.getElementById('mens-ent-valor-unit-preco')?.value) || 0;
  if (!isKg || valorUnit <= 0) return;

  const valorDigitado = parseFloat(document.getElementById('mens-ent-valor-input')?.value) || 0;
  if (valorDigitado <= 0) return;
  // kg = valor / (valorUnit * 1000)
  const kgCalculado = valorDigitado / (valorUnit * 1000);
  const qtdInput = document.getElementById('mens-ent-qtd');
  if (qtdInput && document.activeElement !== qtdInput) {
    qtdInput.value = kgCalculado.toFixed(3);
  }
}

// ──────────────────────────────────────────────────────────────
//  ITENS EXTRAS NA BAIXA DO MENSALISTA
// ──────────────────────────────────────────────────────────────

function _mensRenderItensExtras() {
  const cont = document.getElementById('mens-ent-itens-extras-cont');
  if (!cont) return;

  const totalExtras = _mens_itensExtras.reduce((s, i) => s + i.preco * i.qtd, 0);

  cont.innerHTML = `
    <div style="margin-top:18px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <label style="font-size:0.78rem;font-weight:700;color:#4b5563;text-transform:uppercase;letter-spacing:.5px">
          🛒 Itens Adicionais (descontam do saldo)
        </label>
        <button onclick="_mensAbrirBuscaItemExtra()"
          style="background:#1a7a2e;color:#fff;border:none;border-radius:8px;padding:5px 12px;font-size:0.8rem;font-weight:700;cursor:pointer">
          + Adicionar
        </button>
      </div>

      ${_mens_itensExtras.length === 0
        ? `<div style="text-align:center;color:#aaa;font-size:0.82rem;padding:10px 0;border:1.5px dashed #e5e7eb;border-radius:9px">
             Nenhum item adicionado
           </div>`
        : `<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px">
            ${_mens_itensExtras.map((item, idx) => `
              <div style="display:flex;align-items:center;gap:8px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:9px;padding:8px 10px">
                <div style="flex:1;min-width:0">
                  <div style="font-size:0.85rem;font-weight:600;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.nome}</div>
                  <div style="font-size:0.75rem;color:#6b7280">Gs ${Math.round(item.preco).toLocaleString('es-PY')} /un</div>
                </div>
                <div style="display:flex;align-items:center;gap:6px">
                  <button onclick="_mensAlterarQtdExtra(${idx}, -1)"
                    style="width:26px;height:26px;border:1.5px solid #d1d5db;background:#fff;border-radius:6px;cursor:pointer;font-size:0.9rem;font-weight:700;color:#374151">−</button>
                  <span style="font-weight:700;font-size:0.9rem;min-width:20px;text-align:center">${item.qtd}</span>
                  <button onclick="_mensAlterarQtdExtra(${idx}, +1)"
                    style="width:26px;height:26px;border:1.5px solid #d1d5db;background:#fff;border-radius:6px;cursor:pointer;font-size:0.9rem;font-weight:700;color:#374151">+</button>
                </div>
                <div style="font-weight:700;font-size:0.85rem;color:#1a7a2e;min-width:70px;text-align:right">
                  Gs ${Math.round(item.preco * item.qtd).toLocaleString('es-PY')}
                </div>
                <button onclick="_mensRemoverItemExtra(${idx})"
                  style="background:#fee2e2;color:#e74c3c;border:none;border-radius:6px;width:26px;height:26px;cursor:pointer;font-size:0.85rem">✕</button>
              </div>`).join('')}
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:9px;padding:8px 12px">
            <span style="font-size:0.82rem;font-weight:600;color:#1e40af">Total extras:</span>
            <span style="font-size:1rem;font-weight:800;color:#1e40af">Gs ${Math.round(totalExtras).toLocaleString('es-PY')}</span>
          </div>`
      }
    </div>`;
}

function _mensAbrirBuscaItemExtra() {
  // Remove overlay anterior se existir
  document.getElementById('_mens-extra-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = '_mens-extra-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:flex-end;justify-content:center';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const modal = document.createElement('div');
  modal.style.cssText = 'background:#fff;border-radius:20px 20px 0 0;width:100%;max-width:480px;padding:20px 16px 28px;max-height:78vh;display:flex;flex-direction:column';

  const produtosDisponiveis = (_mens_produtos.length > 0 ? _mens_produtos : []);

  modal.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div style="font-weight:700;font-size:1rem">🛒 Adicionar Item</div>
      <button onclick="document.getElementById('_mens-extra-overlay').remove()"
        style="background:#f3f4f6;border:none;border-radius:50%;width:30px;height:30px;cursor:pointer;font-size:1rem">✕</button>
    </div>
    <input type="text" id="_mens-extra-busca" placeholder="Buscar produto..." oninput="_mensFiltraBuscaExtra()"
      style="width:100%;padding:10px 12px;border:1.5px solid #e5e7eb;border-radius:9px;font-size:0.9rem;outline:none;margin-bottom:12px">
    <div id="_mens-extra-lista" style="overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:6px"></div>
    <div style="padding-top:6px">
      <label style="font-size:0.75rem;font-weight:600;color:#6b7280;text-transform:uppercase">Ou digitar item manualmente</label>
      <div style="display:flex;gap:8px;margin-top:6px">
        <input type="text" id="_mens-extra-nome" placeholder="Nome do item"
          style="flex:2;padding:9px 10px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:0.85rem;outline:none">
        <input type="number" id="_mens-extra-preco" placeholder="Preço Gs" min="0"
          style="flex:1;padding:9px 10px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:0.85rem;outline:none">
        <button onclick="_mensAdicionarItemManual()"
          style="background:#1a7a2e;color:#fff;border:none;border-radius:8px;padding:9px 14px;font-weight:700;cursor:pointer;font-size:0.85rem">OK</button>
      </div>
    </div>`;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Renderiza lista de produtos
  _mensRenderListaExtra(produtosDisponiveis);
  setTimeout(() => document.getElementById('_mens-extra-busca')?.focus(), 100);
}

function _mensRenderListaExtra(produtos) {
  const lista = document.getElementById('_mens-extra-lista');
  if (!lista) return;
  if (!produtos.length) {
    lista.innerHTML = '<div style="text-align:center;color:#aaa;padding:20px;font-size:0.85rem">Nenhum produto encontrado</div>';
    return;
  }
  lista.innerHTML = produtos.map((pr, idx) => `
    <button onclick="_mensAdicionarItemExtra('${pr.nome.replace(/'/g, "\\'")}', ${pr.preco || 0})"
      style="display:flex;justify-content:space-between;align-items:center;background:#f9fafb;border:1.5px solid #e5e7eb;border-radius:9px;padding:10px 12px;cursor:pointer;text-align:left;width:100%;transition:background .1s"
      onmouseover="this.style.background='#f0fdf4';this.style.borderColor='#86efac'"
      onmouseout="this.style.background='#f9fafb';this.style.borderColor='#e5e7eb'">
      <span style="font-size:0.88rem;font-weight:600;color:#111">${pr.nome}</span>
      <span style="font-size:0.85rem;font-weight:700;color:#1a7a2e">Gs ${(pr.preco || 0).toLocaleString('es-PY')}</span>
    </button>`).join('');
}

function _mensFiltraBuscaExtra() {
  const busca = document.getElementById('_mens-extra-busca')?.value.toLowerCase().trim() || '';
  const filtrados = busca
    ? _mens_produtos.filter(pr => pr.nome.toLowerCase().includes(busca))
    : _mens_produtos;
  _mensRenderListaExtra(filtrados);
}

function _mensAdicionarItemExtra(nome, preco) {
  document.getElementById('_mens-extra-overlay')?.remove();
  const existe = _mens_itensExtras.find(i => i.nome === nome);
  if (existe) { existe.qtd++; }
  else { _mens_itensExtras.push({ nome, preco: parseFloat(preco) || 0, qtd: 1 }); }
  _mensRenderItensExtras();
}

function _mensAdicionarItemManual() {
  const nome  = document.getElementById('_mens-extra-nome')?.value.trim();
  const preco = parseFloat(document.getElementById('_mens-extra-preco')?.value) || 0;
  if (!nome) { alert('Informe o nome do item.'); return; }
  if (preco < 0) { alert('Informe um preço válido.'); return; }
  document.getElementById('_mens-extra-overlay')?.remove();
  const existe = _mens_itensExtras.find(i => i.nome === nome);
  if (existe) { existe.qtd++; }
  else { _mens_itensExtras.push({ nome, preco, qtd: 1 }); }
  _mensRenderItensExtras();
}

function _mensAlterarQtdExtra(idx, delta) {
  if (!_mens_itensExtras[idx]) return;
  _mens_itensExtras[idx].qtd += delta;
  if (_mens_itensExtras[idx].qtd <= 0) _mens_itensExtras.splice(idx, 1);
  _mensRenderItensExtras();
}

function _mensRemoverItemExtra(idx) {
  _mens_itensExtras.splice(idx, 1);
  _mensRenderItensExtras();
}

async function mensSalvarEntrega() {
  const planoId = parseInt(document.getElementById('mens-ent-plano-id').value);
  const obs     = document.getElementById('mens-ent-obs').value.trim();

  const p    = _mens_planos.find(p => p.id === planoId);
  if (!p) return;

  const tipo = _mensGetTipo(p);
  const isKg = tipo === 'kg';

  // Quantidade do item principal
  const qtdRaw = document.getElementById('mens-ent-qtd').value;
  const qtd    = isKg ? _mensKgToInt(qtdRaw) : (parseInt(qtdRaw) || 1);

  if (qtd <= 0) {
    alert(t('mens.alerta_qtd_valida', 'Insira uma quantidade válida.'));
    return;
  }
  if (qtd > p.quantidade_restante) {
    const max = isKg ? _mensIntToKg(p.quantidade_restante) + ' kg' : p.quantidade_restante + ' itens';
    if (!confirm(`⚠️ Saldo insuficiente. Máximo disponível: ${max}\nDeseja continuar mesmo assim (ficará negativo)?`)) {
      return;
    }
  }

  // Valor total dos itens extras
  const totalExtras = _mens_itensExtras.reduce((s, i) => s + i.preco * i.qtd, 0);

  // Valor proporcional por unidade do plano
  const valorPorUnidade = (p.quantidade_total || 0) > 0
    ? (p.valor_plano || 0) / p.quantidade_total
    : 0;

  // Saldo financeiro disponível após descontar o item principal
  const novoRestante       = p.quantidade_restante - qtd;
  const valorAposPlano     = Math.round(valorPorUnidade * novoRestante);
  const novoValorRestante  = valorAposPlano - Math.round(totalExtras); // PERMITE NEGATIVO

  // Aviso se saldo financeiro não cobrir os extras
  if (totalExtras > 0 && Math.round(totalExtras) > valorAposPlano) {
    const saldoFmt  = valorAposPlano.toLocaleString('es-PY');
    const extrasFmt = Math.round(totalExtras).toLocaleString('es-PY');
    if (!confirm(`⚠️ Saldo financeiro insuficiente para os itens extras.\n\nSaldo disponível após entrega: Gs ${saldoFmt}\nTotal dos extras: Gs ${extrasFmt}\n\nDeseja continuar mesmo assim?`)) {
      return;
    }
  }

  // Salvar entrega (com itens extras em JSON)
  const { data: entrega, error: errEnt } = await supa
    .from('mensalista_entregas')
    .insert([{
      plano_id:     planoId,
      cliente_id:   p.cliente_id,
      produto_nome: p.produto_nome,
      quantidade:   qtd,
      observacoes:  obs || null,
      itens_extras: _mens_itensExtras.length > 0 ? _mens_itensExtras : null,
      valor_extras: totalExtras > 0 ? Math.round(totalExtras) : null,
    }])
    .select('id, created_at')
    .single();

  if (errEnt) { alert(t('mens.erro_registrar', 'Erro ao registrar entrega: ') + errEnt.message); return; }

  // Atualizar saldo no plano (PERMITE NEGATIVO)
  const { error: errUp } = await supa
    .from('planos_mensalistas')
    .update({ quantidade_restante: novoRestante, valor_restante: novoValorRestante })
    .eq('id', planoId);

  if (errUp) { alert(t('mens.erro_saldo', 'Erro ao atualizar saldo: ') + errUp.message); return; }

  fecharModal('modal-mens-entrega');
  p.quantidade_restante = novoRestante;
  p.valor_restante      = novoValorRestante;
  _mensRenderKPIs();
  mensRenderPlanos();

  const novoRestFmt  = _mensFmtQtd(novoRestante, tipo);
  const qtdFmt       = _mensFmtQtd(qtd, tipo);
  const novoValorFmt = Math.round(novoValorRestante).toLocaleString('es-PY');
  const linhasExtras = _mens_itensExtras.length > 0
    ? `\nItens extras: Gs ${Math.round(totalExtras).toLocaleString('es-PY')}`
    : '';

  const imprimir = confirm(
    t('mens.confirm_sucesso', '✅ Entrega registrada!\nEntregue: {qtd}\nSaldo restante: {novoRestante}\nValor restante: Gs {valorRestante}\n\nImprimir comprovante?')
      .replace('{qtd}', qtdFmt)
      .replace('{novoRestante}', novoRestFmt)
      .replace('{valorRestante}', novoValorFmt) + linhasExtras
  );

  // Guarda extras antes de limpar o estado
  const itensExtrasSalvos = [..._mens_itensExtras];
  _mens_itensExtras = [];

  if (imprimir) {
    mensImprimirComprovante(p, qtd, obs, entrega?.id, entrega?.created_at, novoRestante, tipo, novoValorRestante, itensExtrasSalvos);
  }
}

// ──────────────────────────────────────────────────────────────
//  IMPRIMIR COMPROVANTE
// ──────────────────────────────────────────────────────────────
function mensImprimirComprovante(plano, qtd, obs, entregaId, dataEntrega, saldoApos, tipo, valorRestante, itensExtras) {
  tipo = tipo || _mensGetTipo(plano);
  const cliente  = plano.clientes || {};
  const dataFmt  = dataEntrega
    ? new Date(dataEntrega).toLocaleString('es-PY', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
    : new Date().toLocaleString('es-PY', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
  const dataFim  = plano.data_fim
    ? new Date(plano.data_fim + 'T12:00:00').toLocaleDateString('es-PY')
    : t('geral.indeterminado', 'Indeterminado');
  const saldoAnt = ((saldoApos !== undefined ? saldoApos : plano.quantidade_restante) + qtd);
  const qtdFmt   = _mensFmtQtd(qtd, tipo);
  const restFmt  = _mensFmtQtd(saldoApos !== undefined ? saldoApos : plano.quantidade_restante, tipo);
  const totFmt   = _mensFmtQtd(plano.quantidade_total, tipo);
  const antFmt   = _mensFmtQtd(saldoAnt, tipo);
  // Valor restante em dinheiro (pós-entrega)
  const saldoRestanteInt = saldoApos !== undefined ? saldoApos : plano.quantidade_restante;
  const valorRestanteGs = valorRestante != null
    ? Math.round(valorRestante)
    : (plano.quantidade_total > 0
        ? Math.round((plano.valor_plano / plano.quantidade_total) * saldoRestanteInt)
        : 0);
  const valorRestanteFmt = valorRestanteGs.toLocaleString('es-PY');
  const valorPlanoBefore = Math.round(plano.valor_plano || 0);

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>${t('mens.ticket_titulo', 'Comprovante Plano Mensal')}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:Arial,sans-serif; font-size:13px; background:#d0d0d0; padding:16px; }
    .ticket { background:#fff; max-width:320px; margin:0 auto; padding:12px; box-shadow:0 4px 12px rgba(0,0,0,0.2); }
    .center { text-align:center; }
    hr { border:none; border-top:1px dashed #000; margin:7px 0; }
    .big  { font-size:16px; font-weight:900; letter-spacing:1px; text-transform:uppercase; }
    .med  { font-size:14px; font-weight:700; }
    .sm   { font-size:11px; color:#555; }
    .row  { display:flex; justify-content:space-between; padding:3px 0; font-size:12px; gap:6px; }
    .row b { color:#111; }
    .saldo-box { background:#f0fdf4; border:1.5px solid #86efac; border-radius:8px; padding:10px 12px; margin:8px 0; text-align:center; }
    .saldo-box .num { font-size:22px; font-weight:900; color:#1a7a2e; }
    .saldo-box .lab { font-size:10px; color:#555; }
    .assinatura { margin-top:24px; text-align:center; }
    .assinatura .linha { border-top:1px solid #000; margin:0 10px 5px; }
    .assinatura .leg { font-size:10px; color:#555; }
    .btn-print { display:block; width:100%; padding:14px; background:#1a7a2e; color:#fff; border:none;
      font-size:15px; font-weight:700; cursor:pointer; margin-top:16px; border-radius:8px; font-family:Arial,sans-serif; }
    @media print {
      body { background:none; padding:0; }
      .btn-print { display:none; }
      .ticket { box-shadow:none; max-width:100%; width:100%; padding:1mm; }
      @page { margin:2mm; size:58mm auto; }
    }
  </style>
</head>
<body>
<div class="ticket">
  <div class="center" style="margin-bottom:6px">
    <div class="big">${_mens_nomeRestaurante || 'RESTAURANTE'}</div>
    <div class="med">${t('mens.ticket_cabecalho', 'COMPROVANTE PLANO MENSAL')}</div>
    <div class="sm">${dataFmt}</div>
    ${entregaId ? `<div class="sm">${t('mens.ticket_entrega', 'Entrega')} #${entregaId}</div>` : ''}
  </div>
  <hr>
  <div class="row"><span>${t('geral.cliente', 'Cliente')}:</span><b>${cliente.nome || '—'}</b></div>
  <div class="row"><span>Tel:</span><b>${cliente.telefone || '—'}</b></div>
  <hr>
  <div class="row"><span>${t('mens.ticket_plano', 'Plano / Item')}:</span><b>${plano.produto_nome}</b></div>
  <div class="row"><span>${t('mens.ticket_entregada', 'Qtd. entregue')}:</span><b>${qtdFmt}</b></div>
  ${obs ? `<div class="row"><span>Obs:</span><span>${obs}</span></div>` : ''}
  ${(itensExtras && itensExtras.length > 0) ? `
  <hr>
  <div style="font-size:11px;font-weight:700;color:#374151;margin:4px 0 2px;text-transform:uppercase;letter-spacing:.4px">Itens Adicionais</div>
  ${itensExtras.map(i => `
  <div class="row"><span>${i.nome} x${i.qtd}</span><b>Gs ${Math.round(i.preco * i.qtd).toLocaleString('es-PY')}</b></div>`).join('')}
  <div class="row" style="border-top:1px solid #e5e7eb;margin-top:3px;padding-top:4px">
    <span style="font-weight:700">Total extras:</span>
    <b style="color:#1a7a2e">Gs ${Math.round(itensExtras.reduce((s,i)=>s+i.preco*i.qtd,0)).toLocaleString('es-PY')}</b>
  </div>` : ''}
  <div class="row"><span>${t('mens.ticket_valor', 'Valor do plano')}:</span><b>Gs ${Math.round(plano.valor_plano || 0).toLocaleString('es-PY')}</b></div>
  <div class="row"><span>${t('geral.vencimento', 'Vencimento')}:</span><b>${dataFim}</b></div>
  <hr>
  <div class="saldo-box">
    <div class="lab">${t('mens.ticket_saldo_restante', 'SALDO RESTANTE APÓS ESTA ENTREGA')}</div>
    <div class="num">${restFmt}</div>
    <div class="lab">${t('mens.ticket_contratados', 'de {qtd} contratados').replace('{qtd}', totFmt)}</div>
  </div>
  <div style="background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:8px;padding:8px 12px;margin:6px 0;text-align:center">
    <div style="font-size:10px;color:#555;margin-bottom:2px">${t('mens.ticket_saldo_restante_val', 'VALOR RESTANTE')}</div>
    <div style="font-size:20px;font-weight:900;color:#1d4ed8">Gs ${valorRestanteFmt}</div>
    <div style="font-size:10px;color:#555">${t('mens.ticket_contratados', 'de {qtd} contratados').replace('{qtd}', 'Gs ' + valorPlanoBefore.toLocaleString('es-PY'))}</div>
  </div>
  <div class="center sm" style="margin-top:4px">${t('mens.ticket_saldo_anterior', 'Saldo anterior')}: ${antFmt}</div>
  <hr>
  <div class="assinatura">
    <div style="font-size:11px;color:#555;margin-bottom:16px">
      ${t('mens.ticket_declaracao', 'Confirmo que recebi o(s) item(ns) acima conforme meu plano mensal.')}
    </div>
    <div class="linha"></div>
    <div class="leg">${t('mens.ticket_assinatura', 'Assinatura do cliente')} — ${cliente.nome || '_________________'}</div>
    <div class="leg" style="margin-top:8px">${t('geral.data', 'Data')}: ____/____/________</div>
  </div>
  <hr>
  <div class="center sm">*** ${t('geral.obrigado', 'OBRIGADO')} ***</div>
</div>
<button class="btn-print" onclick="window.print()">${t('mens.ticket_imprimir', '🖨️ IMPRIMIR COMPROVANTE')}</button>
<script>setTimeout(()=>window.print(), 600);</script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=420,height=680,scrollbars=yes');
  if (win) {
    win.document.write(html);
    win.document.close();
  } else {
    alert(t('geral.popup_bloqueado', 'Popup bloqueado. Permita popups para este site para imprimir.'));
  }
}

// ──────────────────────────────────────────────────────────────
//  HISTÓRICO DE ENTREGAS
// ──────────────────────────────────────────────────────────────
async function mensVerHistorico(planoId) {
  const p = _mens_planos.find(p => p.id === planoId);
  if (!p) return;

  const tipo = _mensGetTipo(p);

  const { data } = await supa
    .from('mensalista_entregas')
    .select('*')
    .eq('plano_id', planoId)
    .order('created_at', { ascending: false });

  const entregasTotal = (data || []).reduce((s, e) => s + (e.quantidade || 0), 0);

  // Monta cards
  let html = `
    <div style="margin-bottom:16px; background:#f9fafb; border-radius:12px; padding:12px 16px;">
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:10px;">
        <div><span style="color:#6b7280;">Cliente</span><br><b>${p.clientes?.nome || '—'}</b></div>
        <div><span style="color:#6b7280;">Produto</span><br><b>${p.produto_nome}</b></div>
        <div><span style="color:#6b7280;">Contratado</span><br><b>${_mensFmtQtd(p.quantidade_total, tipo)}</b></div>
        <div><span style="color:#6b7280;">Entregue</span><br><b>${_mensFmtQtd(entregasTotal, tipo)}</b></div>
        <div><span style="color:#6b7280;">Restante</span><br><b style="color:#1a7a2e;">${_mensFmtQtd(p.quantidade_restante, tipo)}</b></div>
      </div>
    </div>
  `;

  if (!data || data.length === 0) {
    html += `<div style="text-align:center;color:#aaa;padding:20px;">${t('mens.nenhuma_entrega', 'Nenhuma entrega registrada ainda')}</div>`;
  } else {
    html += `<div style="display:flex;flex-direction:column;gap:10px;">`;
    data.forEach(e => {
      const itensExtras = e.itens_extras || [];
      const temExtras = itensExtras.length > 0;
      const valorExtra = e.valor_extras ? Math.round(e.valor_extras).toLocaleString('es-PY') : null;
      const nomesExtras = temExtras
        ? itensExtras.map(i => `${i.nome} x${i.qtd}`).join(', ')
        : '';

      html += `
        <div style="background:#fff; border:1.5px solid #e5e7eb; border-radius:12px; padding:14px 16px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:8px;">
            <div>
              <div style="font-weight:700; font-size:0.9rem;">
                ${new Date(e.created_at).toLocaleString('es-PY', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' })}
                <span style="font-weight:400; color:#6b7280; font-size:0.8rem;">#${e.id}</span>
              </div>
              <div style="font-weight:700; color:#1a7a2e; font-size:1rem;">
                ${_mensFmtQtd(e.quantidade, tipo)}
              </div>
              ${e.observacoes ? `<div style="font-size:0.8rem; color:#6b7280; margin-top:4px;">${e.observacoes}</div>` : ''}
              ${temExtras ? `
                <div style="margin-top:4px; font-size:0.8rem; background:#eff6ff; padding:4px 8px; border-radius:6px; display:inline-block;">
                  🛒 Itens extras: ${nomesExtras} ${valorExtra ? `(+ Gs ${valorExtra})` : ''}
                </div>
              ` : ''}
            </div>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <button onclick="mensAbrirEditarEntrega(${e.id}, ${planoId})"
                style="padding:6px 12px; background:#3498db; color:#fff; border:none; border-radius:8px; cursor:pointer; font-size:0.8rem; font-weight:600;">
                ✏️ Editar
              </button>
              <button onclick="mensReimprimirEntrega(${e.id}, ${planoId})"
                style="padding:6px 12px; background:#f3f4f6; color:#374151; border:1px solid #e5e7eb; border-radius:8px; cursor:pointer; font-size:0.8rem; font-weight:600;">
                🖨️
              </button>
            </div>
          </div>
        </div>
      `;
    });
    html += `</div>`;
  }

  document.getElementById('mens-hist-nome').textContent = p.clientes?.nome || '—';
  document.getElementById('mens-hist-produto').textContent = p.produto_nome;
  document.getElementById('mens-hist-plano-total').textContent = _mensFmtQtd(p.quantidade_total, tipo);
  document.getElementById('mens-hist-plano-rest').textContent = _mensFmtQtd(p.quantidade_restante, tipo);
  document.getElementById('mens-hist-entregues').textContent = _mensFmtQtd(entregasTotal, tipo);
  document.getElementById('mens-hist-tbody').innerHTML = ''; // não usamos mais tabela

  // Injetamos o conteúdo no modal
  const modalBody = document.querySelector('#modal-mens-hist .modal-body') || document.querySelector('#modal-mens-hist > div > div');
  if (modalBody) {
    modalBody.innerHTML = html;
  } else {
    const tbody = document.getElementById('mens-hist-tbody');
    if (tbody) tbody.innerHTML = html;
  }

  const _mmh = document.getElementById('modal-mens-hist');
  if (_mmh) { _mmh.style.cssText += ';position:fixed!important;top:0;left:0;width:100%;height:100%;z-index:9999;'; _mmh.style.display = 'flex'; }
}

// ── EDITAR ENTREGA ──────────────────────────────────────────────
let _entregaEditando = null;
let _planoEditando = null;

async function mensAbrirEditarEntrega(entregaId, planoId) {

  fecharModal('modal-mens-hist');
  const { data: entrega, error } = await supa
    .from('mensalista_entregas')
    .select('*')
    .eq('id', entregaId)
    .single();

  if (error || !entrega) { alert('Erro ao buscar entrega.'); return; }

  _entregaEditando = entrega;
  _planoEditando = _mens_planos.find(p => p.id === planoId);
  if (!_planoEditando) { alert('Plano não encontrado.'); return; }

  const tipo = _mensGetTipo(_planoEditando);
  const isKg = tipo === 'kg';

  // Preencher modal de edição (reutilizamos o mesmo modal de entrada)
  const modal = document.getElementById('modal-mens-entrega');
  document.querySelector('#modal-mens-entrega h3').textContent = '✏️ Editar Entrega';
  document.querySelector('#modal-mens-entrega .btn-lancar').textContent = '💾 Salvar Alterações';
  document.querySelector('#modal-mens-entrega .btn-lancar').onclick = mensSalvarEdicaoEntrega;

  document.getElementById('mens-ent-plano-id').value = planoId;
  document.getElementById('mens-ent-cliente').textContent = _planoEditando.clientes?.nome || '—';
  document.getElementById('mens-ent-tel').textContent = _planoEditando.clientes?.telefone || '';
  document.getElementById('mens-ent-produto').textContent = _planoEditando.produto_nome;

  const qtdInput = document.getElementById('mens-ent-qtd');
  const qtdLabel = document.getElementById('mens-ent-qtd-label');
  if (isKg) {
    qtdInput.step = '0.001';
    qtdInput.min = '0.001';
    qtdInput.value = _mensIntToKg(entrega.quantidade);
    if (qtdLabel) qtdLabel.textContent = 'Peso (kg) *';
  } else {
    qtdInput.step = '1';
    qtdInput.min = '1';
    qtdInput.value = entrega.quantidade;
    if (qtdLabel) qtdLabel.textContent = 'Quantidade *';
  }

  document.getElementById('mens-ent-obs').value = entrega.observacoes || '';
  _mens_itensExtras = entrega.itens_extras || [];
  _mensRenderItensExtras();

  modal.style.display = 'flex';
  document.getElementById('mens-ent-qtd').focus();
  
}

async function mensSalvarEdicaoEntrega() {
  if (!_entregaEditando || !_planoEditando) { alert('Nenhuma entrega em edição.'); return; }

  const planoId = parseInt(document.getElementById('mens-ent-plano-id').value);
  const obs = document.getElementById('mens-ent-obs').value.trim();
  const tipo = _mensGetTipo(_planoEditando);
  const isKg = tipo === 'kg';

  const qtdRaw = document.getElementById('mens-ent-qtd').value;
  const novaQtd = isKg ? _mensKgToInt(qtdRaw) : (parseInt(qtdRaw) || 0);
  if (novaQtd <= 0) { alert('Insira uma quantidade válida.'); return; }

  const qtdAntiga = _entregaEditando.quantidade;
  const diff = novaQtd - qtdAntiga; // diferença (se aumentou, consome mais saldo; se diminuiu, devolve)

  const novoSaldo = _planoEditando.quantidade_restante - diff;
  if (novoSaldo < 0) {
    if (!confirm(`⚠️ Após essa alteração, o saldo ficará negativo (${_mensFmtQtd(novoSaldo, tipo)}). Continuar?`)) return;
  }

  // Atualizar entrega
  const { error: errUpd } = await supa
    .from('mensalista_entregas')
    .update({
      quantidade: novaQtd,
      observacoes: obs,
      itens_extras: _mens_itensExtras.length > 0 ? _mens_itensExtras : null,
      valor_extras: _mens_itensExtras.reduce((s, i) => s + i.preco * i.qtd, 0)
    })
    .eq('id', _entregaEditando.id);

  if (errUpd) { alert('Erro ao atualizar entrega: ' + errUpd.message); return; }

  // Atualizar plano: quantidade_restante e valor_restante (recalcular)
  const novoRestante = _planoEditando.quantidade_restante - diff;
  const valorPorUnidade = (_planoEditando.quantidade_total || 0) > 0
    ? (_planoEditando.valor_plano || 0) / _planoEditando.quantidade_total
    : 0;
  const novoValorRestante = Math.round(valorPorUnidade * novoRestante);

  const { error: errPlano } = await supa
    .from('planos_mensalistas')
    .update({
      quantidade_restante: novoRestante,
      valor_restante: novoValorRestante
    })
    .eq('id', planoId);

  if (errPlano) { alert('Erro ao atualizar plano: ' + errPlano.message); return; }

  // Atualizar estado local
  _planoEditando.quantidade_restante = novoRestante;
  _planoEditando.valor_restante = novoValorRestante;

  fecharModal('modal-mens-entrega');
  mensVerHistorico(planoId);
  mensCarregarPlanos();
  _entregaEditando = null;
  _planoEditando = null;
  _mens_itensExtras = [];
}

async function mensReimprimirEntrega(entregaId, planoId) {
  const { data: e } = await supa
    .from('mensalista_entregas')
    .select('*')
    .eq('id', entregaId)
    .single();

  const p = _mens_planos.find(p => p.id === planoId);
  if (!e || !p) return;

  const { data: posteriores } = await supa
    .from('mensalista_entregas')
    .select('quantidade')
    .eq('plano_id', planoId)
    .gt('created_at', e.created_at);

  const qtdPosteriores = (posteriores || []).reduce((s, x) => s + (x.quantidade || 0), 0);
  const saldoApos = p.quantidade_restante + qtdPosteriores;
  // Recalcula valor restante naquele momento histórico
  const valorRestanteHistorico = p.quantidade_total > 0
    ? Math.round((p.valor_plano / p.quantidade_total) * saldoApos)
    : 0;

  mensImprimirComprovante(p, e.quantidade, e.observacoes, e.id, e.created_at, saldoApos, undefined, valorRestanteHistorico, e.itens_extras || []);
}

// ──────────────────────────────────────────────────────────────
//  UTILITÁRIOS
// ──────────────────────────────────────────────────────────────
function mensFiltrar() {
  mensRenderPlanos();
}

// ──────────────────────────────────────────────────────────────
//  WHATSAPP — AVISO DE PLANO ACABANDO
// ──────────────────────────────────────────────────────────────
function mensEnviarWhatsAppAviso(planoId) {
  const p = _mens_planos.find(p => p.id === planoId);
  if (!p) return;

  const tipo       = _mensGetTipo(p);
  const nomeCliente = p.clientes?.nome || '';
  const telefone   = (p.clientes?.telefone || '').replace(/\D/g, '');
  const saldoFmt   = _mensFmtQtd(p.quantidade_restante, tipo);
  const totalFmt   = _mensFmtQtd(p.quantidade_total, tipo);
  const dataFim    = p.data_fim
    ? new Date(p.data_fim + 'T12:00:00').toLocaleDateString('es-PY')
    : null;
  const vencimento = dataFim ? (window._lang === 'es'
    ? `\nVencimiento del plan: ${dataFim}`
    : `\nVencimento do plano: ${dataFim}`) : '';
  const restaurante = _mens_nomeRestaurante || 'RESTAURANTE';

  // Valor restante do plano
  const valorRestGs = p.valor_restante != null
    ? Math.round(p.valor_restante)
    : (p.quantidade_total > 0 ? Math.round((p.valor_plano / p.quantidade_total) * p.quantidade_restante) : 0);
  const valorRestFmt = valorRestGs.toLocaleString('es-PY');

  const msgs = {
    pt: `Olá, *${nomeCliente}*! 👋\n\nPassando para avisar que o seu plano mensal de *${p.produto_nome}* está chegando ao fim.\n\n📦 Saldo restante: *${saldoFmt}* de ${totalFmt}\n💰 Valor restante: *Gs ${valorRestFmt}*${vencimento}\n\nRenove para continuar aproveitando sem interrupção! 😊\n\n_${restaurante}_`,
    es: `Hola, *${nomeCliente}*! 👋\n\nTe avisamos que tu plan mensual de *${p.produto_nome}* está llegando a su fin.\n\n📦 Saldo restante: *${saldoFmt}* de ${totalFmt}\n💰 Valor restante: *Gs ${valorRestFmt}*${vencimento}\n\n¡Renovalo para seguir disfrutando sin interrupciones! 😊\n\n_${restaurante}_`,
  };

  // Modal de seleção de idioma
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10000;display:flex;align-items:center;justify-content:center';

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:24px;max-width:340px;width:92%;box-shadow:0 8px 32px rgba(0,0,0,0.18)">
      <div style="font-size:1.4rem;text-align:center;margin-bottom:4px">💬</div>
      <div style="font-weight:700;font-size:1rem;text-align:center;margin-bottom:4px">WhatsApp — ${nomeCliente}</div>
      <div style="font-size:0.82rem;color:#6b7280;text-align:center;margin-bottom:18px">
        ${telefone ? '📱 ' + p.clientes.telefone : '⚠️ Telefone não cadastrado'}
      </div>
      <div style="font-size:0.8rem;font-weight:600;color:#374151;margin-bottom:8px">Escolha o idioma da mensagem:</div>
      <div style="display:flex;gap:10px;margin-bottom:16px">
        <button id="_wa_pt" style="flex:1;padding:11px;background:#25d366;color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:0.9rem">
          🇧🇷 Português
        </button>
        <button id="_wa_es" style="flex:1;padding:11px;background:#25d366;color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:0.9rem">
          🇵🇾 Español
        </button>
      </div>
      <button id="_wa_cancel" style="width:100%;padding:9px;background:#f3f4f6;color:#374151;border:none;border-radius:10px;cursor:pointer;font-size:0.85rem">
        Cancelar
      </button>
    </div>`;

  document.body.appendChild(overlay);

  const abrir = (lang) => {
    document.body.removeChild(overlay);
    const msg = msgs[lang];
    if (!telefone) {
      alert('⚠️ Este cliente não possui telefone cadastrado.');
      return;
    }
    // Formata número: se começar com 0, substitui pelo DDI 595 (Paraguai)
    let num = telefone;
    if (num.startsWith('0')) num = '595' + num.substring(1);
    else if (!num.startsWith('595') && num.length <= 10) num = '595' + num;
    const url = `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
  };

  overlay.querySelector('#_wa_pt').onclick = () => abrir('pt');
  overlay.querySelector('#_wa_es').onclick = () => abrir('es');
  overlay.querySelector('#_wa_cancel').onclick = () => document.body.removeChild(overlay);
  overlay.onclick = (e) => { if (e.target === overlay) document.body.removeChild(overlay); };
}

// ──────────────────────────────────────────────────────────────
//  EXCLUIR PLANO
// ──────────────────────────────────────────────────────────────
async function mensExcluirPlano(id) {
  if (!confirm(t('mens.confirm_excluir', 'Excluir este plano? As entregas registradas também serão excluídas.'))) return;
  try {
    await supa.from('mensalista_entregas').delete().eq('plano_id', id);
    const { error } = await supa.from('planos_mensalistas').delete().eq('id', id);
    if (error) { alert(t('mens.erro_excluir', 'Erro ao excluir: ') + error.message); return; }
    await initMensalistas();
  } catch(e) { alert(t('ft.erro', 'Erro: ') + e.message); }
}
