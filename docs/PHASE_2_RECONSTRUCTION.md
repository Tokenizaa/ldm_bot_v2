# Fase 2 — Reconstrução Técnica

## Objetivo

Eliminar o acúmulo de correções conflitantes do fluxo Facebook sem voltar a um commit histórico específico e sem usar tentativa e erro para descobrir comportamento.

A reconstrução usa como contratos: `docs/FACEBOOK_SCHEDULING_FLOW.md`, `FACEBOOK_DIRECT_SCHEDULE_MAP.md`, as implementações comprovadas distribuídas no histórico e as dependências reais do código atual.

## Decisão arquitetural

O fluxo Facebook será tratado como uma única operação determinística, com etapas explícitas e responsabilidades separadas:

```text
RuntimeScheduler
      |
      | dados completos do produto + data/hora
      v
FacebookAutomation
      |
      +-- Session: sessão autenticada / página operacional
      +-- Group: grupo canônico pronto
      +-- Composer: abrir compositor canônico
      +-- Content: inserir copy + URL
      +-- TokenActivation: ativar @todos e hashtags após estabilidade
      +-- Preview: confirmar preview do link
      +-- PlannerDialog: Programar post -> data -> hora
      +-- Confirmation: clicar Programar
      +-- Verification: verificação opcional no Planner
```

## Contrato canônico

A ordem não será alterada:

1. Sessão autenticada.
2. Página operacional única no grupo alvo.
3. Composer canônico.
4. Dialog `Criar post`.
5. Editor do composer.
6. Copy existente e validada.
7. Ativação de `@todos` e hashtags com espera de estabilidade + Enter.
8. URL afiliada canônica e preview.
9. `Programar post` dentro do composer.
10. Data pelo `gridcell` acessível do dialog de programação.
11. Hora pelo `role=option` do dialog de programação.
12. `Programar` para confirmar.
13. Verificação no Planner somente conforme política definida; não participa da criação do post.

## O que será removido da implementação Facebook

- Seletores acumulados sem evidência no mapa canônico.
- Fallbacks genéricos de elementos Facebook.
- Recuperação automática que mascara a etapa real da falha.
- Lógica de publicação imediata dentro do fluxo de agendamento.
- Responsabilidades de scheduler/runtime dentro do serviço Facebook.
- Dependências de detalhes internos de erro no `RuntimeSchedulerService`.
- Compatibilidade criada apenas para compensar métodos removidos, quando o contrato real puder ser corrigido no ponto de chamada sem duplicar comportamento.

## O que será preservado

- Sessão persistente e página operacional única.
- Seletores e sequência registrados no mapa canônico.
- Espera de 1200 ms antes do Enter de ativação de tokens.
- Preservação do formato da copy.
- URL afiliada canônica.
- Preview do link antes de abrir a programação.
- Programação via interface visível do Facebook, sem endpoints privados.
- Verificação do Planner como confirmação externa.
- Execução serial para impedir duas interações simultâneas na mesma página.

## Scheduler após reconstrução

O scheduler não será responsável por conhecer erros internos do Facebook.

O estado persistente continua sendo somente o catálogo de produtos. O scheduler mantém apenas estado operacional transitório necessário para a execução atual. O modelo antigo de `Publication` não será usado como fonte de verdade nem tratado como histórico persistente.

O contrato entre scheduler e Facebook será essencialmente:

```ts
schedule({
  groupUrl,
  content,
  affiliateUrl,
  scheduledDate,
  scheduledTime,
  productName,
  sku,
}): Promise<FacebookScheduleResult>
```

O resultado informa sucesso ou falha da operação, inclusive quando a confirmação externa for incerta. O scheduler não precisa interpretar uma lista de erros estruturais internos.

## Regra de falha

Cada etapa deve falhar explicitamente com um erro de domínio estável. Não haverá fallback silencioso para outra implementação do mesmo comportamento.

Uma falha estrutural interrompe o ciclo atual em vez de avançar tentando outra sequência Facebook.

## Estratégia de implementação da Fase 3

A implementação deverá substituir o acúmulo atual por código legível e pequeno, preservando os contratos externos realmente utilizados. Não será feita edição incremental de seletores no serviço atual.

Antes do commit da Fase 3, o código deverá passar por verificação estática das referências e compilação TypeScript. A validação de navegador pertence à Fase 4.

## Fora de escopo

- Crawler.
- Modelo de dados de produtos.
- Conteúdo já armazenado no catálogo.
- Geração de copy.
- Alterações no banco.
- Novos endpoints Facebook.
- Redis/BullMQ.
- Mudança do mapa canônico.
