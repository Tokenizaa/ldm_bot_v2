# Auditoria profunda — Facebook/Scheduler/Storage — LDM Bot v2

Data: 2026-09-11
Escopo: segunda revisão do branch main, procurando problemas além dos P0 já registrados.

## Novos achados críticos

### P0. Concorrência do scheduler não está protegida
server.ts chama scheduler.start() uma única vez no startup, mas a API também expõe /scheduler/batch-today e /scheduler/run-due. Não existe lock de aplicação no SchedulerService. Duas chamadas simultâneas podem executar ensureMonthlySchedule() em paralelo, selecionar o mesmo produto/slot e criar/usar registros concorrentes.

O FacebookAutomationService.serial() protege somente operações Facebook dentro daquela instância. Ele não protege criação de filas no Storage nem duas instâncias/processos.

Correção: lock único para operações de scheduling, idealmente no banco quando houver múltiplos processos. No mínimo um mutex no SchedulerService.

### P0. resetPublicationForRetry() coloca scheduled antes de o Facebook confirmar
O método grava status scheduled, attempts 0 e limpa erro antes de chamar o Facebook. Se o processo morrer entre reset e schedulePublication(), o banco fica com publicação aparentemente confirmada sem confirmação do Facebook.

Semântica correta: failed -> draft/pending -> tentativa -> scheduled somente após confirmação.

### P0. createPublication() ainda aceita status arbitrário
O Storage não valida transições. Qualquer caller pode persistir scheduled, published, cancelled etc. Isso permite estados impossíveis.

Storage deveria restringir transições ou receber comandos específicos.

### P0. Falha depois do clique em Programar pode duplicar anúncio
O fluxo clica em Programar e depois navega/verifica o planner. Se o Facebook aceitar o agendamento, mas a navegação ou verificação falhar, Scheduler marca failed. Um retry pode clicar novamente e criar segundo post.

Esse é o risco operacional mais importante depois do selector.

A operação precisa ser idempotente também no lado Facebook: antes de repetir uma tentativa cujo clique pode ter ocorrido, verificar o planner por conteúdo + janela de horário, e só clicar se não houver evidência de agendamento.

## Novos achados P1

### P1. confirmAndVerify() retorna a URL do planner como facebook_post_url
O método retorna /scheduled_posts e Scheduler persiste isso em facebook_post_url. Esse campo passa a dizer URL do planner, não URL do post.

Renomear para verification_url/planner_url ou capturar o ID/URL real do post.

### P1. Planner verification é frágil
A busca usa somente os primeiros 80 caracteres da copy. Duas publicações com início igual podem validar a publicação errada.

Usar copy + slot/data/hora e, idealmente, ID estrutural do item do planner.

### P1. setDate() depende do locale do servidor
O label é produzido por pt-BR, mas Facebook pode renderizar idioma diferente. O mapa atual mostrou português, mas isso deve ser dependência explícita do ambiente, não contrato universal.

### P1. setTime() usa hasText em qualquer option visível
Opções duplicadas ou pertencentes a outro painel podem ser escolhidas. Restringir ao painel ativo.

### P1. openScheduleDirect() aceita qualquer dialog/menu como sucesso
Abrir qualquer role=dialog ou role=menu não prova que o painel de agendamento abriu. Confirmar elementos específicos do agendador.

### P1. waitForComposer() faz reload sem diferenciar causa
Um reload pode mascarar sessão, consentimento ou limitação. Registrar diagnóstico antes/depois.

### P1. start() pode bloquear cinco minutos
FacebookSessionService.start() pode esperar até cinco minutos por login manual. Enquanto isso o HTTP já está aceitando requests, mas o estado operacional do scheduler ainda não está pronto.

Criar estado explícito de startup e impedir operações Facebook concorrentes durante connecting.

### P1. FacebookSessionService não tem lock
start(), refresh() e connect() podem disputar browser/context ao mesmo tempo.

### P1. Cookies não são prova suficiente de sessão funcional
c_user e xs podem existir em sessão expirada/checkpoint. Combinar cookie com sinal funcional autenticado, evitando repetir validações em cada operação.

### P1. getPublications() faz full scan de produtos
Cada consulta de posts carrega todos os affiliate_links. Isso afeta scheduler, quota e dashboard.

### P1. getDashboardStats() faz leituras redundantes
Busca publications e quota, e quota busca publications novamente. Também busca products separadamente.

### P1. Scheduler repete consultas
ensureMonthlySchedule() busca publications e products e depois getQuota(), que repete publications/products indiretamente. Isso aumenta latência e pode produzir snapshots inconsistentes.

