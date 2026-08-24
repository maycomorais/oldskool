// subscriptionDateUtils.js
// Utilitários puros de data para controle de assinatura.
// Sem dependências externas — apenas matemática de calendário.
//
// ── ALTERAÇÕES NESTA REVISÃO ─────────────────────────────────
// 1. Novo helper calcularNovaLiberacao() — calcula a data de
//    liberação temporária (+1 dia) usada pelo botão "Liberar +1 dia".
// 2. calcularStatusAssinatura() ganhou o status 'liberado_manual',
//    checado ANTES de qualquer verificação de bloqueio — ou seja,
//    a liberação temporária tem prioridade sobre bloqueio manual
//    E automático, exatamente como um "passe livre" deveria funcionar.
// Requer migração SQL (rodar uma vez no Supabase):
//   ALTER TABLE assinaturas ADD COLUMN IF NOT EXISTS liberado_ate DATE;
//   ALTER TABLE assinaturas ADD COLUMN IF NOT EXISTS liberado_por TEXT;

'use strict';

// ─────────────────────────────────────────────────────────────
// 1. HORA DO SERVIDOR (anti-tamper)
// ─────────────────────────────────────────────────────────────

/**
 * Busca a data atual do servidor via Edge Function.
 * Fallback em cascata: Edge Function → API pública → relógio local.
 * @param {string} supabaseUrl  — ex: 'https://xxxx.supabase.co'
 * @param {string} supabaseKey  — anon key
 * @returns {Promise<Date>}
 */
async function getServerDate(supabaseUrl, supabaseKey) {
  // Tentativa 1: Edge Function própria (mais confiável)
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/server-time`, {
      headers: { apikey: supabaseKey },
      signal:  AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json();
      return new Date(data.iso);
    }
  } catch (_) { /* silencioso */ }

  // Tentativa 2: API pública de tempo
  try {
    const res = await fetch(
      'https://worldtimeapi.org/api/timezone/America/Asuncion',
      { signal: AbortSignal.timeout(4000) }
    );
    if (res.ok) {
      const data = await res.json();
      return new Date(data.datetime);
    }
  } catch (_) { /* silencioso */ }

  // Tentativa 3: Supabase RPC (SELECT now()) sem Edge Function
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/get_server_time`, {
      method:  'POST',
      headers: {
        apikey:          supabaseKey,
        'Content-Type':  'application/json',
        Authorization:   `Bearer ${supabaseKey}`,
      },
      body:   '{}',
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json();
      return new Date(data);
    }
  } catch (_) { /* silencioso */ }

  // Fallback: relógio local (aviso no console)
  console.warn('[Assinatura] Não foi possível obter hora do servidor. Usando relógio local.');
  return new Date();
}

// ─────────────────────────────────────────────────────────────
// 2. CÁLCULO DE VENCIMENTO
// ─────────────────────────────────────────────────────────────

/**
 * Verifica se um dia da semana é útil (segunda a sexta).
 */
function _isDiaUtil(date) {
  const dow = date.getDay(); // 0=Dom, 6=Sáb
  return dow !== 0 && dow !== 6;
}

/**
 * Calcula o N-ésimo dia útil de um dado mês/ano.
 * @param {number} ano
 * @param {number} mes   — 0-indexado (0=Jan, 11=Dez)
 * @param {number} nth   — qual dia útil (ex: 5 = 5º dia útil)
 * @returns {Date|null}
 */
function calcularNthDiaUtil(ano, mes, nth) {
  const diasNoMes = new Date(ano, mes + 1, 0).getDate();
  let count = 0;
  for (let dia = 1; dia <= diasNoMes; dia++) {
    const d = new Date(ano, mes, dia);
    if (_isDiaUtil(d)) {
      count++;
      if (count === nth) return d;
    }
  }
  return null; // nth maior que dias úteis do mês
}

