# FASE 5 — Auditoria de integridade do catálogo e copy pré-preparada

Data: 2026-09-13

## Resultado

A auditoria confirmou que o problema do segundo produto não é um caso aceitável para ser ignorado pelo Scheduler.

No Supabase `xtjujzjkabffeenhxsib`:

- `public.affiliate_links`: 268 produtos monitorados.
- 268/268 possuem `facebook_copy` não vazia.
- 268/268 possuem `@todos`.
- 268/268 possuem URL no padrão atual com `/produto/<id>/...` e parâmetro `?afiliado=`.
- 1/268 possui conteúdo inválido de geração de IA: o produto `ldm:14283` contém texto de raciocínio/metacontent ("Here's a thinking process...").
- O primeiro produto testado (`ldm:8609`) possui copy válida e foi agendado corretamente.

## Causa encontrada

O Scheduler está corretamente exigindo uma copy pré-preparada, mas o catálogo contém pelo menos um registro que passou pela preparação anterior com conteúdo de IA inválido.

Isso explica o log:

`PRODUCT_NOT_READY product=bca4c949-34d3-4808-84e5-08a681971b96`

O registro correspondente possui copy de 92 caracteres, porém ela é lixo de raciocínio do modelo e não uma publicação válida.

## Correção arquitetural

Não devemos mascarar esse erro com `continue`, porque isso transforma corrupção/inconsistência do catálogo em "produto ignorado".

A alteração temporária que fazia o Scheduler marcar o item como failed e continuar foi removida.

Agora `PRODUCT_NOT_READY` volta a interromper o ciclo com diagnóstico explícito.

O Scheduler continua sem regenerar copy via IA durante o agendamento. A responsabilidade permanece:

Crawler/AI -> grava copy validada no catálogo -> Scheduler consome a copy -> Facebook.

## Próximo passo obrigatório

Corrigir os registros inválidos do catálogo através do processo oficial de preparação/crawler, validar os 268 registros novamente e só então retomar o lote de agendamento.

Não alterar o Scheduler para "aceitar" copy inválida.
