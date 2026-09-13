# Facebook Scheduling Optimization — Plano de Ação

## Objetivo

Deixar o fluxo de agendamento do Facebook mais dinâmico e eficiente sem trocar o Playwright, sem alterar o fluxo nativo do Facebook e sem reduzir as proteções contra duplicidade, estado incerto ou falhas de confirmação.

O Crawler está fora deste escopo.

## Princípios obrigatórios

- Playwright continua sendo a camada de execução do Facebook.
- Reutilizar o perfil persistente e a página operacional existentes.
- Não introduzir chamadas HTTP privadas, endpoints internos do Facebook ou automação fora da interface nativa.
- Não remover lock, serialização, idempotência, pre-check de `unknown`, retries seguros ou confirmação no planner.
- Não adicionar sleeps espalhados pelo fluxo.
- Esperas internas devem ser orientadas a estado/evento.
- A única espera deliberadamente temporal é o pacing entre agendamentos, que deve ser variável e centralizado.
- Nenhuma alteração no contrato de data/hora ou nos seletores canônicos documentados.

## Fase 1 — Pacing humano variável

Arquivo: `server/services/SchedulerService.ts`

Substituir o intervalo rígido `minScheduleGapMs = 15000` por um pacing centralizado e variável, com distribuição centrada aproximadamente em 15 segundos e limites conservadores de aproximadamente 10–22 segundos.

Regras:

- O primeiro agendamento não deve esperar.
- O intervalo só é aplicado entre operações reais de agendamento.
- O tempo efetivamente esperado deve ser registrado em log.
- Não usar um valor aleatório uniforme simples que produza comportamento artificial.
- Não remover o pacing.
- Não alterar o lock do scheduler.

Log esperado:

`SCHEDULE_PACING_WAIT elapsed=<ms> target=<ms> remaining=<ms>`

## Fase 2 — Ativação dinâmica de hashtags

Arquivo: `server/services/FacebookAutomationService.ts`

Eliminar o `600ms + Enter + 300ms` fixo por hashtag.

Novo comportamento:

1. Digitar a hashtag.
2. Observar rapidamente o DOM do editor para detectar que o Facebook processou/ativou o token.
3. Se o estado aparecer, confirmar imediatamente com `Enter`.
4. Se não houver sinal observável dentro de um pequeno timeout, usar um fallback curto e limitado antes do `Enter`.
5. Após o `Enter`, aguardar o estado resultante, não um sleep fixo.

O mecanismo de `@todos` que já funciona deve permanecer essencialmente intacto.

## Fase 3 — Preview OG com fast path

Arquivo: `server/services/FacebookAutomationService.ts`

Manter o preview como etapa não bloqueante para o sucesso do agendamento, mas reduzir a janela de espera desnecessária.

Comportamento desejado:

- Se o preview aparecer rapidamente, continuar imediatamente.
- Se não aparecer dentro de uma janela curta e segura, registrar timeout e continuar.
- Não fazer nova escrita do composer.
- Não tentar manipular o preview por endpoints externos.
- Não transformar ausência do preview em sucesso falso de confirmação: a confirmação continua sendo o fluxo nativo + planner quando aplicável.

## Fase 4 — Auditoria de waits

Revisar apenas o fluxo de agendamento para classificar cada espera em:

- **Estado real:** manter.
- **Timeout de segurança:** manter, mas calibrar.
- **Sleep artificial:** remover/substituir.
- **Pacing humano:** manter centralizado no scheduler.

Não reduzir cegamente todos os timeouts de Playwright. Um timeout de `waitFor` não significa que o processo sempre espera aquele período.

## Fase 5 — Validação

Antes de considerar concluído:

- TypeScript/build/lint do projeto.
- Testes existentes.
- Teste real com um agendamento controlado.
- Verificar logs de pacing.
- Verificar ativação de `@todos`.
- Verificar ativação das hashtags.
- Verificar preview quando disponível.
- Verificar seleção de data/hora.
- Verificar confirmação nativa.
- Verificar `/scheduled_posts` quando a verificação periódica ocorrer.
- Confirmar que um estado `unknown` continua bloqueando retry cego.
- Confirmar que nenhum agendamento duplicado é criado.

## Critério de sucesso

O fluxo deve terminar mais rápido quando o Facebook responde rápido, mas nunca porque removemos uma confirmação necessária.

Em resumo:

> **Esperar o Facebook mudar de estado; não esperar o relógio.**
>
> **Exceção: pacing entre agendamentos, que permanece variável e deliberado.**
