# Fase 3 — Deduplicação e Contadores

## Status

**Concluída em 13/09/2026.**

## Auditoria encontrada

A tabela `posts` já possuía idempotência por `idempotency_key` e índices relacionados a plano/slot, porém esses mecanismos não impediam todos os cenários reais de duplicação porque `plan_id` pode ser nulo e o mesmo produto podia aparecer em publicações diferentes.

Auditoria no Supabase encontrou **8 produtos com duas reservas ativas** antes desta fase, além de outras duplicidades históricas entre estados não ativos. Os registros existentes não foram apagados ou alterados automaticamente porque alguns estão em `publishing` e precisam de reconciliação com o Planner do Facebook na Fase 4.

Estado observado após a auditoria:

- `scheduled`: 36
- `publishing`: 16
- `published`: 0
- `unknown`: 7
- `failed`: 2
- `draft` normal: 16
- reservas operacionais (`scheduled` + `publishing` + `published` + `unknown`): 59

## Correção aplicada

Foi criada e aplicada no Supabase a proteção `trg_posts_insert_dedup_guard`, executada **antes de cada INSERT** em `public.posts`.

A proteção rejeita uma nova publicação quando:

1. o mesmo produto (`affiliate_link_id`) já possui publicação não cancelada para o mesmo grupo;
2. o mesmo slot (`group_id + scheduled_at`) já está reservado por publicação não cancelada;
3. o mês alvo já possui 150 reservas operacionais, a partir dos meses calendário normais;
4. o dia alvo já possui 5 reservas operacionais.

`unknown` também é tratado como reserva operacional porque representa uma ação que pode ter sido enviada ao Facebook e não pode ser reutilizada sem reconciliação.

### Exceção de bootstrap

O mês calendário corrente iniciado depois do primeiro dia continua sem consumir a cota mensal de 150, conforme a Fase 1. A proteção mensal passa a valer para o mês seguinte e para os demais meses.

## Idempotência

A proteção de banco complementa `posts_idempotency_key_uq`. O resultado é uma defesa em camadas:

- chave de idempotência para produto + grupo + horário;
- proteção de produto + grupo;
- proteção de slot + grupo;
- limite diário;
- limite mensal;
- estados incertos continuam bloqueados até reconciliação.

## Contadores

A auditoria confirmou que o sistema deve tratar `scheduled`, `publishing`, `published` e `unknown` como reservas operacionais para fins de capacidade. Publicações `draft` normais e `failed` não reservam capacidade até serem novamente processadas.

O contador de `published` continua separado: ele só representa publicação efetivamente marcada como publicada, e não simples agendamento.

## Decisão sobre dados existentes

**Não houve limpeza automática dos 8 casos duplicados.** Fazer isso nesta fase poderia cancelar silenciosamente uma publicação que já existe no Facebook. A resolução desses casos deve ocorrer pela reconciliação do Planner na Fase 4.

## Critério de saída

- [x] Nova duplicação de produto bloqueada no banco.
- [x] Nova duplicação de slot bloqueada no banco.
- [x] Limite diário protegido no ponto de persistência.
- [x] Limite mensal protegido no ponto de persistência.
- [x] `unknown` tratado como reserva operacional.
- [x] Duplicidades históricas identificadas e preservadas para reconciliação segura.
- [x] Sem exclusão destrutiva de posts potencialmente existentes no Facebook.

## Próxima fase

**Fase 4 — Facebook Planner:** reconciliar os registros duplicados/incertos contra o Planner real, confirmar quais publicações existem no Facebook e somente então resolver os registros históricos conflitantes.
