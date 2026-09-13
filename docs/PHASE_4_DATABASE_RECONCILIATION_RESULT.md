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
6. Copies ausentes ou contaminadas foram substituídas por um fallback determinístico seguro para deixar o banco publicável enquanto a arquitetura normal permanece responsável por geração via IA no crawler.

## Achado arquitetural mantido para a próxima revisão

O código atual do Scheduler ainda possui uma barreira de segurança que chama `ContentService.ensureCopyForPublication()` durante o agendamento. Isso não deve ser o fluxo normal.

O contrato desejado permanece:

`Crawler → produto completo → IA → validação → banco → Scheduler`

Na próxima correção de código, o Scheduler deverá tratar produto sem copy válida como `PRODUCT_NOT_READY` e não iniciar uma nova geração de IA como comportamento normal.

## Status

A base de dados foi reconciliada estruturalmente e está pronta para a próxima etapa de reconciliação com o Facebook Planner.
