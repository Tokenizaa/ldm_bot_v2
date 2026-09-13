# Fase 5 — Simplificação arquitetural e reset operacional

## Objetivo

Reduzir o LDM Bot ao modelo **Product Catalog First**.

O banco persistente mantém somente o catálogo de produtos prontos para publicação. O estado de execução/agendamento não deve ser usado como fonte persistente de verdade.

## Contrato do banco

- `affiliate_links`: fonte única persistente dos produtos.
- Cada produto deve possuir identidade, dados do produto, link original, link afiliado canônico e `facebook_copy` pronta.
- O estado operacional de publicação não faz parte do catálogo.
- `posts`, `monthly_plans`, `publication_history`, `affiliate_price_history` e `crawler_logs` não devem ser necessários para iniciar ou continuar o fluxo de publicação.
- O runtime pode manter estado transitório em memória.

## Estado do reset

Após o reset operacional de 13/09/2026:

- `affiliate_links`: 268 produtos.
- `posts`: 0.
- `monthly_plans`: 0.
- `publication_history`: 0.
- `affiliate_price_history`: 0.
- `crawler_logs`: 0.
- configurações/runtime antigas removidas.

## Regra de links — obrigatória

Todo link usado pelo Facebook deve passar por `buildAffiliateUrl()` em `server/utils/affiliate.ts`.

Formato canônico:

`<URL_DO_PRODUTO>/<AFFILIATE_ID>?afiliado=<AFFILIATE_GLOBAL_CODE>`

Valores padrão atuais:

- `AFFILIATE_ID=20889`
- `AFFILIATE_GLOBAL_CODE=0S7w4Sy5S12oCKmeTo3Z3g==`

O formato deve ser idempotente: um link já canônico não pode receber outro sufixo ou outro parâmetro.

Os 268 links existentes foram normalizados para o padrão canônico no reset/reconciliação do banco. Produtos futuros devem ser normalizados pelo mesmo builder antes de serem considerados prontos.

## Regras do Scheduler

O Scheduler deve:

1. Ler produtos diretamente de `affiliate_links`.
2. Filtrar somente produtos completos e com link afiliado canônico.
3. Manter os produtos já utilizados no ciclo apenas em memória.
4. Respeitar 5 horários por dia.
5. Não depender de registros `draft`, `scheduled`, `unknown`, `publishing` ou `published` no banco.
6. Não criar uma publicação persistente antes de executar o agendamento no Facebook.
7. Não regenerar copy durante o agendamento.
8. Usar o Facebook Planner somente como confirmação externa da operação real.

## Regras do crawler

O crawler deve atualizar/criar o produto em `affiliate_links` e garantir:

- URL original válida;
- URL afiliada construída por `buildAffiliateUrl()`;
- copy pronta antes de o produto entrar no catálogo publicável;
- identidade estável do produto;
- nenhum registro operacional derivado criado como parte da captura normal.

Histórico de preço não faz parte do novo contrato do banco.

## Critério de conclusão

A fase somente será considerada concluída quando:

- o banco continuar contendo apenas o catálogo persistente esperado;
- o Scheduler iniciar sem precisar reconstruir estado histórico;
- o primeiro ciclo começar como uma execução limpa;
- links atuais e novos passarem pela mesma normalização canônica;
- build/testes passarem;
- o fluxo real conseguir agendar no Facebook sem recriar a antiga máquina de estados.
