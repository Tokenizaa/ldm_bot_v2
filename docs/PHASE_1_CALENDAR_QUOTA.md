# Fase 1 — Calendário e Quota

## Execução iniciada

A auditoria confirmou que o problema está no `SchedulerService`: a rotina atual usa `settings.monthly_limit` diretamente contra o mês corrente e, portanto, trata setembro como consumidor da cota de 150. Ela também percorre o mês corrente corretamente até `monthDates(year, month)`, mas a regra de negócio do primeiro mês parcial ainda não existe.

## Regra implementada como alvo da fase

1. O mês inicial parcial é o mês calendário em que o ciclo começa após o dia 1.
2. O mês inicial parcial deve ser preenchido apenas até o último dia do mês.
3. Nesse mês inicial, a cota mensal de 150 não bloqueia o preenchimento.
4. O limite diário continua sendo 5.
5. No mês calendário seguinte, a cota de 150 passa a valer normalmente.
6. Cada mês seguinte é tratado independentemente, sem janela fixa de 30 dias.
7. O cálculo do último dia continua dinâmico por calendário, incluindo fevereiro em anos bissextos.
8. Reservas `scheduled` continuam contando contra a quota do mês quando a quota estiver ativa, evitando overbooking.
9. Produtos já ativos (`scheduled`, `published`, `attempting`, `unknown`) continuam reservados e não podem ser escolhidos novamente.

## Matriz de validação

| Caso | Resultado esperado |
|---|---|
| 13/09/2026 → 30/09/2026 | Pode preencher slots futuros até 30/09 sem consumir o teto de 150 |
| 01/10/2026 | Quota de 150 passa a valer |
| Outubro com 31 dias | Máximo 150, apesar de existirem 155 slots de 5/dia |
| Novembro | Novo teto independente de outubro |
| Fevereiro não bissexto | Último dia 28 |
| Fevereiro bissexto | Último dia 29 |
| Abril/Junho/Setembro/Novembro | Último dia 30 |
| Janeiro/Março/Maio/Julho/Agosto/Outubro/Dezembro | Último dia 31 |
| Produto já `scheduled` | Não selecionar novamente |
| Produto `attempting`/`unknown` futuro | Não selecionar novamente |
| Slot já reservado | Não criar duplicação de horário |

## Critério de encerramento da Fase 1

- Não existir período fixo `11/09 → 10/10` ou equivalente.
- O primeiro mês parcial não bloquear por 150.
- A partir do mês seguinte, 150 ser aplicado por mês calendário.
- 5/dia permanecer invariável.
- O algoritmo continuar avançando para o mês seguinte quando a data do sistema mudar.
- Build/lint passar.
- A implementação não alterar locks, pacing, idempotência, sessão persistente ou reconciliação do Planner.

## Observação

Esta fase é deliberadamente isolada da revisão do sitemap e da máquina de estados. Essas correções permanecem nas fases seguintes para que cada mudança tenha um commit verificável e seja fácil identificar regressões.