/**
 * Calcula a data de vencimento do mês/ano fornecido com base
 * nas configurações da assinatura.
 *
 * @param {object} cfg
 * @param {string} cfg.tipo_vencimento   — 'dia_fixo' | 'dia_util'
 * @param {number} cfg.dia_vencimento    — dia fixo OU Nth dia útil
 * @param {number} ano
 * @param {number} mes  — 0-indexado
 * @returns {Date}
 */
function calcularDataVencimento(cfg, ano, mes) {
  if (cfg.tipo_vencimento === 'dia_util') {
    const d = calcularNthDiaUtil(ano, mes, cfg.dia_vencimento);
    if (!d) throw new Error(`Não foi possível calcular o ${cfg.dia_vencimento}º dia útil.`);
    return d;
  }

  // dia_fixo — clamp para o último dia do mês (ex: dia 31 em fevereiro → 28/29)
  const diasNoMes = new Date(ano, mes + 1, 0).getDate();
  const dia = Math.min(cfg.dia_vencimento, diasNoMes);
  return new Date(ano, mes, dia);
}

/**
 * Calcula a data-limite (vencimento + carência).
 * @param {Date}   dataVencimento
 * @param {number} diasCarencia
 * @returns {Date}
 */
function calcularDataLimite(dataVencimento, diasCarencia) {
  const d = new Date(dataVencimento);
  d.setDate(d.getDate() + diasCarencia);
  return d;
}

/**
 * Calcula a nova data de liberação temporária (+1 dia), usada pelo
 * botão "Liberar +1 dia" do painel de Assinatura.
 *
 * Se já existir uma liberação futura em aberto (cfg.liberado_ate maior
 * que hoje), soma +1 dia em cima dela em vez de sobrescrever com "hoje + 1"
 * — assim cliques repetidos no botão vão acumulando dias corretamente,
 * em vez de resetar a liberação a cada clique.
 *
 * @param {object} cfg          — linha da tabela assinaturas (precisa de cfg.liberado_ate)
 * @param {Date}   hoje         — data do servidor
 * @returns {Date}
 */
function calcularNovaLiberacao(cfg, hoje) {
  const atual = cfg.liberado_ate ? new Date(cfg.liberado_ate + 'T12:00:00') : null;
  const base  = (atual && atual > hoje) ? atual : hoje;
  const nova  = new Date(base);
  nova.setDate(nova.getDate() + 1);
  return nova;
}

// ─────────────────────────────────────────────────────────────
// 3. LÓGICA DE STATUS
// ─────────────────────────────────────────────────────────────

/**
 * Diferença em dias inteiros entre duas datas (ignorando horas).
 * Positivo = dataB é depois de dataA.
 */
function diffDias(dataA, dataB) {
  const _normalizar = (d) => {
    const n = new Date(d);
    n.setHours(0, 0, 0, 0);
    return n;
  };
  const msPerDia = 1000 * 60 * 60 * 24;
  return Math.round((_normalizar(dataB) - _normalizar(dataA)) / msPerDia);
}

/**
 * Verifica se o pagamento do mês já foi confirmado.
 * @param {string|null} ultimoPagamentoEm — ISO date string 'YYYY-MM-DD'
 * @param {number}      ano
 * @param {number}      mes  — 0-indexado
 */
function pagamentoConfirmadoNoMes(ultimoPagamentoEm, ano, mes) {
  if (!ultimoPagamentoEm) return false;
  const d = new Date(ultimoPagamentoEm + 'T12:00:00'); // evita fuso
  return d.getFullYear() === ano && d.getMonth() === mes;
}

/**
 * Retorna o status atual da assinatura.
 *
 * @param {object} cfg       — linha da tabela assinaturas
 * @param {Date}   hoje      — data do servidor
 * @returns {{
 *   status:       'liberado_manual'|'em_dia'|'alerta_verde'|'alerta_amarelo'|'alerta_laranja'|'carencia'|'bloqueado',
 *   diasParaVenc: number,   (negativo = já passou)
 *   diasParaBloc: number,   (só relevante em 'carencia')
 *   dataVenc:     Date,
 *   dataLimite:   Date,
 *   liberadoAte:  Date|undefined,  (só presente quando status === 'liberado_manual')
 * }}
 */
