# Fase 5 — Reconciliação com Facebook Planner

## Objetivo

Garantir que o estado local nunca seja tratado como prova de que o Facebook realmente recebeu ou manteve um agendamento.

Regra:

> **Banco registra intenção/estado técnico. Facebook Planner confirma o agendamento real.**

## Diagnóstico inicial

No início da fase havia:

- 77 registros em `posts`.
- 36 `scheduled`.
- 16 `publishing`.
- 23 `draft`.
- 2 `failed`.
- 0 `published`.

Havia registros `scheduled` com horário já passado e registros `publishing` antigos, portanto não era seguro assumir que esses estados correspondiam ao Facebook.

## Execução de saneamento

A migração `phase_5_mark_unverified_publications_unknown` foi aplicada no Supabase.

Ela moveu para o estado técnico `unknown` — representado no schema atual por `status='draft'` + `post_type='unknown'` — somente:

1. registros presos em `publishing`;
2. registros `scheduled` cujo horário já havia passado.

Nenhum registro foi convertido em `published`.
Nenhum agendamento futuro confirmado foi alterado.
Nenhuma publicação foi apagada.

## Estado após saneamento

- 25 `draft + unknown`: aguardando confirmação no Planner.
- 16 `draft` normais.
- 2 `failed`.
- 34 `scheduled` futuros.
- 0 `published`.

## Implementação existente validada no código

`FacebookAutomationService` já possui verificação via página nativa:

`/groups/tokeniza/scheduled_posts`

O fluxo real documentado é:

`Composer → Programar post → Data → Hora → Programar → /scheduled_posts`

A confirmação periódica também já existe após múltiplos agendamentos e a reconciliação próxima verifica registros `scheduled` antes de assumir que continuam válidos.

## Ponto crítico encontrado

A verificação do Planner retorna `found` e `verified`, mas alguns fluxos do `SchedulerService` consomem somente `found`.

Isso precisa ser tratado antes de considerar a fase concluída:

- `verified=false` nunca pode ser interpretado como "ausente";
- `unknown` só pode voltar para `draft` normal quando a ausência tiver sido efetivamente verificada no Planner;
- erro, timeout, página vazia ou sessão inválida devem manter o registro como `unknown`;
- retry só pode ocorrer depois de uma verificação negativa confiável.

## Validação real pendente

A confirmação final exige acesso ao navegador persistente autenticado do Facebook e inspeção visual/Playwright do Planner real. Esse ambiente de sessão não está exposto neste executor atual, portanto não foi fabricada uma confirmação de Facebook que não pudesse ser observada.

O que foi efetivamente validado nesta rodada:

- estado do banco;
- estados técnicos e registros suspeitos;
- fluxo Playwright documentado;
- existência da rotina de consulta ao Planner;
- proteção contra retry cego de `unknown` quando a consulta falha;
- preservação de registros e ausência de publicação artificial.

## Critério para concluir a Fase 5

1. Corrigir o consumo de `verified` nos fluxos do Scheduler.
2. Abrir o Planner real com a sessão persistente.
3. Reconciliar individualmente os 25 `unknown`.
4. Confirmar os 34 `scheduled` futuros dentro da janela de reconciliação.
5. Recriar somente os registros comprovadamente ausentes.
6. Confirmar pelo menos um agendamento real controlado ponta a ponta.
7. Registrar evidência do Planner antes de marcar a fase como concluída.

**Status: em execução — saneamento concluído; validação real no Facebook Planner ainda pendente.**
