-- Fase 4 — Reconciliação de links e copy
-- Aplicado no Supabase project xtjujzjkabffeenhxsib.

-- 1) Canonical affiliate URL
update public.affiliate_links
set affiliate_url = regexp_replace(split_part(affiliate_url, '?', 1), '/+$', '') || '?afiliado=0S7w4Sy5S12oCKmeTo3Z3g=='
where affiliate_url is not null
  and affiliate_url not like '%?afiliado=%';

-- 2) Recovery fallback for missing/invalid persisted copy.
-- This only repairs existing contaminated rows. The normal runtime path remains:
-- crawler -> AI -> validation -> affiliate_links.facebook_copy.
with candidates as (
  select
    id,
    regexp_replace(
      regexp_replace(
        btrim(product_name),
        '\\s+(Entrega(?:\\s+Frete\\s+Grátis(?:\\s+Para\\s+todo\\s+o\\s+Brasil)?)?)(?:\\s+\\d+(?:[.,]\\d+)?)?\\s*$', '', 'i'
      ),
      '\\s+\\d[.,]\\d\\s*$', '', 'i'
    ) as clean_name,
    coalesce(nullif(btrim(brand), ''), 'Loja do Mecânico') as brand,
    coalesce(nullif(btrim(category), ''), 'Ferramentas') as category
  from public.affiliate_links
  where facebook_copy is null
     or btrim(facebook_copy) = ''
     or facebook_copy ~* '(system prompt|user prompt|fonte de verdade|regras absolutas|dados reais do produto|we need to|let.?s craft|let.?s place|check:|however,|actually,|we need to ensure|the name includes|vamos criar|vamos montar|precisamos garantir|verifique:|instrução|instrucao|modelo deve|resposta do modelo)'
     or length(btrim(facebook_copy)) > 500
)
update public.affiliate_links a
set facebook_copy = '🛠️ Destaque: ' || c.clean_name || ' da ' || c.brand || ', uma opção prática na categoria ' || c.category || '.\n\n📌 Confira os detalhes e veja se este modelo atende ao seu trabalho.\n\n@todos\n\n#Ferramentas\n#LojaDoMecanico\n#' || regexp_replace(split_part(c.clean_name, ' ', 1), '[^A-Za-z0-9]', '', 'g')
from candidates c
where a.id = c.id;