function calcularStatusAssinatura(cfg, hoje) {
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth();

  const dataVenc   = calcularDataVencimento(cfg, ano, mes);
  const dataLimite = calcularDataLimite(dataVenc, cfg.dias_carencia);

  const diasParaVenc = diffDias(hoje, dataVenc);   // negativo = vencido
  const diasParaBloc = diffDias(hoje, dataLimite); // negativo = bloqueio

  const pagouEsteMes = pagamentoConfirmadoNoMes(cfg.ultimo_pagamento_em, ano, mes);

  // Flag: sistema ainda não tem histórico de pagamento (instalação nova).
  // Nunca bloqueia automaticamente, mas exibe alertas normais de vencimento.
  // CORREÇÃO Bug 2: o bloco anterior tinha condição invertida
  // (só entrava quando JÁ estava além da carência, retornando 'em_dia' silenciosamente).
  const isInstalacaoNova = !cfg.ultimo_pagamento_em && !cfg.bloqueado;

  // ── Liberação manual temporária ("+1 dia") — tem prioridade sobre
  //    QUALQUER bloqueio, manual ou automático. É intencional: o botão
  //    existe justamente para destravar o sistema imediatamente, sem
  //    depender de confirmar pagamento nem de desbloquear de verdade.
  if (cfg.liberado_ate) {
    const dLib = new Date(cfg.liberado_ate + 'T23:59:59');
    if (hoje <= dLib) {
      return { status: 'liberado_manual', diasParaVenc, diasParaBloc, dataVenc, dataLimite, liberadoAte: dLib };
    }
  }

  // ── Já foi bloqueado manualmente ──
  if (cfg.bloqueado && !pagouEsteMes) {
    return { status: 'bloqueado', diasParaVenc, diasParaBloc, dataVenc, dataLimite };
  }

  // ── Pagamento confirmado este mês → tudo ok ──
  if (pagouEsteMes) {
    return { status: 'em_dia', diasParaVenc, diasParaBloc, dataVenc, dataLimite };
  }

  // ── Ultrapassou vencimento + carência → bloqueio automático (instalação nova: nunca bloqueia) ──
  if (diasParaBloc < 0 && !isInstalacaoNova) {
    return { status: 'bloqueado', diasParaVenc, diasParaBloc, dataVenc, dataLimite };
  }

  // ── Em carência (vencido mas dentro do prazo) ──
  if (diasParaVenc < 0) {
    return { status: 'carencia', diasParaVenc, diasParaBloc, dataVenc, dataLimite };
  }

  // ── No dia do vencimento ──
  if (diasParaVenc === 0) {
    return { status: 'alerta_laranja', diasParaVenc, diasParaBloc, dataVenc, dataLimite };
  }

  // ── 1 dia antes ──
  if (diasParaVenc === 1) {
    return { status: 'alerta_amarelo', diasParaVenc, diasParaBloc, dataVenc, dataLimite };
  }

  // ── 2 a 5 dias antes ──
  if (diasParaVenc <= 5) {
    return { status: 'alerta_verde', diasParaVenc, diasParaBloc, dataVenc, dataLimite };
  }

  // ── Fora de qualquer janela de aviso ──
  return { status: 'em_dia', diasParaVenc, diasParaBloc, dataVenc, dataLimite };
}

/**
 * Formatea una fecha para exhibición amigable en es-PY.
 * Ex: "13/05/2025"
 */
function formatarData(date) {
  return date.toLocaleDateString('es-PY', {
    day:   '2-digit',
    month: '2-digit',
    year:  'numeric',
    timeZone: 'America/Asuncion',
  });
}

// ── Exporta para uso nos outros módulos (ou via window.* se sem bundler) ──
if (typeof window !== 'undefined') {
  window.SubscriptionDateUtils = {
    getServerDate,
    calcularNthDiaUtil,
    calcularDataVencimento,
    calcularDataLimite,
    calcularNovaLiberacao,
    calcularStatusAssinatura,
    pagamentoConfirmadoNoMes,
    diffDias,
    formatarData,
  };
}
