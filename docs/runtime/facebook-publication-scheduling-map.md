# Mapeamento Canônico — Publicação e Agendamento Facebook

> **Fonte canônica atual:** `FACEBOOK_DIRECT_SCHEDULE_MAP.md`
>
> Este documento substitui o fluxo antigo que passava por **Mais opções**.

## Ambiente

- Repositório: `Tokenizaa/ldm_bot_v2`
- Grupo: A Loja Do Mecânico
- URL: `https://www.facebook.com/groups/tokeniza/`
- Perfil persistente: `data/browser-profiles/facebook`
- Sessão: reutilizar a sessão autenticada existente.
- Não criar browser/contexto paralelo.
- Não fazer login automatizado.
- Não limpar cookies/storage.

## Fluxo canônico atual

```
Grupo
  ↓
Escreva algo...
  ↓
Criar post
  ↓
Preencher conteúdo
  ↓
Programar post   ← botão direto no composer
  ↓
Data
  ↓
Hora
  ↓
Programar
  ↓
Verificar /scheduled_posts
```

### Regra crítica

**NÃO clicar em `Mais opções`.**

O Facebook atual apresenta o botão de agendamento diretamente no rodapé do composer, ao lado do botão de publicação.

## Selectors comprovados

| Etapa | Selector comprovado |
|---|---|
| Abrir composer | `[aria-label='Escreva algo...']` |
| Dialog | `[role='dialog'][aria-label='Criar post']` |
| Conteúdo | `div[role='dialog'][aria-label='Criar post'] [role='textbox']` |
| Programar direto | `[aria-label='Programar post']` |
| Publicar (referência) | `[aria-label='Postar']` |
| Data | `[role='gridcell']` com accessible name da data |
| Hora | `[role='option']` com accessible name `HH:mm` |
| Confirmar | `[aria-label='Programar']` |

## Relação dos botões

No DOM real observado:

- `Programar post` = botão de agendamento direto, somente ícone.
- `Postar` = botão de publicação imediata.
- Os dois ficam no mesmo rodapé do composer.
- Não existe menu intermediário entre eles.
- **Mais opções não participa do fluxo.**

## Data

A data é selecionada pela célula real do calendário:

```
[role='gridcell']
```

A automação deve localizar a célula pelo accessible name correspondente à data desejada, por exemplo:

```
12 de setembro de 2026
```

Formato interno da aplicação:

```
YYYY-MM-DD
```

## Hora

O horário é selecionado pela opção real apresentada pelo Facebook:

```
[role='option']
```

Exemplo:

```
10:30
```

Formato interno:

```
HH:mm
```

## Confirmação

Após data e hora:

1. localizar `[aria-label='Programar']`;
2. verificar que está habilitado;
3. clicar;
4. aguardar fechamento/retorno do composer;
5. acessar `/scheduled_posts`;
6. confirmar que a publicação aparece.

## Resultado comprovado pelo mapeamento direto

O teste real executado pelo MCP Playwright confirmou:

- sessão existente reutilizada;
- grupo acessível;
- composer aberto;
- conteúdo preenchido;
- **Programar post clicado diretamente**;
- data selecionada;
- hora selecionada;
- confirmação `Programar`;
- publicação encontrada em `/scheduled_posts`.

## Código canônico

O código Playwright capturado no mapeamento está registrado em:

`FACEBOOK_DIRECT_SCHEDULE_MAP.md`

Esse arquivo deve ser tratado como referência primária para alterações futuras do executor Facebook.

## Proibições

Não reintroduzir:

- `Mais opções`;
- `Mais opções de post`;
- `Programar post` como item de menu;
- `input[type="date"]` como contrato do fluxo;
- `input[type="time"]` como contrato do fluxo;
- selectors baseados em classes CSS geradas;
- segundo browser/contexto;
- novo login;
- reset do perfil.

## Estado

O fluxo de agendamento deve ser considerado:

**Composer → Programar post → Data → Hora → Programar**

Qualquer implementação diferente deste fluxo está divergente da evidência real e deve ser corrigida antes de novos testes.
