import { Publication, OperationalQuota } from '../types.js';
import { storage } from './StorageService.js';
import { facebookAutomation } from './FacebookAutomationService.js';
import { facebookSession } from './FacebookSessionService.js';
import { logger } from './LoggerService.js';

const TIME_ZONE = 'America/Sao_Paulo';
const DEFAULT_HOURS = ['08:00', '11:00', '14:00', '17:00', '20:00'];
const CONFIRMED = ['scheduled', 'published'] as const;
const STRUCTURAL_FACEBOOK_ERRORS = new Set([
  'FACEBOOK_COMPOSER_NOT_AVAILABLE',
  'FACEBOOK_COMPOSER_DIALOG_NOT_FOUND',
  'FACEBOOK_CONTENT_FIELD_NOT_FOUND',
  'FACEBOOK_SCHEDULE_BUTTON_NOT_FOUND',
  'FACEBOOK_DATE_CELL_NOT_FOUND',
  'FACEBOOK_TIME_OPTION_NOT_FOUND',
  'FACEBOOK_SCHEDULE_CONFIRM_DISABLED',
  'FACEBOOK_SCHEDULE_NOT_VISIBLE_IN_PLANNER'
]);

function localIso(date: string, time: string): string { return new Date(`${date}T${time}:00-03:00`).toISOString(); }
function localDateString(date: Date): string { return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date); }
function monthDates(year: number, month: number): string[] { const result: string[] = []; const last = new Date(Date.UTC(year, month, 0)).getUTCDate(); for (let day = 1; day <= last; day++) result.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`); return result; }
function normalizeGroupUrl(groupUrl: string): string { return groupUrl.trim().replace(/\/+$/, ''); }
function normalizeScheduledAt(value: string): string { const parsed = new Date(value); if (Number.isNaN(parsed.getTime())) return value.trim(); return parsed.toISOString(); }
function idempotencyKey(productId: string, groupUrl: string, scheduledAt: string): string { return `${productId}:${normalizeGroupUrl(groupUrl)}:${normalizeScheduledAt(scheduledAt)}`; }

export class SchedulerService {
  async start(): Promise<void> {
    try {
      const status = await facebookSession.start();
      logger.scheduler(`FACEBOOK_STARTUP status=${status.status}`);
      if (!status.connected) {
        logger.scheduler('STARTUP_MONTHLY_SCHEDULE skipped: Facebook session not authenticated.', 'warn');
        return;
      }
      const result = await this.ensureMonthlySchedule();
      logger.scheduler(`STARTUP_MONTHLY_SCHEDULE confirmed=${result.scheduled.filter(p => p.status === 'scheduled').length} message=${result.message}`, 'success');
    } catch (error: any) { logger.scheduler('STARTUP_MONTHLY_SCHEDULE failed: ' + error.message, 'error'); }
  }

  async ensureMonthlySchedule(targetDateStr?: string): Promise<{ scheduled: Publication[]; quota: OperationalQuota; message: string }> {
    const settings = await storage.getSettings();
    const now = new Date();
    const anchor = targetDateStr ? new Date(`${targetDateStr}T12:00:00-03:00`) : now;
    const anchorLocal = localDateString(anchor);
    const [year, month] = anchorLocal.split('-').map(Number);
    const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
    const all = await storage.getPublications();
    logger.scheduler(`MONTHLY_SCAN month=${monthPrefix} localNow=${localDateString(now)}`);

    const confirmed = all.filter(p => (CONFIRMED as readonly string[]).includes(p.status) && !p.error_message && (p.published_at || p.scheduled_at));
    const reservedMonth = confirmed.filter(p => (p.published_at || p.scheduled_at || '').startsWith(monthPrefix) || localDateString(new Date(p.published_at || p.scheduled_at)).startsWith(monthPrefix)).length;
    if (reservedMonth >= settings.monthly_limit) return { scheduled: [], quota: await storage.getQuota(), message: `Meta mensal já preenchida (${reservedMonth}/${settings.monthly_limit}).` };

    const hours = settings.daily_hours?.length ? settings.daily_hours : DEFAULT_HOURS;
    const usedProducts = new Set(confirmed.map(p => p.product_id));
    const usedSlots = new Set(confirmed.filter(p => localDateString(new Date(p.scheduled_at)).startsWith(monthPrefix)).map(p => normalizeScheduledAt(p.scheduled_at)));
    const existingByKey = new Map<string, Publication>();
    for (const publication of all) existingByKey.set(idempotencyKey(publication.product_id, publication.facebook_group_url || settings.facebook_group_url, publication.scheduled_at), publication);

    const products = await storage.getProducts(true);
    const candidates = products.filter(p => !usedProducts.has(p.id) && p.current_price > 0 && !!p.product_name && /^https?:\/\//i.test(p.original_url) && /^https?:\/\//i.test(p.affiliate_url) && p.affiliate_url.includes('/20889') && !!p.facebook_copy?.trim() && !/https?:\/\//i.test(p.facebook_copy) && !/R\$/i.test(p.facebook_copy));
    if (!candidates.length) return { scheduled: [], quota: await storage.getQuota(), message: 'Nenhum produto real e elegível disponível.' };

    const scheduled: Publication[] = [];
    let candidateIndex = 0;
    let structuralFailure: string | null = null;

    outer: for (const date of monthDates(year, month)) {
      for (const time of hours) {
        if (reservedMonth + scheduled.filter(p => p.status === 'scheduled').length >= settings.monthly_limit) break outer;
        const slotIso = localIso(date, time);
        if (new Date(slotIso).getTime() <= Date.now() || usedSlots.has(slotIso)) continue;
        const dayCount = [...usedSlots].filter(v => localDateString(new Date(v)) === date).length;
        if (dayCount >= settings.daily_limit) break;
        while (candidateIndex < candidates.length && usedProducts.has(candidates[candidateIndex].id)) candidateIndex++;
        const product = candidates[candidateIndex++];
        if (!product) break outer;

        const key = idempotencyKey(product.id, settings.facebook_group_url, slotIso);
        let publication = existingByKey.get(key);
        if (publication) {
          logger.scheduler(`QUEUE_REUSE id=${publication.id} product=${product.id} slot=${date}T${time} status=${publication.status}`);
          if (publication.status === 'scheduled' || publication.status === 'published') { usedProducts.add(product.id); usedSlots.add(normalizeScheduledAt(publication.scheduled_at)); scheduled.push(publication); continue; }
          if (!['draft', 'failed'].includes(publication.status)) continue;
        } else {
          publication = await storage.createPublication({ product_id: product.id, scheduled_at: slotIso, status: 'draft', content: product.facebook_copy!.trim(), facebook_group_url: normalizeGroupUrl(settings.facebook_group_url) });
          existingByKey.set(key, publication);
          logger.scheduler(`QUEUE_CREATED id=${publication.id} product=${product.id} slot=${date}T${time}`);
        }

        const result = await this.schedulePublication(publication.id);
        if (result) {
          scheduled.push(result);
          if (result.status === 'scheduled') { usedProducts.add(product.id); usedSlots.add(normalizeScheduledAt(result.scheduled_at)); }
          else if (STRUCTURAL_FACEBOOK_ERRORS.has(result.error_message || '')) { structuralFailure = result.error_message || 'FACEBOOK_STRUCTURAL_FAILURE'; break outer; }
        }
      }
    }

    const quota = await storage.getQuota();
    const message = structuralFailure ? `Agendamento interrompido por falha estrutural do Facebook: ${structuralFailure}` : `${scheduled.filter(p => p.status === 'scheduled').length} agendamento(s) confirmado(s) no Facebook.`;
    logger.scheduler(`MONTHLY_DONE month=${monthPrefix} confirmed=${scheduled.filter(p => p.status === 'scheduled').length} quota=${quota.monthly_publication_count}/${quota.monthly_limit}${structuralFailure ? ' halted=' + structuralFailure : ''}`, structuralFailure ? 'warn' : 'success');
    return { scheduled, quota, message };
  }

  async scheduleDailyBatch(targetDateStr?: string) { return this.ensureMonthlySchedule(targetDateStr); }

  async schedulePublication(publicationId: string): Promise<Publication | undefined> {
    const pub = await storage.getPublicationById(publicationId);
    if (!pub) throw new Error('Publicação não encontrada.');
    if (!['draft', 'failed'].includes(pub.status)) throw new Error('Publicação não está disponível para agendamento.');
    if (!pub.product?.affiliate_url?.includes('/20889')) throw new Error('Produto sem link afiliado /20889 válido.');
    if (!pub.content?.trim() || /https?:\/\//i.test(pub.content) || /R\$/i.test(pub.content)) throw new Error('Publicação bloqueada: copy contém URL ou preço.');

    const scheduledDate = new Date(pub.scheduled_at);
    if (Number.isNaN(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now()) throw new Error('Escolha uma data/hora futura para programar.');
    const settings = await storage.getSettings();
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(scheduledDate);
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(scheduledDate);
    const previousAttempts = Number.isFinite(Number(pub.attempts)) ? Number(pub.attempts) : 0;
    const attempts = Math.max(0, previousAttempts) + 1;

    logger.scheduler(`PROGRAM_START id=${pub.id} product=${pub.product_id} date=${date} time=${time} attempt=${attempts}`);
    const result = await facebookAutomation.schedule({ groupUrl: normalizeGroupUrl(pub.facebook_group_url || settings.facebook_group_url), content: pub.content, affiliateUrl: pub.product.affiliate_url, scheduledDate: date, scheduledTime: time });
    if (!result.success) return storage.updatePublication(pub.id, { status: 'failed', attempts, error_message: result.error || 'Facebook não confirmou o agendamento.' });
    logger.scheduler(`FACEBOOK_SCHEDULE_CONFIRMED id=${pub.id} facebook=${result.postUrl || 'verified-scheduled-posts'}`, 'success');
    return storage.updatePublication(pub.id, { status: 'scheduled', attempts, error_message: undefined, facebook_post_url: result.postUrl, scheduled_at: result.scheduledAt || pub.scheduled_at });
  }

  async checkAndProcessDuePublications(): Promise<number> {
    const now = Date.now();
    const due = (await storage.getPublications('failed')).filter(p => p.next_attempt_at && new Date(p.next_attempt_at).getTime() <= now && new Date(p.scheduled_at).getTime() > now);
    logger.scheduler(`RETRY_SCAN count=${due.length}`);
    for (const pub of due) await this.schedulePublication(pub.id);
    return due.length;
  }

  async publishNow(_publicationId: string): Promise<Publication | undefined> { throw new Error('FACEBOOK_IMMEDIATE_PUBLISH_DISABLED: o fluxo operacional é agendamento nativo no Facebook.'); }
  async reschedule(_publicationId: string, _newDateIso: string): Promise<Publication | undefined> { throw new Error('FACEBOOK_NATIVE_RESCHEDULE_UNSUPPORTED: altere o agendamento diretamente no Facebook.'); }
  async cancel(_publicationId: string): Promise<Publication | undefined> { throw new Error('FACEBOOK_NATIVE_CANCEL_UNSUPPORTED: cancelamento nativo deve ser feito no Facebook.'); }
}

export const scheduler = new SchedulerService();