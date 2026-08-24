-- ══════════════════════════════════════════════════════════════
--  SCHEMA COMPLETO — Instalação do zero OU atualização de projeto existente
--  Idempotente: seguro rodar tanto em banco novo quanto em banco já em uso.
--  Ordem de criação respeita as dependências de FK.
--
--  REVISÃO: consolidado a partir do script original + correções:
--   1) contratos_aceites estava definida DUAS VEZES (a 2ª, mais completa,
--      era ignorada por causa do IF NOT EXISTS) — unificada numa só,
--      já com todas as colunas (email, documento_cliente inclusos).
--   2) configuracoes.alias_qr_url estava faltando (usada em app.js:396
--      para exibir o QR de alias/PIX) — adicionada.
--   3) RLS de contratos_aceites tinha uma política "libera tudo" convivendo
--      com 3 políticas restritivas — como políticas permissivas se somam
--      por OR, a "libera tudo" anulava as restritivas. Removida a política
--      aberta; mantidas só as restritivas (usuário só vê/edita o próprio
--      aceite). Não quebra nada: admin.js sempre opera sobre o próprio
--      usuario_id autenticado.
--   4) Mantidos TODOS os IF NOT EXISTS / ADD COLUMN IF NOT EXISTS, incluindo
--      um patch extra de alias_qr_url para projetos existentes que ainda
--      não têm essa coluna — script seguro para rodar em qualquer instância
--      (nova ou já em produção).
-- ══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────────────────────
-- 1. PERFIS_ACESSO (perfil principal — cargo do usuário)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.perfis_acesso (
  id uuid NOT NULL,
  email text NOT NULL,
  cargo text NOT NULL DEFAULT 'funcionario'::text CHECK (cargo = ANY (ARRAY['adminMaster'::text, 'dono'::text, 'gerente'::text, 'funcionario'::text, 'garcom'::text])),
  nome_display text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT perfis_acesso_pkey PRIMARY KEY (id),
  CONSTRAINT perfis_acesso_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);

-- ─────────────────────────────────────────────────────────────
-- 2. FILIAIS (multi-sucursal) — deve existir antes de "perfis"
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.filiais (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  endereco text DEFAULT ''::text,
  coord_lat double precision DEFAULT 0,
  coord_lng double precision DEFAULT 0,
  whatsapp text NOT NULL,
  raio_entrega_km numeric DEFAULT 10,
  taxa_entrega_base numeric DEFAULT 0,
  status text NOT NULL DEFAULT 'ativa' CHECK (status = ANY (ARRAY['ativa'::text, 'inativa'::text, 'manutencao'::text])),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT filiais_pkey PRIMARY KEY (id)
);

-- ─────────────────────────────────────────────────────────────
-- 3. PERFIS (perfil vinculado a filial — usado pelo módulo filiais.js;
--    convive com perfis_acesso)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.perfis (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL,
  email text,
  nome text,
  role text NOT NULL DEFAULT 'funcionario' CHECK (role = ANY (ARRAY['adminMaster'::text, 'dono'::text, 'gerente'::text, 'funcionario'::text, 'garcom'::text, 'motoboy'::text])),
  filial_id uuid,
  ativo boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT perfis_pkey PRIMARY KEY (id),
  CONSTRAINT perfis_usuario_id_key UNIQUE (usuario_id),
  CONSTRAINT perfis_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT perfis_filial_id_fkey FOREIGN KEY (filial_id) REFERENCES public.filiais(id) ON DELETE SET NULL
);

