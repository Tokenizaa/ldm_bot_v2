import { facebookBrowser } from './FacebookBrowserService.js';
import { facebookSession } from './FacebookSessionService.js';

export async function verifyFacebookGroup(groupUrl: string) {
  try {
    await facebookSession.requireAuthenticated();
    const page = await facebookBrowser.getOperationalPage();
    const expected = new URL(groupUrl);
    const current = new URL(page.url());
    if (current.origin !== expected.origin || current.pathname.replace(/\/+$/, '') !== expected.pathname.replace(/\/+$/, '')) {
      await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    return {
      success: true,
      groupUrl,
      accessible: true,
      url: page.url(),
      title: await page.title().catch(() => ''),
    };
  } catch (error: any) {
    return {
      success: false,
      groupUrl,
      accessible: false,
      error: error?.message || String(error),
    };
  }
}

export async function publishFacebookTest(_groupUrl: string) {
  return {
    success: false,
    message: 'FACEBOOK_TEST_PUBLISH_DISABLED: use o fluxo de agendamento real.',
  };
}
