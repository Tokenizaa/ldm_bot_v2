# Loja do Mecânico — Documento Canônico do Crawler

**Fonte:** mapeamento do site real com MCP Playwright + validação HTTP/Cheerio.
**Uso:** referência oficial para o crawler de produção.

## 1. Rotas canônicas observadas

- Home: `https://www.lojadomecanico.com.br/`
- Subcategoria: `https://www.lojadomecanico.com.br/subcategorias/21/224/serra-eletrica`
- Outra subcategoria observada: `/subcategorias/21/227/lixadeira-e-politriz`
- Outra subcategoria observada: `/subcategorias/11/481/equipamento-hidraulico`
- Hotsite: `/hotsite/auto-mecanica`
- Hotsite: `/hotsite/ate-799`

Rotas antigas `/categoria/...` foram observadas no código/configuração legado e retornam 404; não são sementes válidas para o crawler atual.

## 2. Descoberta de produtos

A listagem contém links HTML `a[href]` para produtos reais no formato:

`https://www.lojadomecanico.com.br/produto/<id>/<...>/<slug>`

A descoberta deve:

1. carregar o HTML da listagem via HTTP;
2. parsear com Cheerio;
3. iterar `a[href]`;
4. resolver URLs relativas contra o domínio da Loja do Mecânico;
5. aceitar somente URLs HTTPS do host `www.lojadomecanico.com.br` cujo pathname comece por `/produto/<número>`;
6. normalizar removendo query, fragmento e `/` final.

**Não usar regex sobre o HTML bruto para fabricar URLs.** Isso pode incorporar entidades HTML ou JSON ao slug.

## 3. Paginação

A paginação observada em subcategoria produz URLs reais como:

`/subcategorias/21/224/V/0/2/serra-eletrica`

O crawler pode descobrir páginas seguintes a partir dos links HTML, desde que o link resolvido continue pertencendo às rotas canônicas `/subcategorias/*` ou `/hotsite/*`.

URLs `localhost` não fazem parte do site real e nunca devem entrar na fila.

## 4. HTTP

Testes de acesso mostraram comportamento diferente conforme o cliente/headers. Um `fetch` Node com headers semelhantes aos de um navegador conseguiu receber HTML real da listagem, enquanto requisições simples podem ser desafiadas pelo Radware Bot Manager.

O crawler de produção permanece HTTP + Cheerio. Playwright/MCP é ferramenta de investigação, não o mecanismo de coleta dos 150 produtos.

Headers mínimos esperados no cliente HTTP:

- User-Agent de navegador Chrome atual;
- Accept de documento HTML;
- Accept-Language `pt-BR`;
- headers de navegação (`Sec-Fetch-*`, quando suportados);
- Referer da própria Loja do Mecânico.

`networkidle` não é requisito para a coleta HTTP.

## 5. Página individual

A página de produto deve ser validada pelo HTML recebido. O crawler prioriza JSON-LD `application/ld+json` com `@type: Product` e `offers.price`, usando DOM/meta como fallback.

Campos canônicos relevantes:

- nome;
- preço atual;
- marca;
- SKU/MPN/productId;
- imagem;
- categoria;
- URL do produto.

## 6. Canonical e OpenGraph

A página individual deve ser tratada com três conceitos separados:

- **original_url:** URL canônica/original do produto, sem `/20889`;
- **affiliate_url:** URL destinada à divulgação afiliada;
- **OG/canonical:** metadados da página original que devem ser investigados/validados quando o objetivo for preview social.

O crawler não deve substituir a URL original por uma URL de afiliado.

## 7. URL de afiliado para publicação no Facebook

A URL final de publicação usa os dois identificadores fornecidos pelo programa de afiliados:

- `AFFILIATE_ID=20889`;
- `AFFILIATE_GLOBAL_CODE=0S7w4Sy5S12oCKmeTo3Z3g==`.

Formato canônico:

`<original_url>/20889?afiliado=0S7w4Sy5S12oCKmeTo3Z3g==`

Exemplo real validado:

`https://www.lojadomecanico.com.br/produto/183851/21/223/parafusadeira-furadeira-de-impacto-brushless-12-pol-20v-com-2-baterias-carregador-e-maleta-dewalt-dcd7781d2-br/20889?afiliado=0S7w4Sy5S12oCKmeTo3Z3g==`

A investigação comparou essa forma com a URL oficial contendo `utm_campaign`, `utm_source` e `utm_medium`. A forma `?afiliado=` foi escolhida para a publicação no Facebook porque foi a forma observada funcionando no card/preview do Facebook, enquanto a URL oficial com UTMs apresentou falha de card no teste manual.

O builder centralizado é `server/utils/affiliate.ts` e é idempotente. Ele aceita URL original, URL com `/20889` ou URL com UTMs e sempre produz uma única URL canônica.

Nunca produzir:

- `/20889/20889`;
- `?utm_campaign=...` na URL final publicada;
- `?utm_source=...` na URL final publicada;
- `?utm_medium=...` na URL final publicada;
- fragmento;
- parâmetros `afiliado` duplicados.

A atribuição de uma comissão por compra real não está comprovada por transação; o comportamento validado é o tracking/URL e o preview do Facebook.

## 8. Regras de produção

- Meta por execução: **150 produtos reais por lote**.
- Não é limite vitalício de produtos.
- Produtos devem ser persistidos no Supabase somente após validação.
- Não publicar no Facebook nesta etapa do crawler.
- Não usar dados mock/fictícios.
- Não usar MCP Playwright como scraper de produção.
- Não usar `/categoria/*` como fonte atual.
- Não aceitar links externos, `localhost` ou URLs corrompidas.

## 9. Critério de sucesso

Uma execução `npm run scrape:150` somente é considerada concluída quando:

1. URLs reais de produto foram descobertas;
2. páginas individuais retornaram dados válidos;
3. 150 produtos únicos foram validados;
4. `original_url` e `affiliate_url` foram separados corretamente;
5. `affiliate_url` corresponde exatamente ao builder canônico;
6. a URL final não contém UTMs;
7. 150 registros foram persistidos/atualizados no Supabase;
8. nenhum dado mock foi utilizado.

## 10. Teste unitário

Executar:

```bash
npm run test:affiliate
```

Esse teste cobre URL limpa, URL já afiliada, URL oficial com UTM, idempotência, ausência de UTMs e ausência de duplicação do affiliate ID.