-- ─────────────────────────────────────────────────────────────
-- 4. CONFIGURACOES (linha única id = 1)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.configuracoes (
  id integer NOT NULL DEFAULT 1 CHECK (id = 1),
  nome_restaurante text DEFAULT ''::text,
  descricao_loja text DEFAULT ''::text,
  url_loja text DEFAULT ''::text,
  telefone_loja text DEFAULT ''::text,
  whatsapp_loja text DEFAULT ''::text,
  logo_url text DEFAULT ''::text,
  icone_url text DEFAULT ''::text,
  chave_pix text DEFAULT ''::text,
  nome_pix text DEFAULT ''::text,
  dados_alias text DEFAULT ''::text,
  nome_alias text DEFAULT ''::text,
  maquininhas_cartao jsonb DEFAULT '[]'::jsonb,
  coord_lat double precision DEFAULT 0,
  coord_lng double precision DEFAULT 0,
  tabela_frete jsonb,
  limite_distancia_km numeric DEFAULT NULL::numeric,
  delivery_aberto boolean DEFAULT true,
  aviso_delivery text DEFAULT ''::text,
  loja_aberta boolean DEFAULT true,
  cotacao_real numeric DEFAULT 1100,
  taxa_motoboy_base integer DEFAULT 0,
  ajuda_combustivel integer DEFAULT 0,
  horarios_semanais jsonb,
  horario_extra_hoje jsonb,
  banner_imagem text DEFAULT ''::text,
  banner_produto_id integer,
  banner_desconto_tipo text,
  banner_desconto_valor numeric DEFAULT NULL::numeric,
  banner2_imagem text DEFAULT ''::text,
  banner2_produto_id integer,
  banner2_desconto_tipo text,
  banner2_desconto_valor numeric DEFAULT NULL::numeric,
  cor_primaria text DEFAULT '#1a7a2e'::text,
  cor_secundaria text DEFAULT '#155c24'::text,
  extras_globais jsonb DEFAULT '[]'::jsonb,
  extras_globais_categorias jsonb,
  sangria_limite integer,
  caixa_status jsonb DEFAULT '{}'::jsonb,
  features_ativas jsonb DEFAULT '{"tabs": {"pdv": true, "equipe": true, "cozinha": true, "pedidos": true, "dashboard": true, "financeiro": true, "inventario": true, "configuracoes": true}, "tipos_produto": {"kg": true, "acai": true, "suco": true, "combo": true, "pizza": true, "shake": true, "bebida": true, "lanche": true, "padrao": true, "sorvete": true, "montavel": true, "variacoes": true}, "funcionalidades": {"local": true, "balcao": true, "cupons": true, "factura": true, "delivery": true, "retirada": true, "agendamento": true, "multipagamento": true}}'::jsonb,
  taxa_parcelado numeric,
  taxa_credito numeric DEFAULT 0,
  taxa_debito numeric DEFAULT 0,
  cashback_percentual numeric DEFAULT 10,
  cashback_validade_dias integer DEFAULT 30,
  facturacion_config jsonb DEFAULT '{}'::jsonb,
  alias_qr_url text DEFAULT ''::text,
  CONSTRAINT configuracoes_pkey PRIMARY KEY (id)
);

