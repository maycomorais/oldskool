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

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('mens-kpi-total',   total);
  set('mens-kpi-ativos',  ativos);
  set('mens-kpi-receita', `Gs ${Math.round(receita).toLocaleString('es-PY')}`);

  // Oculta o card de itens restantes (se existir no HTML)
  const elItens = document.getElementById('mens-kpi-itens');
  if (elItens) {
    elItens.style.display = 'none';
    const card = elItens.closest('.kpi-card') || elItens.parentElement;
    if (card) card.style.display = 'none';
  }
}

function mensRenderPlanos() {
  const cont = document.getElementById('mens-lista-planos');
  if (!cont) return;

  const filtro = (document.getElementById('mens-filtro-status')?.value || 'todos');
  const busca = (document.getElementById('mens-busca')?.value || '').toLowerCase().trim();

  let planos = _mens_planos.filter(p => {
    if (filtro === 'ativo' && !p.ativo) return false;
    if (filtro === 'inativo' && p.ativo) return false;
    if (busca) {
      const nome = (p.clientes?.nome || '').toLowerCase();
      const tel = (p.clientes?.telefone || '').toLowerCase();
      const produto = (p.produto_nome || '').toLowerCase();
      if (!nome.includes(busca) && !tel.includes(busca) && !produto.includes(busca)) return false;
    }
    return true;
  });

  if (!planos.length) {
    cont.innerHTML = `<div style="text-align:center;color:#aaa;padding:40px">Nenhum plano mensal registrado ainda.</div>`;
    return;
  }

  cont.innerHTML = planos.map(p => {
    const valorPlano = Math.round(p.valor_plano || 0);
    const valorRestante = Math.round(p.valor_restante || 0);
    const pct = valorPlano > 0 ? Math.round((valorRestante / valorPlano) * 100) : 0;
    const barColor = pct > 50 ? '#1a7a2e' : pct > 20 ? '#f39c12' : '#e74c3c';
    const statusColor = p.ativo ? '#1a7a2e' : '#9ca3af';
    const dataFim = p.data_fim
      ? new Date(p.data_fim + 'T12:00:00').toLocaleDateString('es-PY')
      : 'Indeterminado';
    const vencendo = p.data_fim && new Date(p.data_fim) < new Date(Date.now() + 7 * 86400000);
    const esgotado = valorRestante <= 0 && p.ativo;

    return `
      <div style="background:#fff;border:1.5px solid ${p.ativo ? '#d1fae5' : '#e5e7eb'};border-radius:14px;padding:16px;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,0.05)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:1rem;margin-bottom:2px">${p.clientes?.nome || '—'}</div>
            <div style="color:#6b7280;font-size:0.82rem">${p.clientes?.telefone || ''}</div>
            <div style="font-weight:600;font-size:0.9rem;margin-top:6px;color:#111">${p.produto_nome}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <span style="background:${p.ativo ? '#dcfce7' : '#f3f4f6'};color:${statusColor};padding:3px 11px;border-radius:10px;font-size:0.73rem;font-weight:700">
              ${p.ativo ? '● ATIVO' : '○ INATIVO'}
            </span>
            <div style="font-size:0.75rem;color:${vencendo && p.ativo ? '#e74c3c' : '#9ca3af'};margin-top:5px">
              ${vencendo && p.ativo ? '⚠️ ' : ''}Vence: ${dataFim}
            </div>
            <div style="font-weight:700;color:#1a7a2e;font-size:0.95rem;margin-top:3px">
              Gs ${valorPlano.toLocaleString('es-PY')}
            </div>
          </div>
        </div>

        <div style="margin-top:12px">
          <div style="display:flex;justify-content:space-between;font-size:0.82rem;margin-bottom:5px">
            <span style="color:#555">Saldo financeiro: <b style="color:#111">Gs ${valorRestante.toLocaleString('es-PY')}</b></span>
            <span style="color:${barColor};font-weight:700">${pct}%</span>
          </div>
          <div style="background:#f0f0f0;border-radius:6px;height:9px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${barColor};border-radius:6px;transition:width 0.4s"></div>
          </div>
        </div>

        <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap">
          ${p.ativo && valorRestante > 0 ? `
          <button onclick="mensAbrirEntrega(${p.id})"
            style="flex:2;padding:9px;background:#1a7a2e;color:#fff;border:none;border-radius:9px;cursor:pointer;font-size:0.83rem;font-weight:700;min-width:120px">
            📦 Registrar Desconto
          </button>` : ''}
          ${esgotado || !p.ativo || vencendo ? `
          <button onclick="mensAbrirModalRenovacao(${p.id})"
            style="flex:2;padding:9px;background:#2980b9;color:#fff;border:none;border-radius:9px;cursor:pointer;font-size:0.83rem;font-weight:700;min-width:120px">
            🔄 Renovar Plano
          </button>` : ''}
          <button onclick="mensAbrirModalPlano(${p.id})"
            style="flex:1;padding:9px;background:#3498db;color:#fff;border:none;border-radius:9px;cursor:pointer;font-size:0.83rem;font-weight:600;min-width:70px"
            title="Editar plano">
            ✏️
          </button>
          <button onclick="mensVerHistorico(${p.id})"
            style="flex:1;padding:9px;background:#9b59b6;color:#fff;border:none;border-radius:9px;cursor:pointer;font-size:0.83rem;font-weight:600;min-width:70px">
            📋
          </button>
          <button onclick="mensEnviarWhatsAppAviso(${p.id})"
            style="flex:0 0 40px;padding:9px;background:#dcfce7;color:#25d366;border:none;border-radius:9px;cursor:pointer;font-size:0.9rem;font-weight:700"
            title="Avisar cliente pelo WhatsApp">
            💬
          </button>
          <button onclick="mensExcluirPlano(${p.id})"
            style="flex:0 0 40px;padding:9px;background:#fee2e2;color:#e74c3c;border:none;border-radius:9px;cursor:pointer;font-size:0.9rem;font-weight:700"
            title="Excluir plano">
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
// function mensToggleTipoPlano() {
//   const tipo  = document.getElementById('mens-plano-tipo')?.value || 'un';
//   const label = document.getElementById('mens-plano-qtd-label');
//   const input = document.getElementById('mens-plano-qtd');
//   if (tipo === 'kg') {
//     if (label) label.textContent = 'Peso total contratado (kg) *';
//     if (input) { input.placeholder = 'Ex: 5.250'; input.step = '0.001'; input.min = '0.001'; }
//   } else {
//     if (label) label.textContent = 'Qtd Total de Itens *';
//     if (input) { input.placeholder = 'Ex: 22'; input.step = '1'; input.min = '1'; }
//   }
// }

// ── Auto-cálculo peso ↔ valor (planos tipo "kg") ────────────────────
// Usa produtos.preco como preço por kg — mesma convenção já usada no PDV
// para itens vendidos por peso (ver cfg.preco_kg || p.preco em admin.js).
// Assim, ao criar/editar um plano em kg, digitar o peso já calcula o valor
// e digitar o valor já calcula o peso correspondente, sempre coerentes.
function _mensPrecoKgProdutoAtual() {
  const nome = (document.getElementById('mens-plano-produto')?.value || '').trim().toLowerCase();
  if (!nome) return 0;
  const prod = _mens_produtos.find(p => (p.nome || '').trim().toLowerCase() === nome);
  return prod?.preco || 0;
}

function _mensPlanoQtdParaValor() {
  if ((document.getElementById('mens-plano-tipo')?.value) !== 'kg') return;
  const precoKg = _mensPrecoKgProdutoAtual();
  if (!precoKg) return; // sem produto/preço de referência ainda — não força nada
  const kg = parseFloat(document.getElementById('mens-plano-qtd')?.value);
  if (isNaN(kg) || kg < 0) return;
  const valorEl = document.getElementById('mens-plano-valor');
  if (valorEl) valorEl.value = Math.round(precoKg * kg);
}

function _mensPlanoValorParaQtd() {
  if ((document.getElementById('mens-plano-tipo')?.value) !== 'kg') return;
  const precoKg = _mensPrecoKgProdutoAtual();
  if (!precoKg) return;
  const valor = parseFloat(document.getElementById('mens-plano-valor')?.value);
  if (isNaN(valor) || valor < 0) return;
  const qtdEl = document.getElementById('mens-plano-qtd');
  if (qtdEl) qtdEl.value = (valor / precoKg).toFixed(3);
}

function mensAbrirModalPlano(id = null, renovacao = false) {
  const p = id ? _mens_planos.find(p => p.id === id) : null;
  const nota = p ? _mensGetNota(p) : '';

  const _mset = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  _mset('mens-plano-id', p?.id || '');
  _mset('mens-plano-cli-id', p?.cliente_id || '');
  _mset('mens-plano-renovacao', renovacao ? '1' : '');
  _mset('mens-plano-produto', p?.produto_nome || '');
  _mset('mens-plano-valor', p?.valor_plano || '');
  _mset('mens-plano-ini', renovacao ? new Date().toISOString().split('T')[0] : (p?.data_inicio || new Date().toISOString().split('T')[0]));
  _mset('mens-plano-fim', renovacao ? '' : (p?.data_fim || ''));
  _mset('mens-plano-nota', nota);

  // Remove os campos de quantidade e tipo (oculta)
  const qtdRow = document.getElementById('mens-plano-qtd')?.closest('.form-group') || document.getElementById('mens-plano-qtd')?.parentElement;
  if (qtdRow) qtdRow.style.display = 'none';

  const tipoRow = document.getElementById('mens-plano-tipo')?.closest('.form-group') || document.getElementById('mens-plano-tipo')?.parentElement;
  if (tipoRow) tipoRow.style.display = 'none';

  // Ocultar também o label de quantidade (se houver)
  const qtdLabel = document.getElementById('mens-plano-qtd-label')?.closest('.form-group');
  if (qtdLabel) qtdLabel.style.display = 'none';

  // Popula select de clientes
  const selCli = document.getElementById('mens-plano-cli-sel');
  if (selCli) {
    selCli.innerHTML = `<option value="">— Selecione o cliente —</option>` +
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
    selProd.innerHTML = `<option value="">— Selecione do cardápio —</option>` +
      _mens_produtos.map(pr =>
        `<option value="${pr.nome}" ${p?.produto_nome === pr.nome ? 'selected' : ''}>${pr.nome}${pr.categoria_slug ? ' · ' + pr.categoria_slug : ''}</option>`
      ).join('');
    selProd.onchange = () => {
      if (selProd.value) document.getElementById('mens-plano-produto').value = selProd.value;
    };
  }

  // Título e botão
  const titulo = document.getElementById('mens-plano-titulo');
  const btnSalvar = document.getElementById('mens-plano-btn-salvar');
  const infoRenov = document.getElementById('mens-renov-info');

  if (renovacao && p) {
    const saldoValorFmt = Math.round(
      p.valor_restante != null ? p.valor_restante
        : (p.quantidade_total > 0 ? (p.valor_plano / p.quantidade_total) * p.quantidade_restante : 0)
    ).toLocaleString('es-PY');
    if (titulo) titulo.innerHTML = '🔄 Renovar Plano';
    if (btnSalvar) btnSalvar.innerHTML = '🔄 Renovar e Cobrar';
    if (infoRenov) {
      infoRenov.style.display = 'block';
      infoRenov.innerHTML = `
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;font-size:0.82rem;color:#1e40af;margin-bottom:14px">
          🔄 <b>Renovando o plano de ${p.clientes?.nome || ''}.</b><br>
          Isso inicia um novo ciclo: o saldo atual (<b>Gs ${saldoValorFmt}</b>) será substituído pelo novo valor que você definir.
        </div>`;
    }
  } else if (p) {
    if (titulo) titulo.innerHTML = '✏️ Editar Plano';
    if (btnSalvar) btnSalvar.innerHTML = 'Salvar Plano';
    if (infoRenov) {
      infoRenov.style.display = 'block';
      infoRenov.innerHTML = `
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;font-size:0.82rem;color:#1e40af;margin-bottom:14px">
          <b>Ajuste manual:</b> Ao modificar o valor do plano, o saldo restante será recalculado proporcionalmente.<br>
          Saldo atual: <b>Gs ${Math.round(p.valor_restante || 0).toLocaleString('es-PY')}</b>
        </div>`;
    }
  } else {
    if (titulo) titulo.innerHTML = '📋 Plano Mensalista';
    if (btnSalvar) btnSalvar.innerHTML = 'Salvar Plano';
    if (infoRenov) infoRenov.style.display = 'none';
  }

  const _mmp = document.getElementById('modal-mens-plano');
  if (_mmp) { _mmp.style.display = 'flex'; }
  setTimeout(() => document.getElementById('mens-plano-cli-sel')?.focus(), 100);
}

// Atalho para abrir o modal já em modo renovação
function mensAbrirModalRenovacao(id) {
  if (!id) return;
  mensAbrirModalPlano(id, true);
}

async function mensSalvarPlano() {
  const id = document.getElementById('mens-plano-id').value;
  const cliente_id = parseInt(document.getElementById('mens-plano-cli-id').value) || null;
  const produto_nome = document.getElementById('mens-plano-produto').value.trim();
  const nota = document.getElementById('mens-plano-nota')?.value.trim() || '';
  const valor = parseFloat(document.getElementById('mens-plano-valor').value) || 0;
  const data_ini = document.getElementById('mens-plano-ini').value || null;
  const data_fim = document.getElementById('mens-plano-fim').value || null;
  const ativo = document.getElementById('mens-plano-ativo')?.checked ?? true;

  if (!cliente_id) { alert('Selecione o cliente.'); return; }
  if (!produto_nome) { alert('Insira o produto/item do plano.'); return; }
  if (valor <= 0) { alert('Insira o valor do plano.'); return; }

  const renovacao = document.getElementById('mens-plano-renovacao')?.value === '1';
  const planoAtual = id ? _mens_planos.find(p => p.id == id) : null;

  // Valor a cobrar (diferença ou total na renovação)
  const valorACobrar = renovacao
    ? valor
    : (planoAtual ? Math.max(0, valor - (planoAtual.valor_plano || 0)) : valor);

  let formaPag = null;
  if (valorACobrar > 0) {
    if (!_sessaoCaixaAtiva) {
      alert('⚠️ Não há caixa aberto. Abra o caixa antes de registrar o pagamento do plano.');
      return;
    }
    formaPag = await _notasModalFormaPagamento();
    if (!formaPag) return;
  }

  // Payload: ignora quantidade_total e quantidade_restante (definimos 0)
  const payload = {
    cliente_id,
    produto_nome,
    quantidade_total: 0,
    quantidade_restante: 0,
    valor_plano: valor,
    data_inicio: data_ini,
    data_fim,
    ativo,
    obs: JSON.stringify({ t: 'un', n: nota }), // mantemos o tipo 'un' para compatibilidade
  };

  let error;
  if (id && renovacao) {
    // Renovação: reinicia o saldo financeiro
    payload.valor_restante = valor;
    ({ error } = await supa.from('planos_mensalistas').update(payload).eq('id', id));
  } else if (id) {
    // Edição: ajusta o valor_restante proporcionalmente
    if (planoAtual && valor !== planoAtual.valor_plano) {
      const pctRestante = (planoAtual.valor_restante || 0) / (planoAtual.valor_plano || 1);
      payload.valor_restante = Math.round(valor * pctRestante);
    } else if (planoAtual) {
      payload.valor_restante = planoAtual.valor_restante;
    }
    ({ error } = await supa.from('planos_mensalistas').update(payload).eq('id', id));
  } else {
    payload.valor_restante = valor;
    ({ error } = await supa.from('planos_mensalistas').insert([payload]));
  }

  if (error) { alert('Erro ao salvar: ' + error.message); return; }

  // Registra entrada no caixa
  if (valorACobrar > 0 && formaPag) {
    const clienteNome = _mens_clientes.find(c => c.id === cliente_id)?.nome || 'Cliente';
    const usuario_email = document.getElementById('user-email')?.innerText || 'admin';
    const descricao = renovacao
      ? `Mensalista - Renovação: ${produto_nome} (${clienteNome}) - ${formaPag}`
      : planoAtual
        ? `Mensalista - Reforço: ${produto_nome} (${clienteNome}) - ${formaPag}`
        : `Mensalista - Novo plano: ${produto_nome} (${clienteNome}) - ${formaPag}`;
    await registrarMovimentacaoCaixa({
      tipo: 'entrada',
      valor: valorACobrar,
      descricao,
      usuario_email,
      sessao_id: _sessaoCaixaAtiva.id,
      forma_pagamento: formaPag,
    });
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

  const p = _mens_planoEntregaAtual;
  const tipo = _mensGetTipo(p);
  const isKg = tipo === 'kg';

  // Limpa itens extras
  _mens_itensExtras = [];

  document.getElementById('mens-ent-plano-id').value = p.id;
  document.getElementById('mens-ent-cliente').textContent = p.clientes?.nome || '—';
  document.getElementById('mens-ent-tel').textContent = p.clientes?.telefone || '';
  document.getElementById('mens-ent-produto').textContent = p.produto_nome;
  document.getElementById('mens-ent-obs').value = '';

  // Saldo financeiro disponível
  const saldoFinanceiro = Math.round(p.valor_restante || 0);
  document.getElementById('mens-ent-saldo').textContent = `Gs ${saldoFinanceiro.toLocaleString('es-PY')}`;

  // Campo de valor (único campo de entrada)
  const qtdLabel = document.getElementById('mens-ent-qtd-label');
  const qtdInput = document.getElementById('mens-ent-qtd');
  if (qtdLabel) qtdLabel.textContent = 'Valor a descontar (Gs) *';
  if (qtdInput) {
    qtdInput.type = 'number';
    qtdInput.step = '1000';
    qtdInput.min = '1000';
    qtdInput.placeholder = 'Ex: 5000';
    qtdInput.value = '';
    qtdInput.max = '';
    qtdInput.style.display = 'block';
  }

  // Oculta o valor unitário (não será usado)
  const elValor = document.getElementById('mens-ent-valor-unit');
  if (elValor) elValor.textContent = '';

  // Remove referência ao campo de valor unitário (esconder)
  const valorInputContainer = document.getElementById('mens-ent-valor-input')?.closest('.row');
  if (valorInputContainer) valorInputContainer.style.display = 'none';

  // Renderiza itens extras (se houver)
  _mensRenderItensExtras();

  const _mme = document.getElementById('modal-mens-entrega');
  if (_mme) {
    _mme.style.cssText += ';position:fixed!important;top:0;left:0;width:100%;height:100%;z-index:9999;';
    _mme.style.display = 'flex';
  }
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
  const obs = document.getElementById('mens-ent-obs').value.trim();

  const p = _mens_planos.find(p => p.id === planoId);
  if (!p) return;

  // Valor a descontar (em Gs) – lê do campo que agora é valor
  const valorDesconto = parseFloat(document.getElementById('mens-ent-qtd').value) || 0;

  if (valorDesconto <= 0) {
    alert('Informe um valor válido (mínimo Gs 1.000).');
    return;
  }

  // Saldo financeiro atual
  const saldoAtual = p.valor_restante || 0;

  // Verifica se o saldo é suficiente (opcional, pode permitir negativo)
  if (valorDesconto > saldoAtual) {
    if (!confirm(`⚠️ Saldo insuficiente. Saldo atual: Gs ${Math.round(saldoAtual).toLocaleString('es-PY')}\nValor a descontar: Gs ${valorDesconto.toLocaleString('es-PY')}\n\nDeseja continuar (saldo ficará negativo)?`)) {
      return;
    }
  }

  // Novo saldo financeiro
  const novoSaldoFinanceiro = saldoAtual - valorDesconto;

  // Valor total dos itens extras (se houver)
  const totalExtras = _mens_itensExtras.reduce((s, i) => s + i.preco * i.qtd, 0);
  const valorFinalDescontado = valorDesconto + totalExtras;

  // Se houver extras, desconta também do saldo
  const novoSaldoFinal = saldoAtual - valorFinalDescontado;

  // Salvar entrega (sem quantidade, apenas valor)
  const { data: entrega, error: errEnt } = await supa
    .from('mensalista_entregas')
    .insert([{
      plano_id: planoId,
      cliente_id: p.cliente_id,
      produto_nome: p.produto_nome,
      quantidade: 0, // não usamos mais quantidade
      observacoes: obs || null,
      itens_extras: _mens_itensExtras.length > 0 ? _mens_itensExtras : null,
      valor_extras: totalExtras > 0 ? Math.round(totalExtras) : null,
      // Armazena o valor descontado principal
      valor_descontado: Math.round(valorDesconto),
    }])
    .select('id, created_at')
    .single();

  if (errEnt) {
    alert('Erro ao registrar entrega: ' + errEnt.message);
    return;
  }

  // Atualiza o plano: apenas o valor_restante
  const { error: errUp } = await supa
    .from('planos_mensalistas')
    .update({ valor_restante: Math.round(novoSaldoFinal) })
    .eq('id', planoId);

  if (errUp) {
    alert('Erro ao atualizar saldo: ' + errUp.message);
    return;
  }

  fecharModal('modal-mens-entrega');

  // Atualiza estado local
  p.valor_restante = Math.round(novoSaldoFinal);

  _mensRenderKPIs();
  mensRenderPlanos();

  const valorFmt = Math.round(valorFinalDescontado).toLocaleString('es-PY');
  const saldoFmt = Math.round(novoSaldoFinal).toLocaleString('es-PY');
  const linhasExtras = _mens_itensExtras.length > 0
    ? `\nItens extras: Gs ${Math.round(totalExtras).toLocaleString('es-PY')}`
    : '';

  // Limpa extras
  _mens_itensExtras = [];

  const imprimir = confirm(
    `✅ Desconto registrado!\nValor descontado: Gs ${valorFmt}\nNovo saldo: Gs ${saldoFmt}${linhasExtras}\n\nImprimir comprovante?`
  );

  if (imprimir) {
    mensImprimirComprovante(p, 0, obs, entrega?.id, entrega?.created_at, novoSaldoFinal, 'un', novoSaldoFinal, []);
  }
}

// ──────────────────────────────────────────────────────────────
//  IMPRIMIR COMPROVANTE
// ──────────────────────────────────────────────────────────────
function mensImprimirComprovante(plano, qtd, obs, entregaId, dataEntrega, saldoApos, tipo, valorRestante, itensExtras) {
  tipo = tipo || _mensGetTipo(plano);
  const cliente = plano.clientes || {};
  const dataFmt = dataEntrega
    ? new Date(dataEntrega).toLocaleString('es-PY', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : new Date().toLocaleString('es-PY', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const dataFim = plano.data_fim
    ? new Date(plano.data_fim + 'T12:00:00').toLocaleDateString('es-PY')
    : 'Indeterminado';

  // Valor descontado (vem da entrega, mas usamos o valor passado ou calculamos)
  const valorDescontado = Math.round(qtd); // qtd agora é o valor em Gs
  const valorRestanteFmt = (valorRestante != null ? Math.round(valorRestante) : 0).toLocaleString('es-PY');
  const valorPlanoBefore = Math.round(plano.valor_plano || 0);

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Comprobante Plan Mensual</title>
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
    <div class="med">COMPROBANTE PLAN MENSUAL</div>
    <div class="sm">${dataFmt}</div>
    ${entregaId ? `<div class="sm">Entrega #${entregaId}</div>` : ''}
  </div>
  <hr>
  <div class="row"><span>Cliente:</span><b>${cliente.nome || '—'}</b></div>
  <div class="row"><span>Tel:</span><b>${cliente.telefone || '—'}</b></div>
  <hr>
  <div class="row"><span>Plan / Item:</span><b>${plano.produto_nome}</b></div>
  <div class="row"><span>Valor descontado:</span><b>Gs ${valorDescontado.toLocaleString('es-PY')}</b></div>
  ${obs ? `<div class="row"><span>Obs:</span><span>${obs}</span></div>` : ''}
  ${(itensExtras && itensExtras.length > 0) ? `
  <hr>
  <div style="font-size:11px;font-weight:700;color:#374151;margin:4px 0 2px;text-transform:uppercase;letter-spacing:.4px">Ítems Adicionales</div>
  ${itensExtras.map(i => `
  <div class="row"><span>${i.nome} x${i.qtd}</span><b>Gs ${Math.round(i.preco * i.qtd).toLocaleString('es-PY')}</b></div>`).join('')}
  <div class="row" style="border-top:1px solid #e5e7eb;margin-top:3px;padding-top:4px">
    <span style="font-weight:700">Total adicional:</span>
    <b style="color:#1a7a2e">Gs ${Math.round(itensExtras.reduce((s,i)=>s+i.preco*i.qtd,0)).toLocaleString('es-PY')}</b>
  </div>` : ''}
  <div class="row"><span>Valor del plan:</span><b>Gs ${valorPlanoBefore.toLocaleString('es-PY')}</b></div>
  <div class="row"><span>Vencimiento:</span><b>${dataFim}</b></div>
  <hr>
  <div class="saldo-box">
    <div class="lab">SALDO RESTANTE</div>
    <div class="num">Gs ${valorRestanteFmt}</div>
  </div>
  <hr>
  <div class="assinatura">
    <div style="font-size:11px;color:#555;margin-bottom:16px">
      Confirmo que recibí los productos según mi plan mensual.
    </div>
    <div class="linha"></div>
    <div class="leg">Firma del cliente — ${cliente.nome || '_________________'}</div>
    <div class="leg" style="margin-top:8px">Fecha: ____/____/________</div>
  </div>
  <hr>
  <div class="center sm">*** GRACIAS ***</div>
</div>
<button class="btn-print" onclick="window.print()">🖨️ IMPRIMIR COMPROBANTE</button>
<script>setTimeout(()=>window.print(), 600);</script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=420,height=680,scrollbars=yes');
  if (win) {
    win.document.write(html);
    win.document.close();
  } else {
    alert('Popup bloqueado. Permita popups para este site para imprimir.');
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

  const nomeCliente = p.clientes?.nome || '';
  const telefone = (p.clientes?.telefone || '').replace(/\D/g, '');
  const saldoFmt = Math.round(p.valor_restante || 0).toLocaleString('es-PY');
  const dataFim = p.data_fim
    ? new Date(p.data_fim + 'T12:00:00').toLocaleDateString('es-PY')
    : null;
  const vencimento = dataFim ? `\nVencimento do plano: ${dataFim}` : '';
  const restaurante = _mens_nomeRestaurante || 'RESTAURANTE';

  // Mensagem base em português (será a preenchida no textarea)
  const msgBasePt = `Olá, *${nomeCliente}*! 👋\n\nPassando para avisar que o seu plano mensal de *${p.produto_nome}* está chegando ao fim.\n\n💰 Saldo restante: *Gs ${saldoFmt}*${vencimento}\n\nRenove para continuar aproveitando sem interrupção! 😊\n\n_${restaurante}_`;

  // Mensagem base em espanhol
  const msgBaseEs = `Hola, *${nomeCliente}*! 👋\n\nTe avisamos que tu plan mensual de *${p.produto_nome}* está llegando a su fin.\n\n💰 Saldo restante: *Gs ${saldoFmt}*${vencimento.replace('Vencimento', 'Vencimiento')}\n\n¡Renovalo para seguir disfrutando sin interrupciones! 😊\n\n_${restaurante}_`;

  // Modal com campo de edição de mensagem
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:24px;max-width:480px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.18)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-weight:700;font-size:1rem;color:#1a1a2e">💬 Personalizar mensagem</div>
        <button id="_wa_close" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:#999">✕</button>
      </div>
      <div style="font-size:0.82rem;color:#6b7280;margin-bottom:12px">
        Cliente: <strong>${nomeCliente}</strong> ${telefone ? '· 📱 ' + p.clientes.telefone : ''}
      </div>
      <div style="margin-bottom:10px">
        <label style="font-size:0.78rem;font-weight:600;color:#555;display:block;margin-bottom:4px">Mensagem (edite à vontade)</label>
        <textarea id="_wa_msg" rows="8" style="width:100%;padding:10px;border:1.5px solid #e0e0e0;border-radius:8px;font-size:0.88rem;font-family:inherit;resize:vertical;box-sizing:border-box;">${msgBasePt}</textarea>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
        <button id="_wa_pt" style="padding:6px 14px;background:#e8f4fd;color:#2980b9;border:1.5px solid #2980b9;border-radius:6px;cursor:pointer;font-weight:600;font-size:0.82rem">🇧🇷 Português</button>
        <button id="_wa_es" style="padding:6px 14px;background:#f0fdf4;color:#16a34a;border:1.5px solid #16a34a;border-radius:6px;cursor:pointer;font-weight:600;font-size:0.82rem">🇵🇾 Español</button>
        <span style="font-size:0.72rem;color:#888;align-self:center;margin-left:4px">(preenche com modelo)</span>
      </div>
      <div style="display:flex;gap:10px">
        <button id="_wa_cancel" style="flex:1;padding:10px;background:#f3f4f6;color:#374151;border:none;border-radius:10px;cursor:pointer;font-size:0.85rem;font-weight:600">Cancelar</button>
        <button id="_wa_send" style="flex:2;padding:10px;background:#25D366;color:#fff;border:none;border-radius:10px;cursor:pointer;font-size:0.85rem;font-weight:700">📤 Enviar WhatsApp</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  // Fechar
  overlay.querySelector('#_wa_close').onclick = () => overlay.remove();
  overlay.querySelector('#_wa_cancel').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  // Preencher com modelo em português
  overlay.querySelector('#_wa_pt').onclick = () => {
    document.getElementById('_wa_msg').value = msgBasePt;
  };

  // Preencher com modelo em espanhol
  overlay.querySelector('#_wa_es').onclick = () => {
    document.getElementById('_wa_msg').value = msgBaseEs;
  };

  // Enviar
  overlay.querySelector('#_wa_send').onclick = () => {
    const msg = document.getElementById('_wa_msg').value.trim();
    if (!msg) {
      alert('A mensagem não pode estar vazia.');
      return;
    }
    if (!telefone) {
      alert('⚠️ Este cliente não possui telefone cadastrado.');
      overlay.remove();
      return;
    }
    // Formata número: se começar com 0, substitui pelo DDI 595 (Paraguai)
    let num = telefone;
    if (num.startsWith('0')) num = '595' + num.substring(1);
    else if (!num.startsWith('595') && num.length <= 10) num = '595' + num;
    const url = `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
    overlay.remove();
  };
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
