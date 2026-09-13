# Fase 3 — Simplificação do estado de negócio

## Objetivo

A operação não precisa expor ao usuário uma máquina de estados com `draft`, `scheduled`, `publishing`, `unknown` e `failed` como se fossem estados de negócio diferentes.

A regra de negócio passa a ser binária:

- **Publicado** — o Facebook foi confirmado como publicado.
- **Não publicado** — qualquer situação que ainda não tenha confirmação de publicação.

## Separação de responsabilidades

Os estados técnicos continuam existindo internamente porque o adaptador do Facebook precisa tratar timeout, retry, confirmação do Planner, backoff e idempotência com segurança. Eles não são mais apresentados como estados de negócio.

```text
Crawler
  ↓
Produto + dados + copy
  ↓
NÃO PUBLICADO
  ↓
Scheduler / Facebook
  ↓
confirmação real
  ↓
PUBLICADO
```

## Regra canônica

No domínio da interface:

```ts
published = publication.status === 'published'
not_published = qualquer outro estado
```

Isso evita que uma publicação `scheduled`, `publishing`, `unknown` ou `failed` seja tratada como uma nova categoria de negócio.

## O que mudou nesta rodada

- Criado `PublicationBusinessStatus`.
- Criado `getPublicationBusinessStatus()` como ponto único para a leitura binária.
- Dashboard deixou de exibir `unknown` e `failed` como estados principais.
- Agenda passou a filtrar apenas **Todos / Não publicados / Publicados**.
- Detalhes técnicos continuam disponíveis na linha da publicação para diagnóstico e retry.
- A proteção contra duplicidade e a confirmação do Facebook continuam preservadas.

## O que não foi removido

Não removemos os estados técnicos do backend nesta rodada. Isso seria arriscado porque eles participam de idempotência, reconciliação e retry seguro. A simplificação foi feita na camada de negócio/UX sem destruir a proteção operacional.

## Critério de sucesso

O operador deve conseguir responder apenas duas perguntas:

1. Quantos estão publicados?
2. Quantos ainda não estão publicados?

Os detalhes de como o Facebook chegou ao estado atual ficam abaixo dessa camada.
