# Fase 4 — Reconciliação e saneamento do banco

## Objetivo

Preparar o banco para a reconciliação com o Facebook Planner. O banco deve representar produtos reais, com links afiliados canônicos e conteúdo de publicação pronto.

## Levantamento inicial — 13/09/2026

### Produtos

- `affiliate_links`: **268 produtos**.
- `product_identity_key`: 268 distintos.
- `original_url`: 268 distintos.
- `affiliate_url`: 268 distintos.
- Todos os 268 possuem `original_url` e `affiliate_url`.
- Todos possuem nome, preço, categoria e marca.
- 254 SKUs distintos.
- 101 possuem imagem; imagem não é obrigatória para considerar o produto estruturalmente inválido.

### Links

Os 268 links afiliados estavam no formato legado:

`.../20889`

O padrão canônico atual do código é:

`.../20889?afiliado=<AFFILIATE_GLOBAL_CODE>`

A função responsável pelo padrão é `server/utils/affiliate.ts::buildAffiliateUrl()`.

### Copy

- 266 produtos possuem `facebook_copy` preenchida.
- 2 produtos não possuem copy.
- Auditoria por padrões de resposta/raciocínio identificou um conjunto relevante de copies suspeitas, indicando que respostas intermediárias do modelo chegaram a persistir no banco.
- A copy correta deve ser a publicação final, curta, sem preço, sem URL, sem metatexto e com `@todos`/hashtags controlados pelo sistema.

### Publicações

- `posts`: **77 registros**.
- Produtos distintos representados em `posts`: **51**.
- Produtos sem qualquer post: **217**.
- Publicações reais confirmadas: **0**.
- Nenhum post está sem `affiliate_link_id`.

Os 77 registros existentes não serão apagados nesta fase. Eles precisam ser reconciliados posteriormente com o Facebook Planner para distinguir registros internos de agendamentos realmente existentes.

## Arquitetura correta

O fluxo esperado é:

`Crawler → produto completo → link afiliado canônico → IA gera copy → validação → affiliate_links.facebook_copy → Scheduler → Facebook`

O Scheduler não deve normalmente chamar a IA para preparar o produto. A geração no Scheduler só pode existir como barreira de segurança temporária; produto incompleto deve ser bloqueado, não silenciosamente mascarado como pronto.

## Ações desta fase

1. Corrigir os 268 `affiliate_url` para o padrão canônico usando a mesma regra de `buildAffiliateUrl()`.
2. Não criar produtos adicionais.
3. Não alterar identidade de produto.
4. Não marcar nenhum registro como `published`.
5. Preservar os 77 posts para a Fase 5.
6. Fortalecer o crawler para que todo produto persistido saia preparado para publicação.
7. Impedir que o Scheduler trate ausência de copy como uma tarefa normal de IA.
8. Revalidar o banco após as correções.

## Critérios de saída

- 268 produtos continuam existindo.
- 268 links afiliados seguem o padrão canônico.
- Nenhuma publicação real é inventada.
- `published = 0` continua verdadeiro.
- Produto incompleto não entra no agendamento.
- O crawler permanece responsável pela preparação da copy.
- Os 77 posts continuam disponíveis para reconciliação no Planner.

## Observação

A existência de 77 registros de post não significa 77 publicações no Facebook. A fonte de verdade de publicação continua sendo a confirmação real no Facebook/Planner.
