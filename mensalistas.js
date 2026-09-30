// ══════════════════════════════════════════════════════════════
//  MÓDULO MENSALISTAS — Somente VALOR em Gs
//  Arquivo: mensalistas.js  |  Requer: supabaseClient.js
// ══════════════════════════════════════════════════════════════

let _mens_planos          = [];
let _mens_clientes        = [];
let _mens_produtos        = [];
let _mens_nomeRestaurante = '';

// ─── INIT ─────────────────────────────────────────────────────
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

// ─── CARREGAR PLANOS ──────────────────────────────────────────
async function mensCarregarPlanos() {
  const loading = document.getElementById('mens-loading');
  if (loading) loading.style.display = 'flex';

  try {
    let { data, error } = await supa
      .from('planos_mensalistas')
      .select('*, clientes(id, nome, telefone)')
      .eq('excluido', false)
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('[Mensalistas] Filtro "excluido" indisponível, tentando sem ele:', error.message);
      const r2 = await supa
        .from('planos_mensalistas')
        .select('*, clientes(id, nome, telefone)')
        .order('created_at', { ascending: false });
      data = r2.data;
      error = r2.error;
    }

    if (error) { console.warn('[Mensalistas] mensCarregarPlanos:', error.message); return; }
    _mens_planos = data || [];
    _mensRenderKPIs();
    mensRenderPlanos();
  } catch(e) {
    console.warn('[Mensalistas] mensCarregarPlanos:', e.message);
  } finally {
    if (loading) loading.style.display = 'none';
  }
}

// ─── KPIs ─────────────────────────────────────────────────────
function _mensRenderKPIs() {
  const total      = _mens_planos.length;
  const ativos     = _mens_planos.filter(p => p.ativo).length;
  const receita    = _mens_planos.reduce((s, p) => s + (Number(p.valor_plano) || 0), 0);
  const saldoTotal = _mens_planos.reduce((s, p) => s + Math.max(0, Number(p.valor_restante) || 0), 0);

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('mens-kpi-total',   total);
  set('mens-kpi-ativos',  ativos);
  set('mens-kpi-receita', `Gs ${Math.round(receita).toLocaleString('es-PY')}`);
  set('mens-kpi-itens',   `Gs ${Math.round(saldoTotal).toLocaleString('es-PY')}`);
}

