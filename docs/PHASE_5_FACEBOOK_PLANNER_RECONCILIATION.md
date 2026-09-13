# Fase 5 — Reconciliação com Facebook Planner

## Objetivo

Garantir que o estado local nunca seja tratado como prova de que o Facebook realmente recebeu ou manteve um agendamento.

> **Banco registra intenção/estado técnico. Facebook Planner confirma o agendamento real.**

## Saneamento executado

No início da fase havia 77 registros: 36 `scheduled`, 16 `publishing`, 23 `draft`, 2 `failed` e 0 `published`.

Foi aplicada a migration `phase_5_mark_unverified_publications_unknown` para retirar do estado de agendamento confirmado os registros presos em `publishing` e os `scheduled` já vencidos.

Estado resultante:

- 25 `draft + unknown`: registros que exigem reconciliação com o Planner;
- 16 `draft` normais;
- 2 `failed`;
- 34 `scheduled` futuros;
- 0 `published`.

Nenhuma publicação foi artificialmente marcada como publicada e nenhum registro potencialmente real foi apagado.

## Correção crítica implementada

O `FacebookAutomationService` passou a tratar `found` e `verified` separadamente.

Regra implementada:

- `verified=true + found=true` → confirmação positiva;
- `verified=true + found=false` → ausência confirmada;
- `verified=false` → Planner não validado, portanto erro/incerteza;
- timeout, página vazia, sessão inválida ou falha de navegação → nunca significa ausência.

`checkScheduledPost()` agora lança `FACEBOOK_PLANNER_UNVERIFIED` quando a página do Planner não pôde ser validada. Isso impede que o Scheduler transforme uma falha de consulta em `draft` e faça um retry cego.

## Fluxo Facebook validado no código

`Composer → Programar post → Data → Hora → Programar → /scheduled_posts`

O mapa real do Facebook usa diretamente o botão `Programar post`, sem o antigo menu intermediário. O Planner é acessado pela URL nativa `/groups/tokeniza/scheduled_posts`.

## Evidências e limite operacional

O executor desta rodada possui acesso ao GitHub e ao Supabase, mas não possui a sessão persistente autenticada do navegador Facebook (`data/browser-profiles/facebook`) nem um processo Playwright operacional conectado a essa sessão.

Por isso, **não é possível afirmar honestamente que os 25 `unknown` e os 34 `scheduled` foram conferidos visualmente no Planner nesta rodada**.

Isso é uma limitação de execução, não uma decisão de arquitetura: a aplicação agora está preparada para não tratar falha de consulta como ausência.

## Critério operacional restante

A única validação externa ainda necessária para declarar a fase 100% fechada é executar, com a sessão Facebook autenticada:

1. abrir `/groups/tokeniza/scheduled_posts`;
2. localizar os 25 registros `unknown` individualmente;
3. localizar os 34 `scheduled` futuros dentro da janela relevante;
4. reconciliar por conteúdo/produto e horário;
5. somente para ausência comprovada, retornar o registro para `draft` e permitir novo agendamento;
6. realizar um agendamento controlado e confirmar sua presença no Planner.

## Status

**Implementação e saneamento da Fase 5: concluídos.**

**Validação visual externa no Facebook Planner: pendente por indisponibilidade da sessão autenticada neste executor.**

Não foi criado nenhum estado `published` artificial para mascarar essa limitação.
