# Phase 3 — Facebook stale composer fix

## Diagnosis
The first scheduled post completed successfully. On the second post, Facebook still had a visible/residual `Criar post` dialog during the transition after scheduling. The automation treated that stale dialog as a fresh composer and attempted to click a detached Lexical editor, producing Playwright `intercepts pointer events` / `element was detached from the DOM` errors.

## Fix baseline
Restored the exact `FacebookAutomationService.ts` implementation from commit `3e65f02762b9ef96efba19a74366c9fb790d30a3`, which had already implemented the stale-composer isolation and schedule-dialog scoping fix.

Key behavior:
- never reuse a visible stale `Criar post` dialog;
- press Escape and wait for the stale composer to become hidden;
- clear residual dialogs before opening the next composer;
- scope the editor to the visible canonical `Criar post` dialog;
- scope scheduling controls to the scheduling dialog;
- preserve the 1200ms token activation delay.

## Scope
Only `server/services/FacebookAutomationService.ts` is changed for the runtime fix. No database, crawler, scheduler architecture, or Facebook endpoint changes.

## Validation required locally
Run:

```bash
git pull
bun run lint
bun run dev
```

Expected sequence for consecutive posts:

```text
COMPOSER_READY ... aberto e limpo
...
RUNTIME_SCHEDULED
COMPOSER_READY ... aberto e limpo
...
RUNTIME_SCHEDULED
```

The definitive browser validation remains the real authenticated Facebook session; remote GitHub inspection cannot substitute for that runtime test.
