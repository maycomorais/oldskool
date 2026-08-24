// ============================================================
//  MÓDULO: FACTURACIÓN ELECTRÓNICA (e-kuatia / SIFEN)
//  Arquivo: facturacion.js
//  Requer: supabaseClient.js
// ============================================================

// ──────────────────────────────────────────────────────────────
//  CONFIGURAÇÃO DO PROVEDOR
// ──────────────────────────────────────────────────────────────
const PROVEDOR = {
  provedor: 'SIFENDE',
  baseURL: 'https://api.sifende.com.py/v1',
  apiKey: '', // ← preencher com a chave do provedor
};

// ──────────────────────────────────────────────────────────────
//  ESTADO
// ──────────────────────────────────────────────────────────────
let _fact_config = null;
let _fact_documentos = [];
let _fact_produtos = []; // cardápio, usado só para popular o seletor de IVA por produto

// Config padrão — usada quando ainda não há nada salvo no banco.
// iva_default: alíquota aplicada a qualquer produto que não tenha um
// override específico em iva_produtos. '10' é o mais seguro como padrão,
// já que é a alíquota geral que cobre a maioria dos itens de um restaurante.
function _factConfigPadrao() {
  return {
    ruc: '',
    razao_social: '',
    nome_fantasia: '',
    endereco: '',
    telefone: '',
    email: '',
    atividade_economica: '',
    regime_tributario: 'general',
    ambiente: 'homologacao',
    provedor: PROVEDOR.provedor,
    api_key: PROVEDOR.apiKey,
    iva_default: '10',       // '10' | '5' | 'exento'
    iva_produtos: {},        // { "Nome do Produto": '10' | '5' | 'exento' }
  };
}

// ──────────────────────────────────────────────────────────────
//  INICIALIZAR — chamado ao abrir a aba "facturacion"
// ──────────────────────────────────────────────────────────────
async function initFacturacion() {
  console.log('[Facturación] initFacturacion chamado');
  try {
    await carregarConfigFacturacion();
    await carregarDocumentos();
    await _factCarregarProdutos();
    renderFacturacion();
    console.log('[Facturación] Inicialização concluída');
  } catch (err) {
    console.error('[Facturación] Erro na inicialização:', err);
    alert('Erro ao carregar dados de facturación. Verifique o console.');
  }
}

// Carrega o cardápio só para preencher o seletor de "IVA por Produto" —
// não depende de nenhum outro módulo (mensalistas, pdv, etc.).
async function _factCarregarProdutos() {
  const { data, error } = await supa
    .from('produtos')
    .select('id, nome, categoria_slug')
    .order('nome');
  if (error) {
    console.warn('[Facturación] Erro ao carregar produtos:', error);
    _fact_produtos = [];
    return;
  }
  _fact_produtos = data || [];
}

// ──────────────────────────────────────────────────────────────
//  CARREGAR CONFIGURAÇÕES DO BANCO
// ──────────────────────────────────────────────────────────────
async function carregarConfigFacturacion() {
  console.log('[Facturación] carregarConfigFacturacion');
  const { data, error } = await supa
    .from('configuracoes')
    .select('facturacion_config')
    .maybeSingle();

  if (error) {
    console.warn('[Facturación] Erro ao carregar config:', error);
    // Se a coluna não existir, cria um objeto vazio
    _fact_config = _factConfigPadrao();
    return;
  }

  // Se não houver dados, usa valores padrão. Se houver dados salvos ANTES
  // desta funcionalidade existir, garante que iva_default/iva_produtos
  // existam (senão fica undefined e quebra os cálculos).
  _fact_config = { ..._factConfigPadrao(), ...(data?.facturacion_config || {}) };
  if (!_fact_config.iva_produtos || typeof _fact_config.iva_produtos !== 'object') {
    _fact_config.iva_produtos = {};
  }
  console.log('[Facturación] Config carregada:', _fact_config);
}

// ──────────────────────────────────────────────────────────────
//  CARREGAR DOCUMENTOS EMITIDOS
// ──────────────────────────────────────────────────────────────
async function carregarDocumentos() {
  console.log('[Facturación] carregarDocumentos');
  const { data, error } = await supa
    .from('facturas')
    .select('*, pedidos(cliente_nome, total_geral)')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.warn('[Facturación] Erro ao carregar documentos:', error);
    _fact_documentos = [];
    return;
  }

  _fact_documentos = data || [];
  console.log(`[Facturación] ${_fact_documentos.length} documentos carregados`);
}

