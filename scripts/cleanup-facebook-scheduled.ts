import { chromium, type BrowserContext, type Page, type Locator } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const GROUP_SCHEDULED_URL = 'https://www.facebook.com/groups/tokeniza/scheduled_posts';
const PROFILE_DIR = path.resolve(process.cwd(), 'data', 'browser-profiles', 'facebook');

const WAIT_AFTER_DELETE_MS = 350;
const MENU_SETTLE_MS = 150;
const ACTION_TIMEOUT_MS = 5_000;
const MAX_ATTEMPTS_PER_POST = 3;

function log(message: string): void {
  console.log(`[facebook-cleanup] ${message}`);
}

async function findFirstPostAction(page: Page): Promise<Locator | null> {
  const buttons = page.locator('[role="button"]');
  const count = await buttons.count();

  for (let i = 0; i < count; i++) {
    const button = buttons.nth(i);
    if (!(await button.isVisible().catch(() => false))) continue;

    const aria = (await button.getAttribute('aria-label').catch(() => null)) ?? '';
    if (aria.startsWith('Ações para este post de')) return button;
  }

  return null;
}

async function clickDeletePost(page: Page): Promise<void> {
  const deleteItem = page
    .locator('[role="menuitem"]')
    .filter({ hasText: /^Excluir post$/ })
    .last();

  await deleteItem.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS });
  await page.waitForTimeout(MENU_SETTLE_MS);

  // Facebook may replace the menu node during its animation. Playwright's
  // locator is intentionally reacquired on each retry instead of retaining a
  // stale ElementHandle.
  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_POST; attempt++) {
    try {
      await deleteItem.click({ timeout: ACTION_TIMEOUT_MS });
      return;
    } catch (error) {
      if (attempt === MAX_ATTEMPTS_PER_POST) throw error;
      await page.waitForTimeout(100);
    }
  }
}

async function confirmDelete(page: Page): Promise<void> {
  const dialog = page.locator('[role="dialog"]:visible').last();
  const confirmButton = dialog.getByRole('button', { name: /^Excluir$/ }).last();

  await confirmButton.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS });
  await confirmButton.click({ timeout: ACTION_TIMEOUT_MS });
}

async function deleteOnePost(page: Page): Promise<boolean> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_POST; attempt++) {
    const actionButton = await findFirstPostAction(page);
    if (!actionButton) return false;

    try {
      await actionButton.click({ timeout: ACTION_TIMEOUT_MS });
      await clickDeletePost(page);
      await confirmDelete(page);
      await page.waitForTimeout(WAIT_AFTER_DELETE_MS);
      return true;
    } catch (error) {
      // A Facebook menu can be detached while React/FB re-renders it. Close
      // any transient menu/dialog and retry the same post from fresh locators.
      if (attempt === MAX_ATTEMPTS_PER_POST) throw error;

      await page.keyboard.press('Escape').catch(() => undefined);
      await page.waitForTimeout(150);
      log(`interface atualizada durante exclusão; tentando novamente (${attempt + 1}/${MAX_ATTEMPTS_PER_POST})`);
    }
  }

  return false;
}

async function waitForScheduledPage(page: Page): Promise<void> {
  await page.goto(GROUP_SCHEDULED_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });

  await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);

  const heading = page
    .getByText(/Posts programados|Posts agendados|Scheduled posts/i)
    .first();

  await heading.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
}

async function main(): Promise<void> {
  if (!fs.existsSync(PROFILE_DIR)) {
    throw new Error(`Perfil do Facebook não encontrado: ${PROFILE_DIR}`);
  }

  log(`perfil: ${PROFILE_DIR}`);
  log(`url: ${GROUP_SCHEDULED_URL}`);

  let context: BrowserContext | undefined;

  try {
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: false,
      viewport: { width: 1280, height: 800 },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    });

    const pages = context.pages().filter(page => !page.isClosed());
    const page = pages[0] ?? await context.newPage();

    for (const extra of context.pages()) {
      if (extra !== page && !extra.isClosed()) {
        await extra.close().catch(() => undefined);
      }
    }

    await page.bringToFront();
    await waitForScheduledPage(page);

    let deleted = 0;

    while (true) {
      const removed = await deleteOnePost(page);
      if (!removed) break;

      deleted++;
      log(`excluído: ${deleted}`);
    }

    const remaining = await findFirstPostAction(page);
    if (remaining) {
      throw new Error('Ainda existe pelo menos um post agendado após a limpeza.');
    }

    log(`CONCLUÍDO — ${deleted} post(s) agendado(s) excluído(s).`);
  } finally {
    if (context) await context.close().catch(() => undefined);
  }
}

main().catch(error => {
  console.error(`[facebook-cleanup] ERRO: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