### P1. Snapshot inconsistente
Scheduler calcula vagas a partir de um snapshot e depois consulta quota em outro momento. Com concorrência os resultados podem divergir.

### P1. UTC/local misturados
Há America/Sao_Paulo no Scheduler e Date/toISOString no Storage. Isso pode contar posts em dia/mês errado perto da meia-noite.

### P1. Sem transação para reservar slot
Criação de publication e confirmação de slot não são atômicas. Dois processos podem reservar o mesmo produto/slot.

## P2. Dívida de design

### P2. serial() não oferece cancelamento/timeout de fila
Uma operação Facebook travada mantém operações seguintes esperando.

### P2. publish() e publishTest() são stubs
Se o produto decidiu somente agendamento nativo, manter esses métodos cria superfície morta.

### P2. FacebookPublishInput é contrato morto
Existe apenas para operação desativada.

### P2. isGroupPage() exige pathname exatamente igual
Redirecionamentos legítimos do Facebook podem causar falso negativo. Validar identidade do grupo de forma mais robusta.

### P2. group_id e group_url compartilham conceito
mapRowToPublication() usa row.group_id como facebook_group_url. O banco está misturando ID e URL.

Separar facebook_group_id e facebook_group_url.

### P2. mapRowToPublication() mascara affiliate_link_id ausente
Converte ausência em product_id vazio em vez de detectar dado inválido.

### P2. updated_at é derivado de last_attempt_at
São conceitos diferentes.

### P2. mapRowToProduct() fabrica last_scraped_at
Usar created_at quando last_checked_at falta mascara ausência de coleta.

### P2. upsertProduct() pode recursar após conflito
O retry recursivo não tem limite explícito.

### P2. Uso de || para dados numéricos
Ex.: previous_price: product.previous_price || null. Zero é tratado como ausência. Preferir ?? onde zero é válido.

## Segurança / API

### P1. DELETE /publications/failed é destrutivo
Qualquer usuário autenticado parece poder apagar histórico.

### P1. requireAuth é autenticação, não autorização
Não há role check. Settings, scheduler e limpeza podem ficar disponíveis a qualquer usuário autenticado.

### P1. PUT /settings aceita objeto arbitrário
Sem schema para limites, horários, URL, categorias ou modelo.

### P1. POST /publications aceita facebook_group_url arbitrário
Pode criar publicação para grupo diferente do operacional.

### P1. POST /facebook/verify-group aceita URL arbitrária
Restringir ao grupo configurado/allowlist.

### P2. body limit global de 10 MB
Pode ser excessivo para endpoints que não precisam de payload grande.

## Observabilidade

### P1. Falta correlation ID
Scheduler e Facebook usam publication ID em alguns logs, mas não existe execution ID atravessando Scheduler -> Facebook -> Storage.

### P1. Duração somente do fluxo inteiro
Registrar duração por etapa: GROUP, COMPOSER, PREVIEW, SCHEDULE, PLANNER.

### P1. Falha UI sem evidência persistida
Screenshot/HTML sanitizado em falhas de DOM ajudaria a diagnosticar regressões. Nunca persistir cookies/tokens.

## Arquitetura alvo

Separar:
1. queue state: draft/pending/failed/retry
2. Facebook confirmation: not_attempted/attempting/confirmed/uncertain
3. publication state: scheduled/published/cancelled

Não representar os três conceitos apenas por posts.status + error_message.

## Prioridade consolidada

P0:
- DOM composer/editor/readiness;
- stale error/max attempts;
- scheduled somente após confirmação;
- resultado incerto após clique tratado sem duplicação;
- concorrência do scheduler;
- idempotência centralizada.

P1:
- planner verification;
- operational page/lifecycle;
- session locking;
- quota/timezone;
- redução de queries;
- autorização;
- validação de settings/URLs;
- correlation IDs e evidências.

P2:
- tipos únicos;
- remoção de stubs;
- separação group_id/group_url;
- correção de mapeamentos null/timestamps;
- limpeza de backups.

## Veredito

A segunda revisão encontrou problemas além dos selectors. O maior risco agora é consistência de estado: o sistema pode marcar scheduled sem confirmação, duplicar um post depois de confirmação seguida de erro de verificação, executar rotinas concorrentes e apresentar quota diferente do scheduler.

Antes de qualquer nova funcionalidade, o próximo ciclo deve corrigir estado + concorrência + confirmação idempotente, e depois validar novamente o DOM real.