// ──────────────────────────────────────────────────────────────
//  RENDERIZAR TUDO
// ──────────────────────────────────────────────────────────────
function renderFacturacion() {
  console.log('[Facturación] renderFacturacion');
  
  // Verifica se os elementos existem antes de preencher
  const campos = [
    'fact-ruc', 'fact-razao', 'fact-fantasia', 'fact-endereco',
    'fact-telefone', 'fact-email', 'fact-atividade', 'fact-regime',
    'fact-ambiente'
  ];
  let elementosOK = true;
  campos.forEach(id => {
    if (!document.getElementById(id)) {
      console.warn(`[Facturación] Elemento #${id} não encontrado no DOM`);
      elementosOK = false;
    }
  });

  if (!elementosOK) {
    console.error('[Facturación] DOM incompleto — verifique o HTML');
    return;
  }

  // Preenche os campos com os valores atuais
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val ?? '';
  };

  setVal('fact-ruc', _fact_config.ruc);
  setVal('fact-razao', _fact_config.razao_social);
  setVal('fact-fantasia', _fact_config.nome_fantasia);
  setVal('fact-endereco', _fact_config.endereco);
  setVal('fact-telefone', _fact_config.telefone);
  setVal('fact-email', _fact_config.email);
  setVal('fact-atividade', _fact_config.atividade_economica);
  setVal('fact-regime', _fact_config.regime_tributario);
  setVal('fact-ambiente', _fact_config.ambiente);
  setVal('fact-api-key', _fact_config.api_key || _fact_config.provedor_api_key || '');
  setVal('fact-iva-default', _fact_config.iva_default || '10');

  // Renderiza a lista de documentos
  renderListaDocumentos();
  // Renderiza o seletor de produtos e a lista de IVA por produto
  renderFacturacionIva();
  console.log('[Facturación] renderFacturacion concluído');
}

// ──────────────────────────────────────────────────────────────
//  IVA POR PRODUTO
// ──────────────────────────────────────────────────────────────
// Alíquota de IVA para um item da factura: usa o override específico do
// produto (por nome, comparação sem diferenciar maiúsculas/espaços), e cai
// para o padrão configurado (iva_default) quando não há override.
function factGetIvaTipoProduto(nomeItem) {
  const nome = (nomeItem || '').trim().toLowerCase();
  const overrides = _fact_config?.iva_produtos || {};
  for (const key in overrides) {
    if (key.trim().toLowerCase() === nome) return overrides[key];
  }
  return _fact_config?.iva_default || '10';
}

// Converte o tipo ('10' | '5' | 'exento') na alíquota numérica
function factGetIvaRate(tipo) {
  if (tipo === '5') return 5;
  if (tipo === 'exento') return 0;
  return 10; // '10' ou qualquer valor não reconhecido cai no padrão geral
}

