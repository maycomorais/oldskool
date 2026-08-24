// subscriptionService.js
// Todas as queries Supabase relacionadas à assinatura.
// Depende de: window.supa (cliente Supabase já inicializado)
//
// ── ALTERAÇÕES NESTA REVISÃO ─────────────────────────────────
// Nova função liberarMaisUmDia() — grava assinaturas.liberado_ate
// e assinaturas.liberado_por, usados pelo botão "Liberar +1 dia".
// Requer migração SQL (rodar uma vez no Supabase):
//   ALTER TABLE assinaturas ADD COLUMN IF NOT EXISTS liberado_ate DATE;
//   ALTER TABLE assinaturas ADD COLUMN IF NOT EXISTS liberado_por TEXT;

'use strict';

const SubscriptionService = (() => {

  // ─────────────────────────────────────────────────────────────
  // LEITURA
  // ─────────────────────────────────────────────────────────────

  /**
   * Busca a assinatura ativa (id = 1 por padrão).
   * @returns {Promise<object|null>}
   */
  async function getAssinatura() {
    const { data, error } = await supa
      .from('assinaturas')
      .select('*')
      .eq('id', 1)
      .single();
    if (error) { console.error('[Assinatura] getAssinatura:', error.message); return null; }
    return data;
  }

  /**
   * Busca o histórico de pagamentos confirmados.
   * @param {number} limit
   * @returns {Promise<Array>}
   */
  async function getHistoricoPagamentos(limit = 12) {
    const { data, error } = await supa
      .from('assinatura_pagamentos')
      .select('*')
      .eq('assinatura_id', 1)
      .order('competencia', { ascending: false })
      .limit(limit);
    if (error) { console.error('[Assinatura] getHistorico:', error.message); return []; }
    return data || [];
  }

  // ─────────────────────────────────────────────────────────────
  // ESCRITA (adminMaster)
  // ─────────────────────────────────────────────────────────────

  /**
   * Salva as configurações de vencimento e carência.
   * @param {object} cfg  — { tipo_vencimento, dia_vencimento, dias_carencia, tenant_nome, tenant_email_contato, obs }
   * @returns {Promise<{ok:boolean, error?:string}>}
   */
  async function salvarConfigAssinatura(cfg) {
    const { data, error } = await supa
      .from('assinaturas')
      .update({
        tipo_vencimento:      cfg.tipo_vencimento,
        dia_vencimento:       Number(cfg.dia_vencimento),
        dias_carencia:        Number(cfg.dias_carencia),
        tenant_nome:          cfg.tenant_nome,
        tenant_email_contato: cfg.tenant_email_contato || null,
        obs:                  cfg.obs || null,
      })
      .eq('id', 1)
      .select();
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) {
      return { ok: false, error: 'Nenhuma linha atualizada — verifique a política de RLS (UPDATE) na tabela assinaturas para o seu perfil.' };
    }
    return { ok: true };
  }

  /**
   * Registra pagamento confirmado para uma competência (mês/ano).
   * Atualiza ultimo_pagamento_em e zera bloqueio.
   * @param {string} competencia  — 'YYYY-MM'
   * @param {string} confirmadoPor — email do adminMaster
   * @param {string} obs
   * @returns {Promise<{ok:boolean, error?:string}>}
   */
  async function confirmarPagamento(competencia, confirmadoPor, obs = '') {
    // 1. Upsert no histórico
    const { error: errHist } = await supa
      .from('assinatura_pagamentos')
      .upsert({
        assinatura_id:  1,
        competencia,
        confirmado_em:  new Date().toISOString(),
        confirmado_por: confirmadoPor,
        obs:            obs || null,
      }, { onConflict: 'assinatura_id,competencia' });

    if (errHist) return { ok: false, error: errHist.message };

    // 2. Atualiza ultimo_pagamento_em e desbloqueia
    // CORREÇÃO Bug 3: grava a data REAL da confirmação, não o dia 01 da competência.
    // Usar '-01' fazia pagamentoConfirmadoNoMes() falhar para meses onde o pagamento
    // era registrado ANTES do dia 01 do próximo mês (ou seja, sempre).
    const hoje = new Date().toISOString().split('T')[0]; // YYYY-MM-DD real
    const { data: rowsAssin, error: errAssin } = await supa
      .from('assinaturas')
      .update({
        ultimo_pagamento_em:   hoje,
        bloqueado:             false,
        desbloqueado_em:       new Date().toISOString(),
        desbloqueado_por:      confirmadoPor,
      })
      .eq('id', 1)
      .select();

    if (errAssin) return { ok: false, error: errAssin.message };
    // CORREÇÃO: sem .select(), um UPDATE bloqueado pela RLS retorna
    // { error: null } mesmo sem alterar nenhuma linha — reportando
    // sucesso falso. Com .select(), conseguimos detectar isso aqui.
    if (!rowsAssin || rowsAssin.length === 0) {
      return { ok: false, error: 'Nenhuma linha atualizada (possível bloqueio de RLS na tabela assinaturas).' };
    }
    return { ok: true };
  }

  /**
   * Bloqueia ou desbloqueia manualmente.
   * @param {boolean} bloquear
   * @param {string}  por  — email do adminMaster
   */
  async function alternarBloqueio(bloquear, por) {
    const campos = bloquear
      ? { bloqueado: true,  bloqueado_em:      new Date().toISOString() }
      : { bloqueado: false, desbloqueado_em:   new Date().toISOString(),
                            desbloqueado_por:  por };
    // CORREÇÃO: .select() no final é obrigatório aqui. Sem ele, um
    // UPDATE bloqueado pela política de RLS da tabela `assinaturas`
    // retorna { data: null, error: null } — ou seja, o botão
    // "Bloquear/Desbloquear Manualmente" mostrava sucesso mesmo
    // quando NADA foi alterado no banco. Com .select(), a resposta
    // traz de volta a(s) linha(s) realmente afetada(s), permitindo
    // detectar esse falso-positivo.
    const { data, error } = await supa.from('assinaturas').update(campos).eq('id', 1).select();
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) {
      return { ok: false, error: 'Nenhuma linha atualizada — verifique a política de RLS (UPDATE) na tabela assinaturas para o seu perfil.' };
    }
    return { ok: true };
  }

  /**
   * Concede uma liberação temporária ("+1 dia"), que passa a valer
   * imediatamente e tem prioridade sobre bloqueio manual ou automático
   * até a data informada (ver calcularStatusAssinatura em
   * subscriptionDateUtils.js).
   * @param {string} novaDataISO  — 'YYYY-MM-DD', calculada por calcularNovaLiberacao()
   * @param {string} por          — email/nome do operador que liberou
   * @returns {Promise<{ok:boolean, error?:string}>}
   */
  async function liberarMaisUmDia(novaDataISO, por) {
    const { data, error } = await supa
      .from('assinaturas')
      .update({
        liberado_ate: novaDataISO,
        liberado_por: por,
      })
      .eq('id', 1)
      .select();
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) {
      return { ok: false, error: 'Nenhuma linha atualizada — verifique a política de RLS (UPDATE) na tabela assinaturas para o seu perfil.' };
    }
    return { ok: true };
  }

  // ─────────────────────────────────────────────────────────────
  // REALTIME (listener para propagar bloqueio em tempo real)
  // ─────────────────────────────────────────────────────────────

  /**
   * Subscreve mudanças na assinatura e chama callback quando houver update.
   * @param {function} onUpdate  — recebe o novo registro
   * @returns {object} canal do Supabase (para dar .unsubscribe() depois)
   */
  function assinarMudancas(onUpdate) {
    return supa
      .channel('assinatura-realtime')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'assinaturas', filter: 'id=eq.1' },
        (payload) => onUpdate(payload.new)
      )
      .subscribe();
  }

  return {
    getAssinatura,
    getHistoricoPagamentos,
    salvarConfigAssinatura,
    confirmarPagamento,
    alternarBloqueio,
    liberarMaisUmDia,
    assinarMudancas,
  };
})();

if (typeof window !== 'undefined') {
  window.SubscriptionService = SubscriptionService;
}
