# Mapeamento do Fluxo de Publicação e Agendamento no Facebook

## Objetivo
Mapear, usando navegador real autenticado, o fluxo de publicação e agendamento de uma oferta no grupo configurado no projeto `Tokenizaa/ldm_bot_v2`. Este documento separa explicitamente o que foi observado no Facebook do que ainda não foi validado em execução real.

## Ambiente
- Repositório: `Tokenizaa/ldm_bot_v2`
- Branch: `main`
- Navegador: Chrome/Chromium via Playwright
- Perfil persistente: `data/browser-profiles/facebook`
- Sessão: login e 2FA realizados manualmente
- Grupo: `A Loja Do Mecânico`
- URL: `https://www.facebook.com/groups/tokeniza/`
- Playwright observado: `1.63.0`

## Correção importante sobre sessão
A persistência oficial da sessão é o perfil persistente do navegador:

`data/browser-profiles/facebook`

`storageState.json` **não é mecanismo de persistência da aplicação** e não deve ser criado, exportado, importado ou usado para injetar cookies. A sessão foi validada anteriormente por reutilização do perfil após reinicialização.

Não são utilizados:
- automação de credenciais;
- automação de 2FA;
- cookie injection;
- bypass de CAPTCHA;
- stealth/fingerprint spoofing;
- perfil pessoal cotidiano do Chrome.

## Estado do mapeamento

### VALIDADO POR INSPEÇÃO REAL
- Grupo acessível.
- Composer pode ser aberto.
- Campo de conteúdo pode receber texto.
- URL pode ser inserida no conteúdo.
- Facebook tenta gerar preview de link quando consegue acessar a URL.
- Hashtags permanecem como texto durante a composição.
- `@everyone` permaneceu como texto literal no grupo testado e não houve autocomplete/conversão para menção real.
- Menu de mais opções foi observado.
- Opção `Programar post` foi observada.
- Campos de data e hora foram observados.
- O botão `Programar` foi observado e pode ser habilitado após dados válidos.

### AINDA NÃO VALIDADO
- Clique final em `Programar` criando efetivamente uma publicação agendada.
- Identificação da publicação na lista de publicações agendadas.
- Publicação efetiva no horário agendado.
- Comportamento do Facebook depois do agendamento confirmado.
- Limites de caracteres.
- Limites de frequência/spam em múltiplas publicações.

## Fluxo observado

### 1. Acessar o grupo
Navegar para:

`https://www.facebook.com/groups/tokeniza/`

Confirmar que a URL continua em `/groups/` e que o conteúdo do grupo está disponível para a conta autenticada.

### 2. Abrir composer
Foi observado o botão equivalente a:

`Escreva algo`

ou um accessible name equivalente a `Criar uma publicação`.

O clique abre o diálogo do composer.

### 3. Preencher conteúdo
O composer possui campo editável, normalmente com `role="textbox"`/`contenteditable`.

O conteúdo pode conter:
- título SEO;
- descrição;
- características/benefícios;
- preço;
- CTA;
- URL afiliada;
- hashtags;
- `@everyone` como texto, quando configurado.

### 4. Link afiliado e preview
A aplicação deve fornecer uma URL afiliada válida contendo `/20889`.

O preview é responsabilidade do Facebook. O ForgeDeals não deve tentar fabricar o preview.

Durante o mapeamento, uma URL pública real foi usada para observar que o Facebook consegue renderizar preview quando a URL é acessível.

**Importante:** isso demonstra o comportamento do preview do Facebook, mas não constitui validação específica de um URL afiliado real da Loja do Mecânico.

### 5. Hashtags
Exemplos:

```text
#furadeira
#ferramentas
#oferta
#lojadomecanico
```

São enviadas como texto. O comportamento visual posterior é responsabilidade do Facebook.

### 6. `@everyone`
No grupo testado:

- não apareceu autocomplete;
- não foi observada conversão para uma menção real;
- permaneceu como texto literal.

Portanto, o ForgeDeals deve tratar `@everyone` como conteúdo textual e não tentar criar uma menção artificial.

### 7. Mais opções
Foi observado um botão equivalente a:

`Mais opções de post`

O clique abre opções adicionais do composer.

### 8. Programar post
Foi observada a opção:

`Programar post`

Selecioná-la abre o fluxo de agendamento.

### 9. Data
Foi observado um input de data equivalente a:

```html
<input type="date">
```

O valor esperado para automação é:

`YYYY-MM-DD`

A aplicação deve validar previamente que a data não é passada.

### 10. Hora
Foi observado um input equivalente a:

```html
<input type="time">
```

Formato esperado:

`HH:mm`

24 horas.

### 11. Botão de confirmação
Foi observado um botão equivalente a:

`Programar`

O estado de habilitação depende da validade dos dados de agendamento.

### 12. Confirmação final
**Não foi executado o clique final em uma publicação real durante o mapeamento original.**

