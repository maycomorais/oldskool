// ══════════════════════════════════════════════════════════════
//  ESTATÍSTICAS DE VENDAS
//  Arquivo: estatisticas.js  |  Requer: supabaseClient.js
// ══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
//  Estado
// ──────────────────────────────────────────────────────────────
let _est_pedidos      = [];
let _est_produtos     = [];   // [{id, nome, categoria_slug, ...}]
let _est_fichas       = [];   // fichas técnicas com markup
let _est_filtCat      = '';
let _est_filtUnidade  = '';   // '' | 'un' | 'kg'
let _est_chartInst    = null;

// ──────────────────────────────────────────────────────────────
//  INIT — chamado por showTab('estatisticas')
// ──────────────────────────────────────────────────────────────
async function initEstatisticas() {
  // Define período padrão (mês atual)
  const hoje = new Date();
  const ini  = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const fmt  = d => d.toISOString().split('T')[0];

  const elIni = document.getElementById('est-ini');
  const elFim = document.getElementById('est-fim');
  if (elIni && !elIni.value) elIni.value = fmt(ini);
  if (elFim && !elFim.value) elFim.value = fmt(hoje);

  // Carrega referências uma vez
  await Promise.all([_estCarregarProdutos(), _estCarregarFichas()]);
  await gerarEstatisticas();
}

async function _estCarregarProdutos() {
  const { data } = await supa.from('produtos').select('id, nome, categoria_slug, unidade_venda');
  _est_produtos = data || [];
}

async function _estCarregarFichas() {
  const { data } = await supa
    .from('fichas_tecnicas')
    .select('produto_nome, markup_percent, ficha_itens(quantidade, insumos(preco_custo))');
  _est_fichas = data || [];
}

// ============================================================
//  ESTATÍSTICAS — usando helper global _obterPeriodoFinanceiro()
// ============================================================
async function gerarEstatisticas() {
  _estSetLoading(true);

  // 1. Obtém período via helper global
  const { utcInicio, utcFim } = await window._obterPeriodoFinanceiro();

  // Atualiza os campos de data para exibição (se vazios)
  const elIni = document.getElementById('est-ini');
  const elFim = document.getElementById('est-fim');
  if (elIni && !elIni.value) {
    const _tz = 3 * 60 * 60 * 1000;
    elIni.value = new Date(new Date(utcInicio).getTime() - _tz).toISOString().split('T')[0];
  }
  if (elFim && !elFim.value) {
    const _tz = 3 * 60 * 60 * 1000;
    elFim.value = new Date(new Date(utcFim).getTime() - _tz).toISOString().split('T')[0];
  }

  // 2. Busca pedidos com critérios unificados
  const { data, error } = await supa
    .from('pedidos')
    .select('id, itens, total_geral, subtotal, desconto_cupom, desconto_pdv_valor, created_at, status, forma_pagamento, obs_pagamento, tipo_entrega')
    .in('status', ['entregue', 'em_preparo', 'pronto_entrega', 'saiu_entrega'])
    .gte('created_at', utcInicio)
    .lte('created_at', utcFim);

  if (error) {
    console.error('gerarEstatisticas:', error);
    _estSetLoading(false);
    return;
  }

  // Filtra NaNota não quitado e Mensalista
  const pedsFiltrados = (data || []).filter((p) => {
    const pag = (p.forma_pagamento || "").toLowerCase();
    const isNaNota = pag === "nanota";
    const isQuitado = (p.obs_pagamento || "").toLowerCase().includes("[quitado");
    if ((isNaNota && !isQuitado) || pag === "mensalista") return false;
    return true;
  });

  _est_pedidos = pedsFiltrados;
  _estRender();
  _estSetLoading(false);
}