function renderFacturacionIva() {
  const selProd = document.getElementById('fact-iva-prod-sel');
  if (selProd) {
    const atual = selProd.value;
    selProd.innerHTML = '<option value="">— Selecione um produto —</option>' +
      _fact_produtos.map(p => `<option value="${p.nome.replace(/"/g, '&quot;')}">${p.nome}${p.categoria_slug ? ' · ' + p.categoria_slug : ''}</option>`).join('');
    if (atual) selProd.value = atual;
  }

  const tbody = document.getElementById('fact-iva-produtos-tbody');
  if (!tbody) return;

  const overrides = _fact_config?.iva_produtos || {};
  const nomes = Object.keys(overrides).sort((a, b) => a.localeCompare(b));

  if (!nomes.length) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:#aaa;padding:14px;">
      Nenhum produto com IVA específico. Tudo usa o padrão (${(_fact_config?.iva_default || '10') === 'exento' ? 'Exento' : (_fact_config.iva_default || '10') + '%'}).
    </td></tr>`;
    return;
  }

  const label = (tipo) => tipo === 'exento' ? 'Exento' : `${tipo}%`;

  tbody.innerHTML = nomes.map(nome => `
    <tr>
      <td>${nome}</td>
      <td>${label(overrides[nome])}</td>
      <td style="text-align:center">
        <button onclick="factRemoverIvaProduto('${nome.replace(/'/g, "\\'")}')"
          style="background:#fee2e2;color:#e74c3c;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:0.8rem">🗑️</button>
      </td>
    </tr>`).join('');
}

// Adiciona/atualiza o override de IVA de um produto e salva imediatamente
// (não depende do botão "Guardar Configuración" geral, para não perder a
// lista se o usuário esquecer de salvar).
async function factAdicionarIvaProduto() {
  const nome = document.getElementById('fact-iva-prod-sel')?.value || '';
  const tipo = document.getElementById('fact-iva-prod-valor')?.value || '10';

  if (!nome) {
    alert('Selecione um produto.');
    return;
  }

  if (!_fact_config.iva_produtos) _fact_config.iva_produtos = {};
  _fact_config.iva_produtos[nome] = tipo;

  await _factSalvarConfigCompleta();
  renderFacturacionIva();
}

async function factRemoverIvaProduto(nome) {
  if (!_fact_config?.iva_produtos) return;
  delete _fact_config.iva_produtos[nome];
  await _factSalvarConfigCompleta();
  renderFacturacionIva();
}

// Persiste o objeto _fact_config inteiro (usado pelos botões de
// adicionar/remover IVA por produto, que mexem direto no objeto em memória)
async function _factSalvarConfigCompleta() {
  const { error } = await supa
    .from('configuracoes')
    .update({ facturacion_config: _fact_config })
    .gt('id', 0);
  if (error) {
    alert('❌ Erro ao salvar IVA do produto: ' + error.message);
    console.error('[Facturación] Erro ao salvar iva_produtos:', error);
  }
}

// ──────────────────────────────────────────────────────────────
//  RENDERIZAR LISTA DE DOCUMENTOS
// ──────────────────────────────────────────────────────────────
function renderListaDocumentos() {
  const tbody = document.getElementById('fact-documentos-tbody');
  if (!tbody) {
    console.warn('[Facturación] #fact-documentos-tbody não encontrado');
    return;
  }

  if (!_fact_documentos || _fact_documentos.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#aaa;padding:20px;">
      Nenhum documento eletrônico emitido ainda.
    </td></tr>`;
    return;
  }

  tbody.innerHTML = _fact_documentos.map(doc => {
    const data = new Date(doc.created_at).toLocaleString('es-PY');
    const estado = doc.estado === 'aprovado' 
      ? '<span style="color:#27ae60;">✅ Aprovado</span>'
      : doc.estado === 'rejeitado'
        ? '<span style="color:#e74c3c;">❌ Rejeitado</span>'
        : '<span style="color:#f39c12;">⏳ Pendente</span>';

    return `<tr>
      <td>${doc.kude || 'N/A'}</td>
      <td>${data}</td>
      <td>${doc.pedidos?.cliente_nome || '—'}</td>
      <td>Gs ${(doc.pedidos?.total_geral || 0).toLocaleString('es-PY')}</td>
      <td>${estado}</td>
    </tr>`;
  }).join('');
}

// ──────────────────────────────────────────────────────────────
//  SALVAR CONFIGURAÇÕES
// ──────────────────────────────────────────────────────────────
async function salvarConfigFacturacion() {
  console.log('[Facturación] salvarConfigFacturacion');
  const getVal = (id) => document.getElementById(id)?.value?.trim() || '';

  const config = {
    ruc: getVal('fact-ruc'),
    razao_social: getVal('fact-razao'),
    nome_fantasia: getVal('fact-fantasia'),
    endereco: getVal('fact-endereco'),
    telefone: getVal('fact-telefone'),
    email: getVal('fact-email'),
    atividade_economica: getVal('fact-atividade'),
    regime_tributario: getVal('fact-regime') || 'general',
    ambiente: getVal('fact-ambiente') || 'homologacao',
    provedor: PROVEDOR.provedor,
    api_key: getVal('fact-api-key'),
    iva_default: getVal('fact-iva-default') || '10',
    // iva_produtos é gerenciado pelos botões de Adicionar/Remover (já fica
    // salvo em tempo real) — preserva o que já está em memória aqui.
    iva_produtos: _fact_config?.iva_produtos || {},
  };

  const { error } = await supa
    .from('configuracoes')
    .update({ facturacion_config: config })
    .gt('id', 0);

  if (error) {
    alert('❌ Erro ao salvar: ' + error.message);
    console.error('[Facturación] Erro no update:', error);
    return;
  }

  _fact_config = config;
  alert('✅ Configurações salvas com sucesso!');
  console.log('[Facturación] Config salva:', config);
}