Consequentemente, não é correto afirmar que uma publicação foi efetivamente agendada.

## Mapa técnico dos elementos

| Etapa | Elemento observado | Estratégia de localização | Ação |
|---|---|---|---|
| Grupo | Página do grupo | URL `/groups/` | Navegar |
| Composer | `Escreva algo` / `Criar uma publicação` | role + accessible name + texto | Clicar |
| Conteúdo | textbox/contenteditable | `[role="dialog"] [role="textbox"]` e equivalentes | Preencher |
| Preview | bloco/imagem de preview | observar DOM após inserção da URL | Aguardar |
| Mais opções | `Mais opções de post` | aria-label/role | Clicar |
| Agendamento | `Programar post` | texto/accessibility | Clicar |
| Data | `input[type="date"]` | tipo do input | Preencher |
| Hora | `input[type="time"]` | tipo do input | Preencher |
| Confirmar | `Programar` | role + accessible name | Clicar somente em teste controlado |
| Imediato | `Postar` | role + accessible name | Não usar durante teste de agendamento |

Os seletores acima são referências de descoberta, não contratos estáveis. O Facebook pode alterar DOM, textos, atributos e estrutura.

## Contrato desejado do FacebookService

```ts
publishScheduledPublication({
  groupUrl: string,
  content: string,
  affiliateUrl: string,
  scheduledDate: string,
  scheduledTime: string,
}): Promise<{
  success: boolean;
  postUrl?: string;
  scheduledAt?: string;
  error?: string;
}>
```

## Responsabilidades

### ForgeDeals
- produto e preço reais;
- URL afiliada real com `/20889`;
- SEO;
- texto da publicação;
- hashtags;
- eventual `@everyone` textual;
- validação do conteúdo;
- seleção de data/hora segundo as quotas e regras do SchedulerService.

### FacebookService
- reutilizar o contexto persistente;
- validar sessão;
- acessar grupo;
- abrir composer;
- preencher conteúdo;
- aguardar preview quando aplicável;
- abrir mais opções;
- selecionar `Programar post`;
- preencher data/hora;
- confirmar o agendamento;
- verificar o resultado observado na interface.

## Status real

| Item | Status |
|---|---|
| Sessão persistente | FUNCIONANDO |
| Acesso ao grupo | FUNCIONANDO |
| Composer | FUNCIONANDO |
| Inserção de conteúdo | FUNCIONANDO |
| Hashtags | FUNCIONANDO |
| `@everyone` como texto | FUNCIONANDO; não convertido em menção |
| Preview de URL | PARCIALMENTE VALIDADO |
| Preview específico de afiliado `/20889` | NECESSITA VALIDAÇÃO |
| Mais opções | FUNCIONANDO |
| `Programar post` | FUNCIONANDO por inspeção |
| Campo de data | FUNCIONANDO por inspeção |
| Campo de hora | FUNCIONANDO por inspeção |
| Botão `Programar` habilitado | FUNCIONANDO por inspeção |
| Clique final de agendamento real | NÃO VALIDADO |
| Verificação de publicação agendada | NÃO VALIDADO |
| Publicação no horário | NÃO VALIDADO |
| `publishScheduledPublication()` implementado | NÃO IMPLEMENTADO |
| Integração do SchedulerService com agendamento Facebook | NÃO VALIDADO / NÃO IMPLEMENTADO nesta etapa |

## Evidências
Arquivos capturados durante o mapeamento original:

- `screenshots/groups_page.html` / `groups_page.png`
- `screenshots/group_page.html` / `group_page.png`
- `screenshots/group_loaded.html` / `group_loaded.png`
- `screenshots/composer_opened.html` / `composer_opened.png`
- `screenshots/composer_filled.html` / `composer_filled.png`
- `screenshots/after_filling.html` / `after_filling.png`

As etapas posteriores de confirmação não possuem evidência de execução completa no mapeamento original.

## Correção da auditoria GitHub

A verificação direta do GitHub mostrou que o SHA informado anteriormente pelo agente estava incorreto.

SHA inexistente informado pelo agente:

`558699d6572f5215d331147d68e495868e51a6ac`

SHA real do commit encontrado no GitHub:

`558699d6572f5215d331147d68e495ea5bf92510`

O commit real é:

`docs: add Facebook publication and scheduling map`

E a branch `main` aponta atualmente para:

`558699d6572f5215d331147d68e495ea5bf92510`

Portanto, o agente **não implementou `publishScheduledPublication()` nessa execução**. O commit encontrado é documental.

## Conclusão
O mapa do fluxo Facebook está documentado, mas o agendamento real ainda não pode ser classificado como funcionando em produção.

O próximo passo técnico é implementar `publishScheduledPublication()` seguindo este mapa, sem alterar a arquitetura de sessão persistente, e então executar um único teste controlado de agendamento real antes de integrar o fluxo ao SchedulerService.