// ──────────────────────────────────────────────────────────────
//  RENDERIZAÇÃO
// ──────────────────────────────────────────────────────────────
function _estRender() {
  const filtCat     = (document.getElementById('est-filtro-cat')?.value   || '').toLowerCase().trim();
  const filtUnidade = (document.getElementById('est-filtro-unidade')?.value || '');

  // ── Mapa nome→categoria para lookup (ignora variação) ──
  const mapCat = {};
  _est_produtos.forEach(p => {
    mapCat[(p.nome || '').toLowerCase()] = {
      categoria: p.categoria_slug || '',
      unidade:   p.unidade_venda  || 'un',
    };
  });

  // ── Agrega itens de todos os pedidos, usando chave composta: nome|variação ──
  const agrupado = {};

  _est_pedidos.forEach(pedido => {
    const itens = Array.isArray(pedido.itens) ? pedido.itens : [];
    itens.forEach(item => {
      const nome      = item.nome || item.n || 'Desconhecido';
      const variacao  = item.variacao || item.t || '';
      const chave     = variacao ? `${nome}|${variacao}` : nome;

      const isKg     = item._isKg || item.peso_gramas > 0;
      const qtd      = isKg ? 0 : (item.qtd || item.q || 1);
      const pesoG    = isKg ? (item.peso_gramas || 0) : 0;
      const preco    = parseFloat(item.preco || item.p || 0);
      const total    = isKg ? preco : preco * qtd;

      const refProd  = mapCat[nome.toLowerCase()] || {};
      const categoria = refProd.categoria || '';
      const unidade   = isKg ? 'kg' : (refProd.unidade || 'un');

      // ── Filtros ──
      if (filtCat && !categoria.toLowerCase().includes(filtCat)) return;
      if (filtUnidade === 'kg' && !isKg) return;
      if (filtUnidade === 'un' && isKg) return;

      if (!agrupado[chave]) {
        agrupado[chave] = {
          nome,
          variacao,
          categoria,
          unidade,
          qtd: 0,
          pesoG: 0,
          faturamento: 0,
        };
      }
      agrupado[chave].qtd        += qtd;
      agrupado[chave].pesoG      += pesoG;
      agrupado[chave].faturamento += total;
    });
  });

  const produtos = Object.values(agrupado);

  // ── KPIs: apenas entradas financeiras (faturamento) ──
  const faturamentoTotal = _est_pedidos.reduce((s, p) => s + (p.total_geral || 0), 0);
  const ticketMedio      = _est_pedidos.length ? faturamentoTotal / _est_pedidos.length : 0;
  const totalPedidos     = _est_pedidos.length;

  // Atualiza os cards
  _estSetKPI('est-kpi-faturamento', `Gs ${Math.round(faturamentoTotal).toLocaleString('es-PY')}`);
  _estSetKPI('est-kpi-ticket',      `Gs ${Math.round(ticketMedio).toLocaleString('es-PY')}`);
  _estSetKPI('est-kpi-pedidos',     totalPedidos.toLocaleString('es-PY'));
  _estSetKPI('est-kpi-entradas',    `Gs ${Math.round(faturamentoTotal).toLocaleString('es-PY')}`);

  // Oculta o card de lucro (já que não é mais usado)
  const lucroCard = document.getElementById('est-kpi-lucro');
  if (lucroCard) lucroCard.parentElement.style.display = 'none';

  // ── Tabela de produtos (com variação) ──
  _estRenderTabela(produtos);

  // ── Gráfico de barras (top 15 por faturamento) ──
  _estRenderGrafico(produtos);
}

function _estSetKPI(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function _estRenderTabela(produtos) {
  const tbody = document.getElementById('est-tabela-body');
  if (!tbody) return;

  if (!produtos.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#aaa;padding:20px">Ningún dato en el período</td></tr>';
    return;
  }

  // Ordena alfabeticamente pelo nome completo (nome + variação)
  const sorted = [...produtos].sort((a, b) => {
    const nomeA = a.variacao ? `${a.nome} (${a.variacao})` : a.nome;
    const nomeB = b.variacao ? `${b.nome} (${b.variacao})` : b.nome;
    return nomeA.localeCompare(nomeB);
  });

  tbody.innerHTML = sorted.map(p => {
    const nomeExib = p.variacao ? `${p.nome} (${p.variacao})` : p.nome;
    const qtdExib = p.unidade === 'kg'
      ? (p.pesoG >= 1000
          ? `${(p.pesoG / 1000).toFixed(2)} kg`
          : `${p.pesoG} g`)
      : `${p.qtd} un`;

    const ficha = _est_fichas.find(f => f.produto_nome.toLowerCase() === p.nome.toLowerCase());
    const markupExib = ficha ? `${ficha.markup_percent}%` : '—';

    return `
      <tr>
        <td style="font-weight:600">${nomeExib}</td>
        <td style="color:#666;font-size:0.83rem">${p.categoria || '—'}</td>
        <td style="text-align:center;font-weight:700">${qtdExib}</td>
        <td style="text-align:center;font-size:0.83rem;color:#2980b9">${markupExib}</td>
        <td style="text-align:right;font-weight:700;color:#1a7a2e">
          Gs ${Math.round(p.faturamento).toLocaleString('es-PY')}
        </td>
      </tr>`;
  }).join('');
}

function _estRenderGrafico(produtos) {
  const canvas = document.getElementById('est-grafico');
  if (!canvas || typeof Chart === 'undefined') return;

  if (_est_chartInst) { _est_chartInst.destroy(); _est_chartInst = null; }

  // Top 15 por faturamento, com nome + variação
  const top = [...produtos]
    .sort((a, b) => b.faturamento - a.faturamento)
    .slice(0, 15);

  const labels = top.map(p => p.variacao ? `${p.nome} (${p.variacao})` : p.nome);

  _est_chartInst = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Faturamento (Gs)',
        data:  top.map(p => Math.round(p.faturamento)),
        backgroundColor: '#1a7a2e',
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `Gs ${ctx.parsed.y.toLocaleString('es-PY')}`,
          },
        },
      },
      scales: {
        x: { ticks: { maxRotation: 45, font: { size: 11 } } },
        y: {
          beginAtZero: true,
          ticks: { callback: v => 'Gs ' + v.toLocaleString('es-PY') },
        },
      },
    },
  });
}

function _estSetLoading(on) {
  const el = document.getElementById('est-loading');
  if (el) el.style.display = on ? 'flex' : 'none';
}

// ──────────────────────────────────────────────────────────────
//  Popular filtro de categorias
// ──────────────────────────────────────────────────────────────
async function _estPopularCategorias() {
  const { data } = await supa.from('categorias').select('slug, nome').order('nome');
  const sel = document.getElementById('est-filtro-cat');
  if (!sel || !data) return;
  sel.innerHTML = '<option value="">Todas las categorías</option>' +
    data.map(c => `<option value="${c.slug}">${c.nome}</option>`).join('');
}

// Chamado quando muda filtro sem recarregar do banco
function estAplicarFiltros() {
  _estRender();
}