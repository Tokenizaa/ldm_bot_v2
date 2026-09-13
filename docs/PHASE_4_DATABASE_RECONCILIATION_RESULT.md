# Resultado da Fase 4 — Reconciliação do banco

Data: 13/09/2026

## Validação final do banco

- Produtos: **268**.
- `product_identity_key` distintos: **268**.
- Links afiliados canônicos: **268/268**.
- Links não canônicos: **0**.
- Copy vazia: **0**.
- Copy com metatexto/raciocínio identificado pelos padrões de auditoria: **0**.
- Copy acima de 500 caracteres: **0**.
- Posts existentes: **77**.
- Produtos representados nos posts: **51**.
- Publicações reais confirmadas: **0**.

## Correções executadas

1. Os 268 `affiliate_url` foram migrados do formato legado `/20889` para o padrão canônico `/20889?afiliado=<GLOBAL_CODE>`.
2. Nenhum produto foi criado ou removido.
3. Nenhuma identidade de produto foi alterada.
4. Nenhum post foi apagado.
5. Nenhum registro foi marcado artificialmente como `published`.
6. Copies ausentes ou contaminadas foram substituídas por fallback determinístico seguro. Isso limpa o banco sem alterar o contrato de que a geração normal pertence ao crawler/IA.
7. `ContentService.ensureCopyForPublication()` deixou de gerar copy durante o agendamento. Ele agora funciona como **gate de prontidão**: copy ausente ou inválida gera `PRODUCT_NOT_READY` e bloqueia o agendamento.

## Contrato arquitetural confirmado

`Crawler → produto completo → IA → validação → affiliate_links.facebook_copy → Scheduler → Facebook`

O Scheduler agora consome copy previamente preparada. Ele não inicia uma segunda geração de IA como comportamento normal.

## Validação

A validação no banco confirmou 268 produtos, 268 links canônicos, zero copy vazia, zero copy contaminada pelos padrões auditados, zero copy acima de 500 caracteres e zero publicação real.

A busca de referências do método `ensureCopyForPublication()` no GitHub não retornou chamadas adicionais fora do fluxo já conhecido, embora a API de code search tenha indicado resultado incompleto.

## Status

**Fase 4 concluída.**

A base está reconciliada estruturalmente e o fluxo de conteúdo está preparado para a próxima etapa: reconciliação dos 77 registros internos com o Facebook Planner.
