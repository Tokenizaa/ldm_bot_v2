# Plano Geral de Manutenção — LDM Bot v2

## Objetivo

Estabelecer uma única regra de verdade para produtos, links afiliados, conteúdo, planejamento, publicação real no Facebook, contagem, deduplicação e exposição pública.

Princípio central:

> **Crawler prepara o produto. Banco guarda o produto pronto. Scheduler apenas agenda. Facebook confirma a publicação.**

Estados técnicos continuam internos para retry, timeout, reconciliação e diagnóstico. A visão de negócio continua binária: **Publicado** ou **Não publicado**.

## Regras operacionais

- Calendário real, mês a mês.
- Limite diário: 5 publicações.
- Limite mensal: 150 a partir do primeiro mês calendário completo.
- Mês parcial inicial não consome a quota mensal.
- Produto só pode ser reservado uma vez por grupo enquanto a publicação estiver ativa ou incerta.
- `published` só existe com evidência real de publicação.
- Sitemap só considera publicação realmente publicada.
- O link afiliado canônico é produzido por `buildAffiliateUrl()` e segue `/20889?afiliado=<GLOBAL_CODE>`.
- A copy Facebook deve estar pronta no banco antes do Scheduler iniciar o agendamento.
- O Scheduler não deve usar a IA como etapa normal de preparação do produto.

## Fase 1 — Calendário e quota

- Corrigir o conceito de ciclo mensal para calendário real.
- Tratar o primeiro mês parcial sem consumir a quota mensal.
- Aplicar 150/mês a partir do mês calendário seguinte.
- Manter 5/dia.
- Percorrer corretamente até o último dia de cada mês.
- Validar contagem de reservas futuras sem ultrapassar quota.

**Status: concluída.**

## Fase 2 — Máquina de estados e integridade

- Revisar transições `draft → attempting/publishing → scheduled/unknown/failed`.
- Garantir que `published` só seja usado com evidência real.
- Recuperar tentativas presas.
- Manter `unknown` bloqueado contra retry cego quando a reconciliação do Planner falhar.

**Status: concluída.**

## Fase 3 — Deduplicação, contadores e status de negócio

- Auditar identidade de produto, idempotência e slots.
- Impedir duplicação do mesmo produto com as mesmas características.
- Permitir variantes legítimas.
- Unificar contadores diário/mensal/dashboard.
- Separar estados técnicos da visão de negócio `Publicado` / `Não publicado`.

**Status: concluída.**

## Fase 4 — Reconciliação e saneamento do banco

### Objetivo

Deixar os dados existentes em estado coerente antes da reconciliação com o Facebook Planner.

### Produto

Para cada produto existente:

- `product_identity_key` único e coerente.
- `original_url` válida e canônica.
- `affiliate_url` reconstruída pelo padrão oficial atual.
- Nenhum link legado `/20889` sem `?afiliado=`.
- Nome, preço, categoria e marca válidos.
- SKU preservado quando existente.
- Imagem preservada quando existente.
- Copy Facebook pronta, válida e sem raciocínio/metatexto da IA.
- Copy sem preço, URL ou informações proibidas.
- Hashtags e `@todos` controlados pelo sistema.

### Conteúdo e arquitetura

Fluxo correto:

`Crawler → coleta → normalização → link afiliado → IA → validação → affiliate_links.facebook_copy → Scheduler`

O Scheduler não deve ser o responsável normal por gerar ou reparar copy. Deve consumir um produto já preparado e, se o produto estiver incompleto, bloquear o agendamento e registrar `PRODUCT_NOT_READY`.

Uma barreira de segurança pode continuar existindo no backend, mas não deve mascarar a falta de preparação do crawler.

### Publicações

- `posts` continua separado de `affiliate_links`.
- Publicações existentes são preservadas para a futura reconciliação com o Planner.
- Nenhuma publicação existente é convertida artificialmente em `published`.
- Neste momento, publicação real confirmada = 0.
- Produtos sem post continuam disponíveis para planejamento depois da reconciliação.

### Critério de saída

A fase só é concluída quando produtos, links e conteúdo estiverem reconciliados; o fluxo crawler → banco → scheduler estiver coerente; `published` continuar representando somente publicação real; e não existirem inconsistências conhecidas que contaminem a futura reconciliação do Planner.

**Status: concluída.**

## Fase 5 — Facebook Planner

### Objetivo

Reconciliar o estado local com o Planner nativo do Facebook sem transformar intenção local em prova de publicação.

### Execução realizada

- Auditado o fluxo Playwright documentado para `https://www.facebook.com/groups/tokeniza/scheduled_posts`.
- Confirmado no código que o executor usa o fluxo nativo `Composer → Programar post → Data → Hora → Programar`.
- Confirmada rotina de consulta ao Planner e verificação periódica.
- Identificados 16 registros presos em `publishing` e 2 registros `scheduled` já passados sem evidência persistida.
- Esses 18 registros foram movidos para o estado técnico `unknown`, representado pelo schema como `draft + post_type='unknown'`.
- Nenhum registro foi marcado como `published`.
- Nenhum agendamento futuro confirmado foi apagado.
- O banco passou a conter 25 registros `unknown`, 16 `draft`, 2 `failed` e 34 `scheduled` futuros.

### Correção obrigatória antes do fechamento

A rotina `checkPostInPlanner()` retorna `found` e `verified`, mas parte do Scheduler consome somente `found`.

A regra final precisa ser:

- `verified=false` → manter `unknown`; nunca interpretar como ausência.
- `verified=true + found=true` → confirmar `scheduled`.
- `verified=true + found=false` → ausência confirmada; liberar recriação segura.
- timeout, erro, sessão inválida ou página vazia → manter `unknown`.

### Validação real pendente

A validação final precisa usar a sessão persistente autenticada do Facebook e reconciliar os registros individualmente no Planner. O ambiente de sessão autenticado não está exposto ao executor desta rodada; portanto nenhuma confirmação de Facebook foi inventada.

**Status: em execução — saneamento concluído; validação real e ajuste final do consumo de `verified` ainda pendentes.**

## Fase 6 — Sitemap e publicação pública

- Auditar toda geração de sitemap.
- Sitemap contém somente publicações realmente publicadas.
- Excluir `draft`, `scheduled`, `attempting/publishing`, `unknown`, `failed` e registros incertos.
- Exigir URL pública válida e única.
- Deduplicar URLs/entradas.

## Fase 7 — Auditoria geral

- Crawler.
- Produtos e identidade.
- Links afiliados.
- Copy/IA/hashtags/@todos.
- Scheduler.
- Playwright/Facebook.
- Persistência e integridade do banco.
- API e frontend.
- Mocks, stubs, configurações legadas e código morto.
- Remover bloqueios reais encontrados sem quebrar as proteções de produção.

## Fase 8 — Produção e fechamento

- Build final.
- Testes automatizados.
- Fluxo ponta a ponta.
- Validação real controlada no Facebook.
- Revisão final de duplicidade.
- Validação do sitemap.
- Documentação final.
- Commit final de fechamento.

## Regra de execução

Cada fase deve ser uma rodada completa: **investigar → corrigir → testar → validar → commitar → atualizar `main` → registrar resultado**.

Não avançar com regressões conhecidas. Não criar commits intermediários burocráticos para uma mesma fase.
