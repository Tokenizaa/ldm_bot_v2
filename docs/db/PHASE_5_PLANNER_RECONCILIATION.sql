-- Fase 5: saneamento seguro antes da reconciliação com o Facebook Planner.
-- O schema atual representa o estado técnico UNKNOWN como:
--   status = 'draft' AND post_type = 'unknown'
--
-- Nunca transformar estes registros em published sem evidência do Planner/Facebook.

update public.posts
set
  status = 'draft',
  post_type = 'unknown',
  error_message = case
    when status = 'publishing' then 'PLANNER_RECONCILIATION_REQUIRED: publicação ficou presa em publishing e não possui confirmação atual do Facebook Planner.'
    else 'PLANNER_RECONCILIATION_REQUIRED: slot já passou sem evidência persistida de publicação; verificar Facebook Planner antes de qualquer retry.'
  end,
  next_attempt_at = null
where
  status = 'publishing'
  or (status = 'scheduled' and scheduled_at <= now());

-- Validação esperada após a execução:
-- 25 registros technical-unknown (draft + post_type=unknown)
-- 16 drafts normais
-- 2 failed
-- 34 scheduled futuros
-- 0 published
