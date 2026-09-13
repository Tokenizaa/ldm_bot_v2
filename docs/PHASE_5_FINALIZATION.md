# Fase 5 — Finalização da arquitetura Product Catalog First

## Resultado

A Fase 5 foi finalizada no código com a arquitetura operacional reduzida para:

```text
CRAWLER
  ↓
PRODUCT CATALOG (affiliate_links)
  ↓
RUNTIME SCHEDULER
  ↓
FACEBOOK / PLANNER
```

O banco não é mais usado como fila, histórico ou máquina de estados de publicação.

## Banco validado

No projeto Supabase `xtjujzjkabffeenhxsib`:

| Tabela | Registros |
|---|---:|
| `affiliate_links` | 268 |
| `posts` | 0 |
| `publication_history` | 0 |
| `monthly_plans` | 0 |
| `affiliate_price_history` | 0 |
| `crawler_logs` | 0 |
| `system_config` | 0 |

Os 268 produtos possuem identidade, nome, categoria, marca, URL original, URL afiliada e Facebook copy preenchidos.

Os 268 links afiliados seguem o padrão canônico configurado para o projeto.

## Mudanças finais

### Scheduler runtime-only

Foi criado `server/services/RuntimeSchedulerService.ts`.

Estado de publicação agora vive somente em memória:

- produto usado;
- slot usado;
- status da tentativa;
- URL do Planner quando confirmada;
- resultado de uma execução.

O scheduler não cria `posts`, `publication_history` ou `monthly_plans`.

Reiniciar a aplicação limpa o estado operacional local e inicia novamente a partir do catálogo, usando o Planner do Facebook como confirmação externa para evitar duplicidade.

### Boot

`server.ts` agora inicializa o scheduler runtime-only. O startup não dispara automaticamente a criação de registros de publicação no banco.

### API

As rotas de publicação foram direcionadas para o scheduler runtime-only.

`GET /api/publications` retorna apenas o estado da execução atual.

Criação, programação, retry, reconciliação e reschedule não persistem publicação no Supabase.

### Storage safety boundary

`CatalogOnlyStorageGuard` foi adicionado para bloquear gravações operacionais legadas no processo ativo.

O histórico de preço legado é neutralizado para que o crawler continue atualizando o catálogo sem recriar `affiliate_price_history`.

Os caminhos legados de criação/alteração/remoção de publicação são bloqueados.

O script `scripts/scrape-150.ts` também instala o mesmo guard.

## Segurança de publicação

O scheduler exige:

- produto ativo;
- preço válido;
- URL original HTTP(S);
- URL afiliada válida;
- Facebook copy existente;
- copy aprovada pelo `ContentService`;
- pre-check do Facebook Planner antes do envio.

Uma confirmação incerta não é repetida automaticamente.

O scheduler mantém espaçamento de 10–22 segundos entre operações de agendamento.

## Validação

A validação Supabase confirmou o estado catalog-only após as alterações.

O status Vercel continua `failure`, porém isso já ocorria no commit anterior à rodada de fechamento (`fd179e0777908b40fb69012738df6c28849fbb61`), portanto não foi possível usar o check Vercel como evidência de regressão desta rodada. A conexão Vercel disponível não expõe o projeto `ldm-bot-v2` para inspeção dos logs de build.

Não foi executado agendamento real no Facebook durante esta rodada, para não criar publicações reais enquanto o fechamento estrutural estava sendo validado.

## Critério de encerramento

A arquitetura da Fase 5 está encerrada no código e no banco: **catálogo persistente, operação de publicação volátil, Facebook Planner como confirmação externa**.

A próxima etapa deve ser uma rodada independente de auditoria/produção, incluindo build executável, validação E2E e uma execução real controlada no Facebook.
