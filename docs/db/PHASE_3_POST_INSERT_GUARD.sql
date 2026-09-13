-- Fase 3 — proteção de inserção contra duplicidade e excesso de agenda.
-- Aplicada no Supabase em 13/09/2026.
--
-- Regra de exceção adicionada na Fase 5:
-- um draft explicitamente criado pela reconciliação após ausência confirmada no
-- Facebook Planner não representa uma reserva ativa e não deve bloquear a recriação.

CREATE OR REPLACE FUNCTION public.prevent_duplicate_post_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_day date;
  target_month text;
  current_local_date date;
  active_month_count integer;
  active_day_count integer;
BEGIN
  IF NEW.status = 'cancelled' THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1 FROM public.posts p
    WHERE p.affiliate_link_id = NEW.affiliate_link_id
      AND COALESCE(p.group_id, '') = COALESCE(NEW.group_id, '')
      AND p.status <> 'cancelled'
      AND NOT (
        p.status = 'draft'
        AND p.error_message = 'Agendamento não encontrado no planner Facebook; liberado para recriação segura.'
      )
  ) THEN
    RAISE EXCEPTION 'POST_PRODUCT_DUPLICATE: produto % já possui publicação para o grupo %', NEW.affiliate_link_id, NEW.group_id USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.posts p
    WHERE COALESCE(p.group_id, '') = COALESCE(NEW.group_id, '')
      AND p.scheduled_at = NEW.scheduled_at
      AND p.status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'POST_SLOT_DUPLICATE: slot % já está reservado para o grupo %', NEW.scheduled_at, NEW.group_id USING ERRCODE = '23505';
  END IF;

  target_day := (NEW.scheduled_at AT TIME ZONE 'America/Sao_Paulo')::date;
  target_month := to_char(target_day, 'YYYY-MM');
  current_local_date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  IF NOT (to_char(current_local_date, 'YYYY-MM') = target_month AND EXTRACT(DAY FROM current_local_date) > 1) THEN
    SELECT COUNT(*) INTO active_month_count
    FROM public.posts p
    WHERE COALESCE(p.group_id, '') = COALESCE(NEW.group_id, '')
      AND to_char((p.scheduled_at AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM') = target_month
      AND (p.status IN ('scheduled', 'publishing', 'published') OR p.post_type = 'unknown')
      AND p.id <> NEW.id;
    IF active_month_count >= 150 THEN
      RAISE EXCEPTION 'POST_MONTHLY_QUOTA_EXCEEDED: mês % já possui 150 reservas ativas para o grupo %', target_month, NEW.group_id USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  SELECT COUNT(*) INTO active_day_count
  FROM public.posts p
  WHERE COALESCE(p.group_id, '') = COALESCE(NEW.group_id, '')
    AND (p.scheduled_at AT TIME ZONE 'America/Sao_Paulo')::date = target_day
    AND (p.status IN ('scheduled', 'publishing', 'published') OR p.post_type = 'unknown')
    AND p.id <> NEW.id;
  IF active_day_count >= 5 THEN
    RAISE EXCEPTION 'POST_DAILY_QUOTA_EXCEEDED: dia % já possui 5 reservas ativas para o grupo %', target_day, NEW.group_id USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_posts_insert_dedup_guard ON public.posts;
CREATE TRIGGER trg_posts_insert_dedup_guard
BEFORE INSERT ON public.posts
FOR EACH ROW
EXECUTE FUNCTION public.prevent_duplicate_post_insert();
