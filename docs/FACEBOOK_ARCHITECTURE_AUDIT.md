# Auditoria arquitetural — LDM Bot v2

Data: 2026-09-11
Escopo: server.ts, SchedulerService, FacebookSessionService, FacebookBrowserService, FacebookAutomationService, StorageService, types e api.ts.

## Veredito

O fluxo possui complexidade desnecessária e alguns defeitos de estado. Os P0 atuais são: trigger do composer incompatível com o DOM real, editor Lexical incorreto, readiness do grupo baseada em shell React, falso structuralFailure por erro histórico, controle de attempts frágil e idempotência duplicada.

## P0 — FacebookAutomationService

1. Composer atual usa apenas aria-labels. O diagnóstico real mostrou role=button com texto “Escreva algo...” e sem aria-label.
2. O selector anterior com :text('A|B|C') também era incorreto: | não cria OR nesse formato.
3. O editor atual procura dialog + role=textbox. O editor real é Lexical contenteditable.
4. openComposer acopla a confirmação do modal ao selector incorreto do editor.
5. waitForGroupReady considera main.count()>0 como página pronta. Um shell React vazio satisfaz isso.
6. goto/reload usa domcontentloaded, que não significa hidratação funcional.
7. Preview é detectado por heurística de palavras/imagem; deve usar evidência DOM real.
8. Planner é verificado por substring da copy; é frágil.

Correção canônica: role button + nome do composer; editor Lexical por data-lexical-editor/contenteditable; modal confirmado separadamente; readiness baseado em sinais funcionais; cada etapa deve ter evidência observável.

## P0 — SchedulerService

1. schedulePublication pode retornar uma publicação já failed quando max_attempts foi atingido.
2. ensureMonthlySchedule depois lê error_message dessa publicação e interpreta erro antigo como falha estrutural desta rodada.
3. Isso explica o log MONTHLY_DONE halted=FACEBOOK_COMPOSER_NOT_AVAILABLE mesmo quando nenhum novo attempt Facebook ocorreu.
4. O scheduler deve distinguir “não executado por limite” de “executado e falhou”.
5. attempts deve ser normalizado e nunca enviado negativo ao banco.
6. Idempotência deve usar uma função única e normalizada.
7. candidateIndex é avançado antes da confirmação e pode consumir produto após falha.
8. Scheduler usa scheduled + published para reserva, mas Storage quota não usa a mesma semântica.

## P0 — StorageService

1. updatePublication aceita attempts arbitrário e grava diretamente.
2. createPublication gera idempotency_key com URL sem normalização.
3. getQuota considera principalmente published, enquanto scheduler reserva scheduled + published.
4. getQuota usa datas UTC enquanto scheduler usa America/Sao_Paulo.
5. createPublication permite status scheduled antes de confirmação Facebook.
6. getPublications carrega todos os produtos para mapear posts, criando custo desnecessário.
7. getPublicationById gera consulta adicional do produto.
8. isSupabaseActive sempre retorna true e não acrescenta informação.
9. A constraint posts_attempts_nonnegative_ck está correta; o código deve respeitá-la.

## P1 — FacebookBrowserService

1. context.pages()[0] não é uma seleção determinística da página operacional.
2. Uma aba restaurada como about:blank pode virar a página escolhida.
3. headless está fixado em false e ignora FACEBOOK_HEADLESS.
4. Não há shutdown coordenado em SIGINT/SIGTERM.
5. Fechar todas as páginas extras pode interferir no usuário se o perfil persistente for compartilhado.

Modelo recomendado: manter uma referência operacional única. Se ela fechou, selecionar uma página Facebook existente; se não existir, criar uma única página. Não usar pages[0] cegamente.

## P1 — FacebookSessionService

Há verificações redundantes: start verifica cookies/login, refresh verifica cookies novamente e schedule chama requireAuthenticated antes de obter a página. A sessão deve ter uma responsabilidade clara: garantir autenticação; a automação não deve repetir validações desnecessárias.

## P1 — server.ts

Está simples e corretamente não conhece selectors Facebook. Falta lifecycle explícito para SIGINT/SIGTERM fechar o browser persistente. Não adicionar lógica Facebook aqui.

## P1 — api.ts

1. publish-now, reschedule e cancel são endpoints sem operação real.
2. POST /publications pode criar status scheduled sem confirmação Facebook.
3. DELETE /publications/failed apaga histórico; para operação seria melhor resetar/arquivar.
4. req.user usa any.
5. endpoint de schema não pertence ao caminho operacional Facebook.

## P2 — Tipos

server/types.ts e src/types.ts duplicam contratos. Eles já divergiram: o server aceita connecting no status de Facebook e o src não; o server possui campos adicionais. Manter uma única definição compartilhada.

## P2 — Configuração

Existe histórico de duas chaves system_config: app_settings e main. O código atual lê app_settings. Não migrar automaticamente antes de identificar dependências. Definir uma fonte operacional única.

## P2 — Backups

Arquivos .backup fora do Git não participam do build, mas geram confusão e podem preservar código antigo. Remover depois do fluxo verde.

## Arquitetura alvo

server.ts
  -> SchedulerService
  -> FacebookAutomationService
  -> FacebookBrowserService

FacebookSessionService: autenticação/estado.
StorageService: persistência.
Não criar outro serviço Facebook.

## Máquina de estados recomendada

GROUP_NAVIGATE
GROUP_HYDRATED
COMPOSER_FOUND
COMPOSER_CLICKED
COMPOSER_DIALOG_OPEN
EDITOR_FOUND
COPY_FILLED
PREVIEW_CONFIRMED
SCHEDULE_BUTTON_FOUND
SCHEDULE_PANEL_OPEN
DATE_SELECTED
TIME_SELECTED
SCHEDULE_CONFIRMED
PLANNER_VERIFIED

Cada transição precisa de evidência real. Timeout não deve ser tratado como confirmação.

## Ordem de correção

P0:
1. Composer real.
2. Editor Lexical.
3. Abertura do modal.
4. Readiness do grupo.
5. Scheduler sem erro stale.
6. Attempts e idempotência.

P1:
7. Página operacional determinística.
8. Shutdown.
9. Quota/timezone.
10. Semântica draft versus scheduled.

P2:
11. Tipos únicos.
12. Remoção de endpoints mortos.
13. Limpeza de backups.
14. Consolidação de configuração.

## Conclusão

O próximo passo não é adicionar mais fallbacks. É reduzir heurísticas e alinhar o código ao DOM real já mapeado.

Regra: um browser, um context, uma page operacional, um fluxo Facebook e confirmação real antes de marcar scheduled.
