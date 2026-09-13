# Plano Geral de Manutenção — LDM Bot

## Objetivo

Estabelecer uma única regra de verdade para planejamento, publicação real no Facebook, contagem, deduplicação e exposição pública, eliminando estados ambíguos e evitando que o sistema avance com dados apenas marcados como concluídos.

## Regra operacional de calendário

- O mês parcial inicial termina no último dia do mês corrente.
- O mês parcial inicial não consome a cota mensal de 150 publicações.
- A partir do primeiro mês calendário seguinte, o limite é de 150 publicações por mês.
- O limite diário permanece em 5 publicações.
- O último dia de cada mês é calculado dinamicamente; não existe período fixo de 30 dias.
- O processo continua mês a mês enquanto existirem produtos elegíveis.

## Fases

### Fase 1 — Calendário e quota
- Corrigir o conceito de ciclo mensal para calendário real.
- Tratar o primeiro mês parcial sem consumir a quota mensal.
- Aplicar 150/mês a partir do mês calendário seguinte.
- Manter 5/dia.
- Garantir que a geração percorra corretamente até o último dia do mês.
- Validar contagem de reservas futuras sem ultrapassar a quota mensal.

### Fase 2 — Máquina de estados e integridade
- Revisar todas as transições `draft → attempting/publishing → scheduled/unknown/failed`.
- Garantir que `published` só seja usado com evidência real de publicação.
- Revisar recuperação de `publishing`/`unknown`.
- Impedir que falhas do Facebook deixem registros falsamente confirmados.

### Fase 3 — Deduplicação e contadores
- Auditar identidade de produto, idempotência e slots.
- Impedir duplicação do mesmo produto com as mesmas características.
- Permitir variantes legítimas.
- Unificar contadores de diário/mensal/dashboard com a mesma fonte de verdade.

### Fase 4 — Facebook Planner
- Auditar criação, confirmação e reconciliação dos agendamentos.
- Garantir que um registro `scheduled` corresponda a um agendamento verificável no Planner.
- Preservar a sessão persistente, locks e reconciliação periódica.

### Fase 5 — Sitemap e publicação pública
- Localizar e auditar toda geração de sitemap.
- Sitemap deve conter somente publicações realmente publicadas.
- Excluir `draft`, `scheduled`, `attempting/publishing`, `unknown`, `failed` e registros incertos.
- Exigir URL pública válida e única.
- Deduplicar URLs/entradas.
- Não contar uma publicação como publicada apenas porque foi criada, marcada ou agendada.

### Fase 6 — Crawler, produtos e conteúdo
- Auditar origem dos produtos, identidade, SKU, links e elegibilidade.
- Garantir que preço seja controle interno e não seja publicado no texto.
- Auditar geração/reparo da copy e hashtags/@todos.
- Validar links afiliados e Open Graph.

### Fase 7 — Auditoria ponta a ponta e testes
- Build e testes automatizados.
- Testes de calendário para meses de 28/29/30/31 dias.
- Testes de quota mensal e limite diário.
- Testes de deduplicação.
- Testes de transição de estados.
- Testes de sitemap com mistura de estados.
- Validação controlada no Facebook real.
- Registrar resultado final e critérios de encerramento.

## Regra de execução

Cada fase deve resultar em um commit independente e validável. Não avançar de fase com build/testes quebrados ou com regressões conhecidas. Nenhum commit deve alterar arquitetura, locks, idempotência ou sessão persistente sem justificativa explícita no próprio commit/documentação.
