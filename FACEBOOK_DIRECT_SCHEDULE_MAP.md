# FACEBOOK_DIRECT_SCHEDULE_MAP

## A. Estado da sessão
- Perfil do navegador existente utilizado: `data/browser-profiles/facebook`
- Sessão autenticada confirmada (acesso ao grupo sem solicitação de login)
- Nenhum novo contexto criado; nenhum login realizado; cookies preservados

## B. Estado do grupo
- URL: https://www.facebook.com/groups/tokeniza/
- Título da página: "A Loja Do Mecânico | Facebook"
- Estado: grupo acessível, carregado completamente
- Confirmação visual: cabeçalho do grupo presente, botão "Nova mensagem" visível

## C. Composer real
- Botão de abertura do compositor localizado por:
  - `aria-label`: "Escreva algo..."
  - `role`: button
  - Seletor efetivo: `[aria-label='Escreva algo...']`
- Ação: clique no botão acima abre o dialog de criação de post
- Após abertura, o dialog de compositor possui:
  - `aria-label`: "Criar post"
  - `role`: dialog
- Área de texto do post dentro desse dialog:
  - `role`: textbox
  - Seletor efetivo: `div[role='dialog'][aria-label='Criar post'] [role='textbox']`
  - Preenchido com o conteúdo de teste:
    ```
    Teste de agendamento do ForgeDeals.

    Oferta de teste para validação do fluxo real de programação no Facebook.

    #teste #lojadomecanico
    ```

## D. Botão Publicar real
- Antes de abrir o seletor de agendamento, o dialog continha dois botões de ação no rodapé:
  - Botão **Publicar**:
    - `aria-label`: "Postar"
    - `texto`: "Postar"
    - `role`: button
    - Seletor: `[aria-label='Postar']`
  - Botão **Programar** (ícone):
    - `aria-label`: "Programar post"
    - `texto`: vazio (apenas ícone)
    - `role`: button
    - Seletor: `[aria-label='Programar post']`
- Ambos estavam posicionados lado a lado, sem elementos intermediários entre eles.

## E. Botão Programar real
- O botão de agendamento (ícone) localizado por:
  - `aria-label`: "Programar post"
  - `role`: button
  - Seletor efetivo: `[aria-label='Programar post']`
- Clique nesse botão abre o fluxo de agendamento diretamente (sem passar por "Mais opções").

## F. Relação entre Programar e Publicar
- Os dois botões são elementos irmãos dentro do mesmo container de rodapé do dialog de compositor.
- Ordem visual (da esquerda para a direita): [Programar] [Publicar] (ícone seguido por texto).
- Não existe nenhum elemento "Mais opções" ou menu entre eles.
- Seletor que ilustra a adjacência: `div[role='dialog'][aria-label='Criar post'] > ... > [aria-label='Programar post'] + [aria-label='Postar']`

## G. Confirmação explícita
> Mais opções foi clicado: **NÃO**

## H. Fluxo real observado
1. Navegar para o grupo (se ainda não estiver nele).
2. Clicar no botão "Escreva algo..." para abrir o compositor.
3. Preencher a área de texto com o conteúdo de teste.
4. Clicar diretamente no botão de agendamento (ícone com aria-label "Programar post").
5. No seletor de data que aparece:
   - Clicar na célula da data desejada (ex.: "12 de setembro de 2026", localizada pelo accessible name/aria-label da célula).
6. No seletor de hora que aparece:
   - Clicar na opção de hora desejada (ex.: "10:30").
7. Clicar no botão de confirmação de agendamento (texto "Programar", aria-label "Programar").
8. O dialog de compositor fecha e retorna à página do grupo.
9. Verificar a página de posts agendados (`/scheduled_posts`) para confirmar a presença da postagem.

## I. Selectors capturados do DOM real
| Etapa | Seletor |
|-------|---------|
| Abrir composer | `[aria-label='Escreva algo...']` |
| Caixa de texto do composer | `div[role='dialog'][aria-label='Criar post'] [role='textbox']` |
| Botão de agendamento (ícone) | `[aria-label='Programar post']` |
| Seletor de data (célula) | `getByRole('gridcell', { name: /12 de setembro de 2026/ })` — accessible name (aria-label completo "Sábado, 12 de setembro de 2026"; `:has-text` NÃO funciona pois textContent é só "12") |
| Seletor de hora (opção) | `[role='option']:has-text('10:30')` |
| Botão de confirmação de agendamento | `[aria-label='Programar']` |
| Botão de publicar (para referência) | `[aria-label='Postar']` |

**Nota sobre a data:** versão anterior documentava `:has-text` com o texto longo ("12 de setembro de 2026"); o DOM atual expõe o texto completo somente via aria-label do gridcell (`textContent` é só o número do dia). Qualquer executor deve clicar via accessible name (`getByRole('gridcell', { name: /.../ })`).

## J. Código Playwright correspondente
```javascript
// 1. Garantir que estamos no grupo (já está aberto e autenticado)
await page.goto('https://www.facebook.com/groups/tokeniza/');

// 2. Abrir o composer
await page.locator("[aria-label='Escreva algo...']").click();

// 3. Preencher o post
await page.locator("div[role='dialog'][aria-label='Criar post'] [role='textbox']")
    .fill('Teste de agendamento do ForgeDeals.\n\nOferta de teste para validação do fluxo real de programação no Facebook.\n\n#teste #lojadomecanico');

// 4. Clicar no ícone de agendamento
await page.locator("[aria-label='Programar post']").click();

// 5. Selecionar data (exemplo: 12 de setembro de 2026)
await page.locator("[role='gridcell']:has-text('12 de setembro de 2026')").click();

// 6. Selecionar hora (exemplo: 10:30)
await page.locator("[role='option']:has-text('10:30')").click();

// 7. Confirmar agendamento
await page.locator("[aria-label='Programar']").click();

// 8. Opcional: aguardar fechamento do dialog (implícito)
// 9. Verificar na página de posts agendados
await page.goto('https://www.facebook.com/groups/tokeniza/scheduled_posts');
```

## K. Resultado do teste
- Após executar o fluxo acima, a postagem foi agendada com sucesso.
- Evidência na página de posts agendados (`/scheduled_posts`):
  - Texto localizado: `"Netto Farias em 17 horas Compartilhado com: Grupo público Teste de agendamento do ForgeDeals. Oferta de teste para validação do fluxo real de programação no Facebook. #teste #lojadomecanico Post compartilhado"`
  - Isso indica que a postagem está programada para aproximadamente 17 horas após o momento do agendamento (compatível com a data/hora selecionada).
- Nenhuma mensagem de erro foi exibida.
- O composer foi fechado corretamente após a confirmação.

## L. Divergências em relação ao mapa antigo
- No mapa antigo (baseado em versões anteriores ou em documentação obsoleta), o botão de programar estava escondido atrás do menu "Mais opções" ou "Mais opções de post".
- No Facebook atual (observado em 11/09/2026), o botão de programar está **diretamente disponível** ao lado do botão de publicar, sem necessidade de clicar em menus intermediários.
- Portanto, o fluxo canônico do projeto deve ser atualizado para:
  ```
  Composer
  → Programar (ícone)
  → Data
  → Hora
  → Confirmar Programar
  ```
- O passo "Mais opções" deve ser removido do fluxo de agendamento.