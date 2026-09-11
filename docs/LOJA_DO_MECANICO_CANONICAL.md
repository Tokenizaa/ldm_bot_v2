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

## 7. Afiliado `/20889`

A regra do sistema é gerar a URL de afiliado a partir da URL original normalizada:

`<original_url>/20889`

Nunca:

- `/20889/20889`;
- query string de rastreamento;
- fragmento;
- HTML entity no pathname;
- JSON anexado ao slug.

Exemplo de produto real usado na validação:

`https://www.lojadomecanico.com.br/produto/621944/98/1045/maquina-de-solda-inversora-multiprocesso-mig-0-sem-gas-120a-bivolt-com-mascara-de-solda-optiarc-70-boxer-99086/20889`

A URL acima representa a forma afiliada; a `original_url` correspondente deve remover somente o `/20889` final.

## 8. Regras de produção

- Meta por execução: **150 produtos reais por lote**.
- Não é limite vitalício de produtos.
- Produtos devem ser persistidos no Supabase somente após validação.
- Não publicar no Facebook nesta etapa.
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
5. 150 registros foram persistidos/atualizados no Supabase;
6. nenhum dado mock foi utilizado.
