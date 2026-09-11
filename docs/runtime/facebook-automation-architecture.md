# Facebook Automation — canonical implementation

A automação Facebook do LDM Bot possui um único executor: server/services/FacebookAutomationService.ts.

## Regras

- O navegador persistente é aberto uma única vez por FacebookSessionService.
- O executor reutiliza a página/contexto existente.
- Não existe login automático, cookie injection ou criação de perfil.
- O executor segue o fluxo documentado em docs/runtime/facebook-publication-scheduling-map.md.
- A copy usada para publicação/agendamento vem do facebook_copy persistido no produto.
- O executor não gera copy durante o agendamento.
- As etapas são serializadas para impedir duas interações simultâneas no Facebook.
- Cada etapa registra STEP=<nome> no LoggerService.
- Falhas de interação preservam o erro original para diagnóstico.

## Fluxo

1. Reutilizar sessão autenticada.
2. Reutilizar a página do grupo quando já estiver aberta.
3. Abrir composer.
4. Inserir copy + URL afiliada temporariamente para preview.
5. Remover a URL do texto.
6. Abrir "Mais opções de post".
7. Selecionar "Programar post".
8. Preencher data.
9. Preencher hora.
10. Confirmar "Programar".
11. Registrar confirmação.

## Estado

A aplicação considera uma publicação scheduled somente depois que o executor retorna sucesso. Falhas do Facebook não são mascaradas como agendamento confirmado.

## Limpeza

Registros históricos quebrados foram removidos pela migration 20260911010000_cleanup_broken_publications.sql.

O executor antigo FacebookPublisherServiceV2.ts foi removido para evitar duas implementações concorrentes do mesmo fluxo.