INSERT INTO public.configuracoes (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 5. CATEGORIAS / SUBCATEGORIAS
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.categorias (
  id integer GENERATED BY DEFAULT AS IDENTITY,
  slug text NOT NULL UNIQUE,
  nome text NOT NULL DEFAULT ''::text,
  nome_exibicao text NOT NULL DEFAULT ''::text,
  descricao text DEFAULT ''::text,
  emoji text DEFAULT ''::text,
  cor text DEFAULT '#1a7a2e'::text,
  ordem integer DEFAULT 0,
  ativa boolean DEFAULT true,
  hora_inicio time without time zone,
  hora_fim time without time zone,
  dias_semana integer[],
  horarios_semanais jsonb,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT categorias_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.subcategorias (
  id integer GENERATED BY DEFAULT AS IDENTITY,
  slug text NOT NULL UNIQUE,
  nome_exibicao text NOT NULL,
  categoria_slug text,
  ordem integer DEFAULT 0,
  ativa boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT subcategorias_pkey PRIMARY KEY (id),
  CONSTRAINT subcategorias_categoria_slug_fkey FOREIGN KEY (categoria_slug) REFERENCES public.categorias(slug)
);

-- ─────────────────────────────────────────────────────────────
-- 6. PRODUTOS
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.produtos (
  id integer GENERATED BY DEFAULT AS IDENTITY,
  nome text NOT NULL,
  descricao text DEFAULT ''::text,
  preco integer DEFAULT 0,
  imagem_url text DEFAULT ''::text,
  categoria_slug text,
  subcategoria_slug text,
  ativo boolean DEFAULT true,
  pausado boolean DEFAULT false,
  somente_balcao boolean DEFAULT false,
  destaque boolean DEFAULT false,
  ordem integer DEFAULT 0,
  e_montavel boolean DEFAULT false,
  montagem_config jsonb,
  adicionais jsonb DEFAULT '[]'::jsonb,
  inventario_id integer,
  estoque_qtd integer,
  unidade_venda text DEFAULT 'un'::text,
  es_bebida boolean DEFAULT false,
  promo_ativo boolean DEFAULT false,
  promo_tipo text,
  promo_valor numeric,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT produtos_pkey PRIMARY KEY (id),
  CONSTRAINT produtos_categoria_slug_fkey FOREIGN KEY (categoria_slug) REFERENCES public.categorias(slug),
  CONSTRAINT fk_produtos_subcat FOREIGN KEY (subcategoria_slug) REFERENCES public.subcategorias(slug)
);

-- ─────────────────────────────────────────────────────────────
-- 7. INVENTARIO
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.inventario (
  id integer GENERATED BY DEFAULT AS IDENTITY,
  nome text NOT NULL,
  unidade text DEFAULT 'un'::text,
  quantidade numeric DEFAULT 0,
  quantidade_minima numeric DEFAULT NULL::numeric,
  custo_unit integer DEFAULT 0,
  produto_id integer,
  perecivel boolean DEFAULT false,
  data_validade date,
  observacoes text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT inventario_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.inventario_movimentos (
  id integer GENERATED BY DEFAULT AS IDENTITY,
  inventario_id integer,
  tipo text NOT NULL CHECK (tipo = ANY (ARRAY['add'::text, 'sub'::text, 'ajuste'::text, 'fechamento'::text])),
  quantidade numeric NOT NULL DEFAULT 0,
  motivo text DEFAULT ''::text,
  usuario_email text DEFAULT ''::text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT inventario_movimentos_pkey PRIMARY KEY (id),
  CONSTRAINT inventario_movimentos_inventario_id_fkey FOREIGN KEY (inventario_id) REFERENCES public.inventario(id)
);

-- ─────────────────────────────────────────────────────────────
-- 8. MOTOBOYS / CUPONS
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.motoboys (
  id integer GENERATED BY DEFAULT AS IDENTITY,
  nome text NOT NULL,
  telefone text DEFAULT ''::text,
  ativo boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT motoboys_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.cupons (
  id integer GENERATED BY DEFAULT AS IDENTITY,
  codigo text NOT NULL UNIQUE,
  tipo text NOT NULL CHECK (tipo = ANY (ARRAY['percentual'::text, 'fixo'::text, 'frete'::text])),
  valor numeric DEFAULT 0,
  minimo numeric DEFAULT 0,
  limite_uso integer,
  usos_realizados integer DEFAULT 0,
  ativo boolean DEFAULT true,
  validade date,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT cupons_pkey PRIMARY KEY (id)
);

-- ─────────────────────────────────────────────────────────────
-- 9. PEDIDOS
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.pedidos (
  id integer GENERATED BY DEFAULT AS IDENTITY,
  uid_temporal text DEFAULT ''::text,
  status text DEFAULT 'pendente'::text CHECK (status = ANY (ARRAY['pendente'::text, 'em_preparo'::text, 'pronto_entrega'::text, 'saiu_entrega'::text, 'entregue'::text, 'cancelado'::text])),
  tipo_entrega text DEFAULT 'delivery'::text CHECK (tipo_entrega = ANY (ARRAY['delivery'::text, 'retirada'::text, 'local'::text, 'balcao'::text])),
  itens jsonb DEFAULT '[]'::jsonb,
  subtotal integer DEFAULT 0,
  desconto_cupom integer DEFAULT 0,
  desconto_pdv_valor integer DEFAULT 0,
  desconto_pdv_tipo text,
  frete_cobrado_cliente integer DEFAULT 0,
  frete_motoboy integer DEFAULT 0,
  frete_a_combinar boolean DEFAULT false,
  total_geral integer DEFAULT 0,
  forma_pagamento text DEFAULT ''::text,
  obs_pagamento text DEFAULT ''::text,
  cliente_nome text DEFAULT ''::text,
  cliente_telefone text DEFAULT ''::text,
  endereco_entrega text DEFAULT ''::text,
  geo_lat text,
  geo_lng text,
  dados_factura jsonb,
  motoboy_id integer,
  garcom_id uuid,
  garcom_nome text,
  cancelamento_solicitado boolean DEFAULT false,
  cancelamento_motivo text,
  cancelamento_solicitado_por text,
  cancelamento_solicitado_em timestamp with time zone,
  cancelamento_aprovado_por text,
  cancelamento_aprovado_em timestamp with time zone,
  motivo_cancelamento text,
  confirmacao_tipo text,
  cupom_codigo text,
  quitado_em timestamp with time zone,
  forma_pagamento_quitacao text,
  tempo_recebido timestamp with time zone DEFAULT now(),
  tempo_confirmado timestamp with time zone,
  tempo_preparo_iniciado timestamp with time zone,
  tempo_pronto timestamp with time zone,
  tempo_saiu_entrega timestamp with time zone,
  tempo_entregue timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  entrega_confirmada_em timestamp with time zone,
  CONSTRAINT pedidos_pkey PRIMARY KEY (id),
  CONSTRAINT pedidos_motoboy_id_fkey FOREIGN KEY (motoboy_id) REFERENCES public.motoboys(id),
  CONSTRAINT pedidos_garcom_id_fkey FOREIGN KEY (garcom_id) REFERENCES public.perfis_acesso(id)
);

CREATE TABLE IF NOT EXISTS public.solicitacoes_cancelamento (
  id integer GENERATED BY DEFAULT AS IDENTITY,
  pedido_id integer,
  motivo text DEFAULT ''::text,
  solicitado_por text DEFAULT ''::text,
  aprovado boolean DEFAULT false,
  aprovado_por text,
  aprovado_em timestamp with time zone,
  negado boolean DEFAULT false,
  negado_por text,
  negado_em timestamp with time zone,
  observacoes text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT solicitacoes_cancelamento_pkey PRIMARY KEY (id),
  CONSTRAINT solicitacoes_cancelamento_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES public.pedidos(id)
);

-- ─────────────────────────────────────────────────────────────
-- 10. SESSÕES DE CAIXA / MOVIMENTAÇÕES DE CAIXA
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sessoes_caixa (
  id integer GENERATED BY DEFAULT AS IDENTITY,
  usuario_email text NOT NULL,
  usuario_nome text,
  aberto_em timestamp with time zone NOT NULL DEFAULT now(),
  fechado_em timestamp with time zone,
  valor_abertura numeric DEFAULT 0,
  valor_fechamento numeric,
  observacao text,
  CONSTRAINT sessoes_caixa_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.movimentacoes_caixa (
  id integer GENERATED BY DEFAULT AS IDENTITY,
  tipo text NOT NULL,
  valor numeric NOT NULL DEFAULT 0,
  descricao text DEFAULT ''::text,
  usuario_email text DEFAULT ''::text,
  tipo_despesa text,
  descricao_outro text,
  autorizado_por text,
  pedido_id integer,
  sessao_id integer,
  forma_pagamento text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT movimentacoes_caixa_pkey PRIMARY KEY (id),
  CONSTRAINT movimentacoes_caixa_sessao_id_fkey FOREIGN KEY (sessao_id) REFERENCES public.sessoes_caixa(id) ON DELETE SET NULL
);

-- ─────────────────────────────────────────────────────────────
-- 11. CRM — CLIENTES + CASHBACK
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.clientes (
  id integer GENERATED BY DEFAULT AS IDENTITY,
  nome text NOT NULL,
  telefone text,
  data_nascimento date,
  saldo_cashback numeric DEFAULT 0,
  total_gasto numeric DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT clientes_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.cashback_transacoes (
  id integer GENERATED BY DEFAULT AS IDENTITY,
  cliente_id integer,
  cliente_telefone text,
  pedido_id integer,
  tipo text NOT NULL CHECK (tipo = ANY (ARRAY['credito'::text, 'debito'::text])),
  valor numeric NOT NULL DEFAULT 0,
  validade_dias integer,
  expira_em timestamp with time zone,
  usado boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT cashback_transacoes_pkey PRIMARY KEY (id),
  CONSTRAINT cashback_transacoes_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE CASCADE,
  CONSTRAINT cashback_transacoes_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES public.pedidos(id) ON DELETE SET NULL
);

-- ─────────────────────────────────────────────────────────────
-- 12. FICHA TÉCNICA — INSUMOS / FICHAS / ITENS
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.insumos (
  id integer GENERATED BY DEFAULT AS IDENTITY,
  nome text NOT NULL,
  unidade text NOT NULL DEFAULT 'un'::text,
  preco_custo numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT insumos_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.fichas_tecnicas (
  id integer GENERATED BY DEFAULT AS IDENTITY,
  produto_nome text NOT NULL,
  markup_percent numeric DEFAULT 300,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT fichas_tecnicas_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.ficha_itens (
  id integer GENERATED BY DEFAULT AS IDENTITY,
  ficha_id integer NOT NULL,
  insumo_id integer,
  insumo_nome text,
  unidade_insumo text,
  quantidade numeric NOT NULL DEFAULT 0,
  CONSTRAINT ficha_itens_pkey PRIMARY KEY (id),
  CONSTRAINT ficha_itens_ficha_id_fkey FOREIGN KEY (ficha_id) REFERENCES public.fichas_tecnicas(id) ON DELETE CASCADE,
  CONSTRAINT ficha_itens_insumo_id_fkey FOREIGN KEY (insumo_id) REFERENCES public.insumos(id) ON DELETE SET NULL
);

-- ─────────────────────────────────────────────────────────────
-- 13. FACTURACIÓN ELECTRÓNICA
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.facturas (
  id integer GENERATED BY DEFAULT AS IDENTITY,
  pedido_id integer,
  kude text,
  estado text DEFAULT 'pendente'::text,
  xml text,
  qr_code text,
  link_validacao text,
  respuesta_dnit jsonb,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT facturas_pkey PRIMARY KEY (id),
  CONSTRAINT facturas_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES public.pedidos(id) ON DELETE SET NULL
);

-- ─────────────────────────────────────────────────────────────
-- 14. MENSALISTAS
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.planos_mensalistas (
  id integer GENERATED BY DEFAULT AS IDENTITY,
  cliente_id integer NOT NULL,
  produto_nome text NOT NULL,
  quantidade_total integer DEFAULT 0,
  quantidade_restante integer DEFAULT 0,
  valor_plano numeric DEFAULT 0,
  valor_restante numeric DEFAULT 0,
  data_inicio date,
  data_fim date,
  ativo boolean DEFAULT true,
  obs text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT planos_mensalistas_pkey PRIMARY KEY (id),
  CONSTRAINT planos_mensalistas_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.mensalista_entregas (
  id integer GENERATED BY DEFAULT AS IDENTITY,
  plano_id integer NOT NULL,
  cliente_id integer,
  produto_nome text,
  quantidade integer NOT NULL DEFAULT 0,
  observacoes text,
  itens_extras jsonb,
  valor_extras numeric,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT mensalista_entregas_pkey PRIMARY KEY (id),
  CONSTRAINT mensalista_entregas_plano_id_fkey FOREIGN KEY (plano_id) REFERENCES public.planos_mensalistas(id) ON DELETE CASCADE,
  CONSTRAINT mensalista_entregas_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE SET NULL
);

-- ─────────────────────────────────────────────────────────────
-- 15. CONTRATOS DE ACEITE (assinatura eletrônica do dono)
--     CORRIGIDO: antes definida duas vezes no script original (a 2ª,
--     mais completa, nunca chegava a rodar por causa do IF NOT EXISTS).
--     Unificada aqui numa só definição, já com todas as colunas.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.contratos_aceites (
  id integer GENERATED BY DEFAULT AS IDENTITY,
  usuario_id uuid NOT NULL,
  aceito boolean DEFAULT false,
  nome_assinante text,
  doc_assinante text,
  ip_assinante text,
  user_agent text,
  aceito_em timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  -- Variações de nomes de campo usadas em versões antigas do frontend
  email text,
  hash_contrato text,
  versao_contrato text,
  nome_cliente text,
  doc_cliente text,
  documento_cliente text,
  ip_address text,
  CONSTRAINT contratos_aceites_pkey PRIMARY KEY (id),
  CONSTRAINT contratos_aceites_usuario_id_key UNIQUE (usuario_id),
  CONSTRAINT contratos_aceites_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Caso a tabela já existisse (projeto atualizado) com menos colunas,
-- adiciona as que faltarem:
ALTER TABLE public.contratos_aceites
  ADD COLUMN IF NOT EXISTS nome_assinante TEXT,
  ADD COLUMN IF NOT EXISTS doc_assinante TEXT,
  ADD COLUMN IF NOT EXISTS ip_assinante TEXT,
  ADD COLUMN IF NOT EXISTS nome_cliente TEXT,
  ADD COLUMN IF NOT EXISTS doc_cliente TEXT,
  ADD COLUMN IF NOT EXISTS documento_cliente TEXT,
  ADD COLUMN IF NOT EXISTS ip_address TEXT,
  ADD COLUMN IF NOT EXISTS hash_contrato TEXT,
  ADD COLUMN IF NOT EXISTS versao_contrato TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS user_agent TEXT;

-- Trigger: autopreenche as variações de nome de campo caso venham nulas
-- (ex.: se o frontend mandar nome_cliente, copia pra nome_assinante e
-- vice-versa), para tolerar versões diferentes do JS apontando pro mesmo banco.
CREATE OR REPLACE FUNCTION public.trg_sync_contratos_aceites()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.nome_assinante IS NULL AND NEW.nome_cliente IS NOT NULL THEN
        NEW.nome_assinante := NEW.nome_cliente;
    ELSIF NEW.nome_cliente IS NULL AND NEW.nome_assinante IS NOT NULL THEN
        NEW.nome_cliente := NEW.nome_assinante;
    END IF;

    IF NEW.doc_assinante IS NULL AND NEW.doc_cliente IS NOT NULL THEN
        NEW.doc_assinante := NEW.doc_cliente;
    ELSIF NEW.doc_cliente IS NULL AND NEW.doc_assinante IS NOT NULL THEN
        NEW.doc_cliente := NEW.doc_assinante;
    END IF;

    IF NEW.ip_assinante IS NULL AND NEW.ip_address IS NOT NULL THEN
        NEW.ip_assinante := NEW.ip_address;
    ELSIF NEW.ip_address IS NULL AND NEW.ip_assinante IS NOT NULL THEN
        NEW.ip_address := NEW.ip_assinante;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_contratos_aceites_before ON public.contratos_aceites;
CREATE TRIGGER trg_sync_contratos_aceites_before
BEFORE INSERT OR UPDATE ON public.contratos_aceites
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_contratos_aceites();

-- ─────────────────────────────────────────────────────────────
-- 16. ASSINATURA SAAS (controle de mensalidade do sistema)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.assinaturas (
  id integer NOT NULL DEFAULT 1 CHECK (id = 1),
  tipo_vencimento text NOT NULL DEFAULT 'dia_fixo'::text CHECK (tipo_vencimento = ANY (ARRAY['dia_fixo'::text, 'dia_util'::text])),
  dia_vencimento integer NOT NULL DEFAULT 10,
  dias_carencia integer NOT NULL DEFAULT 5,
  tenant_nome text,
  tenant_email_contato text,
  obs text,
  ultimo_pagamento_em date,
  bloqueado boolean DEFAULT false,
  bloqueado_em timestamp with time zone,
  desbloqueado_em timestamp with time zone,
  desbloqueado_por text,
  liberado_ate date,
  liberado_por text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT assinaturas_pkey PRIMARY KEY (id)
);

INSERT INTO public.assinaturas (id, tipo_vencimento, dia_vencimento, dias_carencia, tenant_nome)
VALUES (1, 'dia_fixo', 10, 5, 'Tenant Padrão')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.assinatura_pagamentos (
  id integer GENERATED BY DEFAULT AS IDENTITY,
  assinatura_id integer NOT NULL DEFAULT 1,
  competencia text NOT NULL,
  confirmado_em timestamp with time zone,
  confirmado_por text,
  obs text,
  CONSTRAINT assinatura_pagamentos_pkey PRIMARY KEY (id),
  CONSTRAINT assinatura_pagamentos_assinatura_id_fkey FOREIGN KEY (assinatura_id) REFERENCES public.assinaturas(id) ON DELETE CASCADE,
  CONSTRAINT assinatura_pagamentos_unq UNIQUE (assinatura_id, competencia)
);

-- ─────────────────────────────────────────────────────────────
-- 17. PATCH DE COLUNAS — cobre projetos já existentes criados antes
--     desta revisão (CREATE TABLE IF NOT EXISTS não adiciona coluna
--     em tabela que já existe, por isso os ALTER abaixo são necessários
--     mesmo já estando tudo declarado nas CREATE TABLE acima).
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.pedidos      ADD COLUMN IF NOT EXISTS quitado_em TIMESTAMPTZ;
ALTER TABLE public.pedidos      ADD COLUMN IF NOT EXISTS forma_pagamento_quitacao TEXT;
ALTER TABLE public.assinaturas  ADD COLUMN IF NOT EXISTS liberado_ate DATE;
ALTER TABLE public.assinaturas  ADD COLUMN IF NOT EXISTS liberado_por TEXT;
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS alias_qr_url TEXT DEFAULT ''::text;

-- ─────────────────────────────────────────────────────────────
-- 18. ÍNDICES
-- ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_produtos_categoria_slug ON public.produtos (categoria_slug);
CREATE INDEX IF NOT EXISTS idx_produtos_subcategoria_slug ON public.produtos (subcategoria_slug);
CREATE INDEX IF NOT EXISTS idx_subcategorias_categoria_slug ON public.subcategorias (categoria_slug);
CREATE INDEX IF NOT EXISTS idx_inventario_movimentos_inventario_id ON public.inventario_movimentos (inventario_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_status ON public.pedidos (status);
CREATE INDEX IF NOT EXISTS idx_pedidos_created_at ON public.pedidos (created_at);
CREATE INDEX IF NOT EXISTS idx_pedidos_forma_pagamento ON public.pedidos (forma_pagamento);
CREATE INDEX IF NOT EXISTS idx_pedidos_motoboy_id ON public.pedidos (motoboy_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_garcom_id ON public.pedidos (garcom_id);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_cancelamento_pedido_id ON public.solicitacoes_cancelamento (pedido_id);
CREATE INDEX IF NOT EXISTS idx_sessoes_caixa_usuario_email ON public.sessoes_caixa (usuario_email);
CREATE INDEX IF NOT EXISTS idx_sessoes_caixa_fechado_em ON public.sessoes_caixa (fechado_em);
CREATE INDEX IF NOT EXISTS idx_movimentacoes_caixa_sessao_id ON public.movimentacoes_caixa (sessao_id);
CREATE INDEX IF NOT EXISTS idx_clientes_telefone ON public.clientes (telefone);
CREATE INDEX IF NOT EXISTS idx_cashback_cliente_id ON public.cashback_transacoes (cliente_id);
CREATE INDEX IF NOT EXISTS idx_cashback_expira_em ON public.cashback_transacoes (expira_em);
CREATE INDEX IF NOT EXISTS idx_ficha_itens_ficha_id ON public.ficha_itens (ficha_id);
CREATE INDEX IF NOT EXISTS idx_facturas_pedido_id ON public.facturas (pedido_id);
CREATE INDEX IF NOT EXISTS idx_planos_mensalistas_cliente_id ON public.planos_mensalistas (cliente_id);
CREATE INDEX IF NOT EXISTS idx_mensalista_entregas_plano_id ON public.mensalista_entregas (plano_id);
CREATE INDEX IF NOT EXISTS idx_perfis_filial_id ON public.perfis (filial_id);

-- ─────────────────────────────────────────────────────────────
-- 19. FUNÇÕES RPC
--     Usadas por subscriptionDateUtils.js (getServerDate, fallback 3)
--     e por app.js (incrementar_uso_cupom, ao aplicar cupom).
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_server_time()
RETURNS timestamp with time zone
LANGUAGE sql
STABLE
AS $$
  SELECT now();
$$;

GRANT EXECUTE ON FUNCTION public.get_server_time() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.incrementar_uso_cupom(cupom_id integer)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.cupons
  SET usos_realizados = COALESCE(usos_realizados, 0) + 1
  WHERE id = cupom_id;
$$;

GRANT EXECUTE ON FUNCTION public.incrementar_uso_cupom(integer) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 20. RLS — habilita e libera acesso via anon key para todas as
--     tabelas do projeto, EXCETO contratos_aceites (ver seção 21),
--     que fica restrita ao próprio usuário autenticado por conter
--     dados de assinatura/consentimento legal.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.perfis_acesso ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.filiais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perfis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuracoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subcategorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventario ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventario_movimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.motoboys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitacoes_cancelamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessoes_caixa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movimentacoes_caixa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashback_transacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insumos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fichas_tecnicas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ficha_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planos_mensalistas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mensalista_entregas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contratos_aceites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assinaturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assinatura_pagamentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_all_perfis_acesso ON public.perfis_acesso;
CREATE POLICY allow_all_perfis_acesso ON public.perfis_acesso FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS allow_all_filiais ON public.filiais;
CREATE POLICY allow_all_filiais ON public.filiais FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS allow_all_perfis ON public.perfis;
CREATE POLICY allow_all_perfis ON public.perfis FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS allow_all_configuracoes ON public.configuracoes;
CREATE POLICY allow_all_configuracoes ON public.configuracoes FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS allow_all_categorias ON public.categorias;
CREATE POLICY allow_all_categorias ON public.categorias FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS allow_all_subcategorias ON public.subcategorias;
CREATE POLICY allow_all_subcategorias ON public.subcategorias FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS allow_all_produtos ON public.produtos;
CREATE POLICY allow_all_produtos ON public.produtos FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS allow_all_inventario ON public.inventario;
CREATE POLICY allow_all_inventario ON public.inventario FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS allow_all_inventario_movimentos ON public.inventario_movimentos;
CREATE POLICY allow_all_inventario_movimentos ON public.inventario_movimentos FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS allow_all_motoboys ON public.motoboys;
CREATE POLICY allow_all_motoboys ON public.motoboys FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS allow_all_cupons ON public.cupons;
CREATE POLICY allow_all_cupons ON public.cupons FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS allow_all_pedidos ON public.pedidos;
CREATE POLICY allow_all_pedidos ON public.pedidos FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS allow_all_solicitacoes_cancelamento ON public.solicitacoes_cancelamento;
CREATE POLICY allow_all_solicitacoes_cancelamento ON public.solicitacoes_cancelamento FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS allow_all_sessoes_caixa ON public.sessoes_caixa;
CREATE POLICY allow_all_sessoes_caixa ON public.sessoes_caixa FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS allow_all_movimentacoes_caixa ON public.movimentacoes_caixa;
CREATE POLICY allow_all_movimentacoes_caixa ON public.movimentacoes_caixa FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS allow_all_clientes ON public.clientes;
CREATE POLICY allow_all_clientes ON public.clientes FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS allow_all_cashback_transacoes ON public.cashback_transacoes;
CREATE POLICY allow_all_cashback_transacoes ON public.cashback_transacoes FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS allow_all_insumos ON public.insumos;
CREATE POLICY allow_all_insumos ON public.insumos FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS allow_all_fichas_tecnicas ON public.fichas_tecnicas;
CREATE POLICY allow_all_fichas_tecnicas ON public.fichas_tecnicas FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS allow_all_ficha_itens ON public.ficha_itens;
CREATE POLICY allow_all_ficha_itens ON public.ficha_itens FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS allow_all_facturas ON public.facturas;
CREATE POLICY allow_all_facturas ON public.facturas FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS allow_all_planos_mensalistas ON public.planos_mensalistas;
CREATE POLICY allow_all_planos_mensalistas ON public.planos_mensalistas FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS allow_all_mensalista_entregas ON public.mensalista_entregas;
CREATE POLICY allow_all_mensalista_entregas ON public.mensalista_entregas FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS allow_all_assinaturas ON public.assinaturas;
CREATE POLICY allow_all_assinaturas ON public.assinaturas FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS allow_all_assinatura_pagamentos ON public.assinatura_pagamentos;
CREATE POLICY allow_all_assinatura_pagamentos ON public.assinatura_pagamentos FOR ALL USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 21. RLS de contratos_aceites — restrita ao próprio usuário
--     CORRIGIDO: o script original criava uma política "libera tudo"
--     (allow_all_contratos_aceites) JUNTO com estas três restritivas.
--     Como políticas permissivas do Postgres se combinam por OR, a
--     "libera tudo" tornava as outras três inúteis na prática — a
--     tabela ficava tão aberta quanto qualquer outra via anon key,
--     mesmo contendo prova de aceite de contrato (nome, documento, IP).
--     Removida a política aberta; mantidas só as restritivas abaixo.
--     Não quebra nada: todo acesso no admin.js já opera sobre o
--     usuario_id do usuário autenticado (auth.uid()).
-- ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS allow_all_contratos_aceites ON public.contratos_aceites;

DROP POLICY IF EXISTS "Permitir Insert Autenticado" ON public.contratos_aceites;
CREATE POLICY "Permitir Insert Autenticado" ON public.contratos_aceites
FOR INSERT TO authenticated WITH CHECK (auth.uid() = usuario_id);

DROP POLICY IF EXISTS "Permitir Update Autenticado" ON public.contratos_aceites;
CREATE POLICY "Permitir Update Autenticado" ON public.contratos_aceites
FOR UPDATE TO authenticated USING (auth.uid() = usuario_id);

DROP POLICY IF EXISTS "Permitir Select Autenticado" ON public.contratos_aceites;
CREATE POLICY "Permitir Select Autenticado" ON public.contratos_aceites
FOR SELECT TO authenticated USING (auth.uid() = usuario_id);

-- ─────────────────────────────────────────────────────────────
-- 22. RECARREGA O SCHEMA CACHE DA API DO SUPABASE (obrigatório após
--     alterar colunas/tabelas, para o PostgREST enxergar as mudanças)
-- ─────────────────────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';