// ──────────────────────────────────────────────────────────────
//  EMITIR FACTURA (via provedor API)
// ──────────────────────────────────────────────────────────────
async function emitirFactura(pedidoId, dadosCliente = null) {
  console.log('[Facturación] emitirFactura para pedido', pedidoId);
  if (!_fact_config?.ruc) {
    alert('⚠️ Configure os dados do contribuinte antes de emitir.');
    return null;
  }

  const { data: pedido, error } = await supa
    .from('pedidos')
    .select('*')
    .eq('id', pedidoId)
    .single();

  if (error || !pedido) {
    alert('Pedido não encontrado.');
    return null;
  }

  const { data: existente } = await supa
    .from('facturas')
    .select('id')
    .eq('pedido_id', pedidoId)
    .maybeSingle();

  if (existente) {
    alert('⚠️ Este pedido já possui uma factura emitida.');
    return null;
  }

  const payload = montarPayloadFactura(pedido, dadosCliente);

  try {
    const response = await fetch(`${PROVEDOR.baseURL}/factura`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${_fact_config.api_key || PROVEDOR.apiKey}`,
        'X-Ambiente': _fact_config.ambiente,
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.mensaje || 'Erro ao emitir factura');
    }

    const qrCodeData = result.qr_code || result.qr_code_url || null;
    const linkValidacao = result.link_validacao || null;

    await salvarFacturaNoBanco(pedidoId, {
      kude: result.kude || result.id || '',
      estado: result.estado || 'aprovado',
      xml: result.xml || '',
      qr_code: qrCodeData,
      link_validacao: linkValidacao,
      respuesta_dnit: result.respuesta || result,
    });

    alert(`✅ Factura emitida com sucesso!\nKUDE: ${result.kude || 'N/A'}`);
    carregarDocumentos();
    renderListaDocumentos();
    return result;
  } catch (err) {
    console.error('[Facturación] Erro ao emitir:', err);
    alert('❌ Erro ao emitir factura: ' + err.message);
    return null;
  }
}

// ──────────────────────────────────────────────────────────────
//  MONTAR PAYLOAD
// ──────────────────────────────────────────────────────────────
function montarPayloadFactura(pedido, dadosCliente) {
  const cliente = dadosCliente || {
    nome: pedido.cliente_nome || 'Consumidor Final',
    ruc: pedido.dados_factura?.ruc || '',
    email: pedido.dados_factura?.email || '',
    telefone: pedido.cliente_telefone || '',
    endereco: pedido.endereco_entrega || '',
  };

  // CORRIGIDO: antes cada item ia com "iva: 0" fixo (tudo tratado como
  // isento), o que não reflete a realidade — a maioria dos produtos tem
  // 10% ou 5% de IVA. Agora cada item usa o IVA configurado para aquele
  // produto (fact-iva-prod na aba Facturación), com o padrão geral (10%)
  // para qualquer produto ainda não classificado.
  //
  // Preço no cardápio é considerado "IVA incluído" (prática padrão no
  // Paraguay) — a base gravada e o valor do IVA são calculados por dentro:
  //   base_gravada = total / (1 + aliquota/100)
  //   monto_iva    = total - base_gravada
  const itens = (pedido.itens || []).map(item => {
    const nome = item.nome || item.n || 'Produto';
    const qtd = item.qtd || item.q || 1;
    const precoUnit = item.preco || item.p || 0;
    const total = precoUnit * qtd;

    const ivaTipo = factGetIvaTipoProduto(nome);
    const ivaRate = factGetIvaRate(ivaTipo);
    const baseGravada = ivaRate > 0 ? total / (1 + ivaRate / 100) : total;
    const montoIva = total - baseGravada;

    return {
      codigo: item.id || item.produto_id || '',
      descricao: nome,
      quantidade: qtd,
      precio_unitario: precoUnit,
      // Alíquota aplicada (10, 5 ou 0=exento) — CONFIRME o nome/formato
      // exato que o Sifende espera nesse campo assim que tiver acesso à
      // documentação da API deles; este é um formato genérico razoável.
      iva_tipo: ivaTipo === 'exento' ? 'exento' : 'gravado',
      iva_aliquota: ivaRate,
      base_gravada: Math.round(baseGravada),
      monto_iva: Math.round(montoIva),
      total: Math.round(total),
    };
  });

  const total = itens.reduce((acc, i) => acc + i.total, 0);

  // Resumo por alíquota — documentos fiscais paraguaios (DE do SIFEN)
  // exigem os totais discriminados por faixa de IVA (10%, 5%, exento), não
  // só o total geral. Calculado aqui para já deixar pronto.
  const resumoIva = { base_exenta: 0, base_5: 0, iva_5: 0, base_10: 0, iva_10: 0 };
  itens.forEach(i => {
    if (i.iva_aliquota === 5) {
      resumoIva.base_5 += i.base_gravada;
      resumoIva.iva_5 += i.monto_iva;
    } else if (i.iva_aliquota === 10) {
      resumoIva.base_10 += i.base_gravada;
      resumoIva.iva_10 += i.monto_iva;
    } else {
      resumoIva.base_exenta += i.base_gravada;
    }
  });

  return {
    tipo: 'factura',
    ruc_emisor: _fact_config.ruc,
    ruc_receptor: cliente.ruc || '0',
    razon_social_receptor: cliente.nome,
    email_receptor: cliente.email || '',
    telefono_receptor: cliente.telefone || '',
    direccion_receptor: cliente.endereco || '',
    items: itens,
    total: Math.round(total),
    resumen_iva: resumoIva,
    moneda: 'PYG',
    fecha: new Date().toISOString(),
    observaciones: `Pedido #${pedido.id} - ${pedido.uid_temporal || ''}`,
  };
}

// ──────────────────────────────────────────────────────────────
//  SALVAR FACTURA NO BANCO
// ──────────────────────────────────────────────────────────────
async function salvarFacturaNoBanco(pedidoId, resultado) {
  console.log('[Facturación] salvarFacturaNoBanco para pedido', pedidoId);
  const { error } = await supa.from('facturas').insert([{
    pedido_id: pedidoId,
    kude: resultado.kude || '',
    estado: resultado.estado || 'aprovado',
    xml: resultado.xml || '',
    qr_code: resultado.qr_code || null,
    link_validacao: resultado.link_validacao || null,
    respuesta_dnit: resultado.respuesta_dnit || null,
    created_at: new Date().toISOString(),
  }]);

  if (error) {
    console.warn('[Facturación] Erro ao salvar factura no banco:', error);
  }
}

// ──────────────────────────────────────────────────────────────
//  EMITIR FACTURA A PARTIR DE UM PEDIDO EXISTENTE (via botão)
// ──────────────────────────────────────────────────────────────
async function emitirFacturaDoPedido(pedidoId) {
  if (!pedidoId || isNaN(pedidoId)) {
    alert('Digite um número de pedido válido.');
    return;
  }
  if (!confirm('Emitir factura electrónica para este pedido?')) return;
  await emitirFactura(pedidoId);
}

// ──────────────────────────────────────────────────────────────
//  CONSULTAR STATUS DE UMA FACTURA
// ──────────────────────────────────────────────────────────────
async function consultarStatusFactura(kude) {
  try {
    const response = await fetch(`${PROVEDOR.baseURL}/consulta/${kude}`, {
      headers: {
        'Authorization': `Bearer ${_fact_config?.api_key || PROVEDOR.apiKey}`,
      },
    });
    const result = await response.json();
    alert(`📄 Status da factura ${kude}:\n${JSON.stringify(result, null, 2)}`);
    return result;
  } catch (err) {
    alert('Erro ao consultar: ' + err.message);
  }
}