// ─── RENDER PLANOS ────────────────────────────────────────────
function mensRenderPlanos() {
  const cont = document.getElementById('mens-lista-planos');
  if (!cont) return;

  const filtro = (document.getElementById('mens-filtro-status')?.value || 'todos');
  const busca  = (document.getElementById('mens-busca')?.value || '').toLowerCase().trim();

  let planos = _mens_planos.filter(p => {
    if (filtro === 'ativo'   && !p.ativo) return false;
    if (filtro === 'inativo' &&  p.ativo) return false;
    if (busca) {
      const nome    = (p.clientes?.nome || '').toLowerCase();
      const tel     = (p.clientes?.telefone || '').toLowerCase();
      const produto = (p.produto_nome || '').toLowerCase();
      if (!nome.includes(busca) && !tel.includes(busca) && !produto.includes(busca)) return false;
    }
    return true;
  });

  if (!planos.length) {
    cont.innerHTML = `<div style="text-align:center;color:#aaa;padding:40px">
      ${typeof t === 'function' ? t('mens.nenhum_plano', 'Nenhum plano mensal registrado ainda.') : 'Nenhum plano mensal registrado ainda.'}
    </div>`;
    return;
  }

  cont.innerHTML = planos.map(p => {
    const valorPlano    = Number(p.valor_plano)    || 0;
    const valorRestante = Number(p.valor_restante) || 0;
    const saldoNegativo = valorRestante < 0;
    const pct = valorPlano > 0
      ? Math.max(0, Math.min(100, Math.round((valorRestante / valorPlano) * 100)))
      : 0;
    const barColor = saldoNegativo
      ? '#e74c3c'
      : pct > 50 ? '#1a7a2e' : pct > 20 ? '#f39c12' : '#e74c3c';
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
            ${p.produto_nome ? `<div style="font-weight:600;font-size:0.85rem;margin-top:4px;color:#555">📋 ${p.produto_nome}</div>` : ''}
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
            <span style="color:#555">
              Saldo:
              <b style="color:${saldoNegativo ? '#e74c3c' : '#111'}">Gs ${valorRestante.toLocaleString('es-PY')}</b>
              ${saldoNegativo ? '<span style="font-size:0.7rem;font-weight:800;color:#e74c3c;margin-left:6px;background:#fee2e2;padding:2px 6px;border-radius:6px;">🔴 DÉBITO</span>' : ''}
            </span>
            <span style="color:${barColor};font-weight:700">${pct}%</span>
          </div>
          <div style="background:#f0f0f0;border-radius:6px;height:9px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${barColor};border-radius:6px;transition:width 0.4s"></div>
          </div>
        </div>

        <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap">
          ${esgotado || !p.ativo || vencendo ? `
          <button onclick="mensAbrirModalRenovacao(${p.id})"
            style="flex:2;padding:9px;background:#2980b9;color:#fff;border:none;border-radius:9px;cursor:pointer;font-size:0.83rem;font-weight:700;min-width:130px">
            🔄 Renovar Plano
          </button>` : ''}
          <button onclick="mensAbrirModalPlano(${p.id})"
            style="flex:1;padding:9px;background:#3498db;color:#fff;border:none;border-radius:9px;cursor:pointer;font-size:0.83rem;font-weight:600;min-width:70px"
            title="Editar plano">✏️</button>
          <button onclick="mensVerHistorico(${p.id})"
            style="flex:1;padding:9px;background:#0891b2;color:#fff;border:none;border-radius:9px;cursor:pointer;font-size:0.83rem;font-weight:600;min-width:70px"
            title="Histórico de descontos">🕓</button>
          <button onclick="mensEnviarWhatsAppAviso(${p.id})"
            style="flex:0 0 40px;padding:9px;background:#dcfce7;color:#25d366;border:none;border-radius:9px;cursor:pointer;font-size:0.9rem;font-weight:700"
            title="Avisar cliente pelo WhatsApp">💬</button>
          <button onclick="mensExcluirPlano(${p.id})"
            style="flex:0 0 40px;padding:9px;background:#fee2e2;color:#e74c3c;border:none;border-radius:9px;cursor:pointer;font-size:0.9rem;font-weight:700"
            title="Excluir plano">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

// ─── MODAL CRIAR / EDITAR / RENOVAR ───────────────────────────
function mensAbrirModalPlano(id = null, renovacao = false) {
  const p = id ? _mens_planos.find(p => p.id === id) : null;

  const _mset = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val; };
  _mset('mens-plano-id',        p?.id || '');
  _mset('mens-plano-cli-id',    p?.cliente_id || '');
  _mset('mens-plano-renovacao', renovacao ? '1' : '');
  _mset('mens-plano-produto',   p?.produto_nome || '');
  _mset('mens-plano-valor',     p?.valor_plano || '');
  _mset('mens-plano-ini',       renovacao ? new Date().toISOString().split('T')[0] : (p?.data_inicio || new Date().toISOString().split('T')[0]));
  _mset('mens-plano-fim',       renovacao ? '' : (p?.data_fim || ''));
  _mset('mens-plano-nota',      p?.obs || '');

  // Oculta blocos legados de quantidade / tipo (caso existam no HTML)
  ['mens-plano-qtd', 'mens-plano-tipo'].forEach(elId => {
    const el = document.getElementById(elId);
    if (!el) return;
    const wrapper = el.closest('.form-group') || el.parentElement;
    if (wrapper) wrapper.style.display = 'none';
  });
  const lblQtd = document.getElementById('mens-plano-qtd-label');
  if (lblQtd) {
    const w = lblQtd.closest('.form-group');
    if (w) w.style.display = 'none';
  }

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


  const titulo    = document.getElementById('mens-plano-titulo');
  const btnSalvar = document.getElementById('mens-plano-btn-salvar');
  const infoRenov = document.getElementById('mens-renov-info');

  if (renovacao && p) {
    const saldoAtual = Number(p.valor_restante || 0);
    const sinal = saldoAtual < 0 ? 'descontado' : 'somado';
    if (titulo)    titulo.innerHTML    = '🔄 Renovar Plano';
    if (btnSalvar) btnSalvar.innerHTML = '🔄 Renovar e Cobrar';
    if (infoRenov) {
      infoRenov.style.display = 'block';
      infoRenov.innerHTML = `
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;font-size:0.82rem;color:#1e40af;margin-bottom:14px">
          🔄 <b>Renovando o plano de ${p.clientes?.nome || ''}.</b><br>
          Saldo atual: <b>Gs ${saldoAtual.toLocaleString('es-PY')}</b> — será <b>${sinal}</b> ao novo valor contratado.
        </div>`;
    }
  } else if (p) {
    if (titulo)    titulo.innerHTML    = '✏️ Editar Plano';
    if (btnSalvar) btnSalvar.innerHTML = 'Salvar Plano';
    if (infoRenov) {
      infoRenov.style.display = 'block';
      infoRenov.innerHTML = `
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;font-size:0.82rem;color:#1e40af;margin-bottom:14px">
          Ajuste manual: ao modificar o valor do plano, o saldo restante é recalculado proporcionalmente.<br>
          Saldo atual: <b>Gs ${Number(p.valor_restante || 0).toLocaleString('es-PY')}</b>
        </div>`;
    }
  } else {
    if (titulo)    titulo.innerHTML    = '📋 Plano Mensalista';
    if (btnSalvar) btnSalvar.innerHTML = 'Salvar Plano';
    if (infoRenov) infoRenov.style.display = 'none';
  }

  const _mmp = document.getElementById('modal-mens-plano');
  if (_mmp) _mmp.style.display = 'flex';
  setTimeout(() => document.getElementById('mens-plano-cli-sel')?.focus(), 100);
}

function mensAbrirModalRenovacao(id) { if (id) mensAbrirModalPlano(id, true); }

// ─── SALVAR PLANO ─────────────────────────────────────────────
async function mensSalvarPlano() {
  const id           = document.getElementById('mens-plano-id').value;
  const cliente_id   = parseInt(document.getElementById('mens-plano-cli-id').value) || null;
  const produto_nome = document.getElementById('mens-plano-produto')?.value?.trim() || 'Plano mensal';
  const obs          = document.getElementById('mens-plano-nota')?.value.trim() || '';
  const valor        = parseFloat(document.getElementById('mens-plano-valor').value) || 0;
  const data_ini     = document.getElementById('mens-plano-ini').value || null;
  const data_fim     = document.getElementById('mens-plano-fim').value || null;
  const ativo        = document.getElementById('mens-plano-ativo')?.checked ?? true;
  const renovacao    = document.getElementById('mens-plano-renovacao')?.value === '1';
  const planoAtual   = id ? _mens_planos.find(p => p.id == id) : null;

  if (!cliente_id) { alert('Selecione o cliente.'); return; }
  if (valor <= 0)  { alert('Insira o valor do plano.'); return; }

  if (!id) {
    const jaExiste = _mens_planos.find(p =>
      p.ativo && p.cliente_id === cliente_id &&
      (p.produto_nome || '').trim().toLowerCase() === produto_nome.toLowerCase()
    );
    if (jaExiste) {
      alert(`Este cliente já tem um plano ativo de "${produto_nome}". Use "Renovar" em vez de criar um novo.`);
      return;
    }
  }

  const valorACobrar = renovacao
    ? valor
    : (planoAtual ? Math.max(0, valor - Number(planoAtual.valor_plano || 0)) : valor);

  let formaPag = null;
  if (valorACobrar > 0) {
    if (!_sessaoCaixaAtiva) { alert('⚠️ Abra o caixa antes de registrar o pagamento.'); return; }
    formaPag = await _notasModalFormaPagamento();
    if (!formaPag) return;
  }

  const payload = {
    cliente_id,
    produto_nome,
    quantidade_total:    0,
    quantidade_restante: 0,
    valor_plano:         valor,
    data_inicio:         data_ini,
    data_fim,
    ativo,
    obs,
  };

  let error;
  if (id && renovacao) {
    let saldoAnterior = Number(planoAtual?.valor_restante || 0);
    const { data: live } = await supa
      .from('planos_mensalistas').select('valor_restante').eq('id', id).maybeSingle();
    if (live) saldoAnterior = Number(live.valor_restante || 0);

    payload.valor_restante = valor + saldoAnterior;
    ({ error } = await supa.from('planos_mensalistas').update(payload).eq('id', id));

    if (!error) {
      await supa.from('mensalista_renovacoes').insert([{
        plano_id: id,
        saldo_anterior: saldoAnterior,
        valor_renovado: valor,
        valor_restante_novo: payload.valor_restante,
        data_inicio_anterior: planoAtual?.data_inicio || null,
        data_fim_anterior:    planoAtual?.data_fim || null,
        usuario_email: document.getElementById('user-email')?.innerText || 'admin',
      }]).then(() => {}).catch(() => {});
    }
  } else if (id) {
    if (planoAtual && valor !== Number(planoAtual.valor_plano)) {
      const pct = Number(planoAtual.valor_restante || 0) / (Number(planoAtual.valor_plano) || 1);
      payload.valor_restante = Math.round(valor * pct);
    } else if (planoAtual) {
      payload.valor_restante = Number(planoAtual.valor_restante || 0);
    }
    ({ error } = await supa.from('planos_mensalistas').update(payload).eq('id', id));
  } else {
    payload.valor_restante = valor;
    ({ error } = await supa.from('planos_mensalistas').insert([payload]));
  }

  if (error) { alert('Erro ao salvar: ' + error.message); return; }

  if (valorACobrar > 0 && formaPag) {
    const nomeCliente = _mens_clientes.find(c => c.id === cliente_id)?.nome || 'Cliente';
    await registrarMovimentacaoCaixa({
      tipo: 'entrada',
      valor: valorACobrar,
      descricao: `${renovacao ? 'Renovação' : (planoAtual ? 'Reforço' : 'Novo plano')} — ${produto_nome} (${nomeCliente})`,
      usuario_email: document.getElementById('user-email')?.innerText || 'admin',
      sessao_id: _sessaoCaixaAtiva.id,
      forma_pagamento: formaPag,
    });
  }

  fecharModal('modal-mens-plano');
  mensCarregarPlanos();
}

// ─── HISTÓRICO DE DESCONTOS ───────────────────────────────────
async function mensVerHistorico(planoId) {
  const p = _mens_planos.find(p => p.id === planoId);
  if (!p) return;

  const { data, error } = await supa
    .from('mensalista_entregas')
    .select('*')
    .eq('plano_id', planoId)
    .order('created_at', { ascending: false });

  if (error) { alert('Erro ao buscar histórico: ' + error.message); return; }

  const lista = (data || []).map(e => {
    const valor = Number(e.valor_descontado || e.valor_extras || 0);
    const dataFmt = new Date(e.created_at).toLocaleString('es-PY', {
      day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'
    });
    return `<div style="background:#fff;border:1.5px solid #eef0f2;border-left:4px solid #1a7a2e;border-radius:10px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;gap:10px">
      <div style="font-size:0.8rem;color:#6b7280">${dataFmt}</div>
      <div style="font-weight:800;color:#1a7a2e">Gs ${Math.round(valor).toLocaleString('es-PY')}</div>
      <div style="font-size:0.74rem;color:#9ca3af;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e.observacoes || ''}</div>
    </div>`;
  }).join('') || `<div style="text-align:center;color:#aaa;padding:30px">Nenhum desconto registrado ainda.</div>`;

  const modalBody = document.querySelector('#modal-mens-hist .modal-body') || document.querySelector('#modal-mens-hist > div > div');
  const html = `
    <div style="display:flex;flex-direction:column;width:100%;max-height:74vh">
      <div style="padding-bottom:14px;margin-bottom:14px;border-bottom:1.5px solid #f0f0f0">
        <div style="font-weight:800;font-size:1.05rem;color:#1a1a2e">🕓 Histórico de Descontos</div>
        <div style="font-size:0.85rem;color:#6b7280;margin-top:2px">${p.clientes?.nome || '—'} · ${p.produto_nome || 'Plano'}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <div style="background:#f9fafb;border:1px solid #eef0f2;border-radius:10px;padding:10px 14px;flex:1;min-width:130px">
            <div style="font-size:0.72rem;color:#8a8f98;font-weight:600;text-transform:uppercase">Valor do plano</div>
            <div style="font-size:1.05rem;font-weight:800;color:#1a1a2e;margin-top:2px">Gs ${Number(p.valor_plano || 0).toLocaleString('es-PY')}</div>
          </div>
          <div style="background:#f9fafb;border:1px solid #eef0f2;border-radius:10px;padding:10px 14px;flex:1;min-width:130px">
            <div style="font-size:0.72rem;color:#8a8f98;font-weight:600;text-transform:uppercase">Saldo atual</div>
            <div style="font-size:1.05rem;font-weight:800;color:${Number(p.valor_restante||0) < 0 ? '#e74c3c' : '#1a7a2e'};margin-top:2px">Gs ${Number(p.valor_restante || 0).toLocaleString('es-PY')}</div>
          </div>
        </div>
      </div>
      <div style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:9px;padding-right:4px">${lista}</div>
    </div>`;
  if (modalBody) modalBody.innerHTML = html;
  const _mmh = document.getElementById('modal-mens-hist');
  if (_mmh) {
    _mmh.style.cssText += ';position:fixed!important;top:0;left:0;width:100%;height:100%;z-index:9999;';
    _mmh.style.display = 'flex';
  }
}

// ─── EXCLUIR / ARQUIVAR ───────────────────────────────────────
async function mensExcluirPlano(id) {
  let qtd = 0;
  try {
    const { count } = await supa.from('mensalista_entregas')
      .select('id', { count: 'exact', head: true }).eq('plano_id', id);
    qtd = count || 0;
  } catch (_) {}

  if (qtd > 0) {
    if (!confirm(`Este plano tem ${qtd} registro(s) de consumo. Será ARQUIVADO (não excluído) para preservar o histórico. Continuar?`)) return;
    const { error } = await supa.from('planos_mensalistas')
      .update({ ativo: false, excluido: true }).eq('id', id);
    if (error) { alert('Erro ao arquivar: ' + error.message); return; }
  } else {
    if (!confirm('Excluir este plano? Não há histórico de consumo vinculado.')) return;
    const { error } = await supa.from('planos_mensalistas').delete().eq('id', id);
    if (error) { alert('Erro ao excluir: ' + error.message); return; }
  }
  await initMensalistas();
}

function mensFiltrar() { mensRenderPlanos(); }

// ─── WHATSAPP ─────────────────────────────────────────────────
async function mensEnviarWhatsAppAviso(planoId) {
  const p = _mens_planos.find(p => p.id === planoId);
  if (!p) return;
  const tel   = (p.clientes?.telefone || '').replace(/\D/g, '');
  const nome  = p.clientes?.nome || 'Cliente';
  const saldo = Math.round(Number(p.valor_restante || 0));
  const msg   = `Olá *${nome}*, seu saldo no plano *${p.produto_nome || 'mensalista'}* é *Gs ${saldo.toLocaleString('es-PY')}*. Obrigado! — ${_mens_nomeRestaurante}`;
  if (!tel) { alert('Cliente sem telefone cadastrado.'); return; }
  let num = tel.startsWith('0') ? '595' + tel.substring(1) : (tel.length <= 10 ? '595' + tel : tel);
  window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, '_blank');
}