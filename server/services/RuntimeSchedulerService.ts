import crypto from 'crypto';
import { Publication, OperationalQuota, Product } from '../types.js';
import { storage } from './StorageService.js';
import { facebookAutomation } from './FacebookAutomationService.js';
import { facebookSession } from './FacebookSessionService.js';
import { logger } from './LoggerService.js';
import { contentService } from './ContentService.js';
import { localIso, localDateString, monthDates, TIME_ZONE, DEFAULT_HOURS, normalizeGroupUrl } from '../utils/idempotency.js';

const STRUCTURAL_FACEBOOK_ERRORS = new Set([
  'FACEBOOK_GROUP_NOT_READY', 'FACEBOOK_COMPOSER_NOT_AVAILABLE', 'FACEBOOK_COMPOSER_DIALOG_NOT_FOUND',
  'FACEBOOK_CONTENT_FIELD_NOT_FOUND', 'FACEBOOK_SCHEDULE_BUTTON_NOT_FOUND', 'FACEBOOK_LINK_PREVIEW_INPUT_FAILED',
  'FACEBOOK_DATE_CELL_NOT_FOUND', 'FACEBOOK_TIME_OPTION_NOT_FOUND', 'FACEBOOK_SCHEDULE_CONFIRM_DISABLED'
]);

type RuntimeState = { publication: Publication; product: Product };

type TimedStage = <T>(stage: string, operation: () => Promise<T>) => Promise<T>;

export class RuntimeSchedulerService {
  private readonly runtime = new Map<string, RuntimeState>();
  private readonly usedProducts = new Set<string>();
  private readonly usedSlots = new Set<string>();
  private lastScheduleOperationAt = 0;
  private readonly minScheduleGapMs = 10000;
  private readonly maxScheduleGapMs = 22000;
  private lock: Promise<void> = Promise.resolve();

  private async timedStage<T>(stage: string, operation: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    logger.scheduler(`[Timing] START ${stage}`);
    try {
      const result = await operation();
      logger.scheduler(`[Timing] END ${stage} durationMs=${Date.now() - startedAt}`);
      return result;
    } catch (error: any) {
      logger.scheduler(`[Timing] FAIL ${stage} durationMs=${Date.now() - startedAt} error=${error?.message || error}`, 'error');
      throw error;
    }
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.lock;
    let release!: () => void;
    this.lock = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  private async pace(): Promise<void> {
    if (!this.lastScheduleOperationAt) { this.lastScheduleOperationAt = Date.now(); return; }
    const elapsed = Date.now() - this.lastScheduleOperationAt;
    const target = Math.floor(this.minScheduleGapMs + Math.random() * (this.maxScheduleGapMs - this.minScheduleGapMs + 1));
    const wait = target - elapsed;
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    this.lastScheduleOperationAt = Date.now();
  }

  async start(): Promise<void> {
    const startedAt = Date.now();
    logger.scheduler('[Timing] START scheduler.start');
    try {
      const status = await this.timedStage('facebookSession.start', () => facebookSession.start());
      logger.scheduler(`FACEBOOK_STARTUP status=${status.status}`);
      if (!status.connected) logger.scheduler('RUNTIME_SCHEDULER_READY Facebook não autenticado; agendamento aguardará conexão.', 'warn');
      else logger.scheduler('RUNTIME_SCHEDULER_READY catálogo carregado sob demanda; nenhum agendamento é persistido no banco.');
      logger.scheduler(`[Timing] END scheduler.start durationMs=${Date.now() - startedAt}`);
    } catch (error: any) {
      logger.scheduler(`[Timing] FAIL scheduler.start durationMs=${Date.now() - startedAt} error=${error.message}`, 'error');
      logger.scheduler(`RUNTIME_SCHEDULER_START_FAILED ${error.message}`, 'error');
    }
  }

  private makePublication(product: Product, scheduledAt: string, content: string, groupUrl: string): Publication {
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(), product_id: product.id, product, scheduled_at: scheduledAt, status: 'draft',
      content, facebook_group_url: groupUrl, attempts: 0, max_attempts: 1, created_at: now, updated_at: now
    };
  }

  private quota(settings: Awaited<ReturnType<typeof storage.getSettings>>, targetDate: Date): OperationalQuota {
    const month = localDateString(targetDate).slice(0, 7);
    const today = localDateString(targetDate);
    const monthCount = [...this.runtime.values()].filter(x => x.publication.status === 'scheduled' && localDateString(new Date(x.publication.scheduled_at)).startsWith(month)).length;
    const dayCount = [...this.runtime.values()].filter(x => x.publication.status === 'scheduled' && localDateString(new Date(x.publication.scheduled_at)) === today).length;
    return {
      current_month: month, monthly_publication_count: monthCount, monthly_limit: settings.monthly_limit,
      daily_publication_count: dayCount, daily_limit: settings.daily_limit, remaining_month: Math.max(0, settings.monthly_limit - monthCount), today_date: today
    };
  }

  async ensureMonthlySchedule(targetDateStr?: string): Promise<{ scheduled: Publication[]; quota: OperationalQuota; message: string }> {
    return this.withLock(async () => {
      const startedAt = Date.now();
      logger.scheduler('[Timing] START ensureMonthlySchedule');
      const settings = await this.timedStage('storage.getSettings', () => storage.getSettings());
      const now = new Date();
      const anchor = targetDateStr ? new Date(`${targetDateStr}T12:00:00-03:00`) : now;
      const anchorLocal = localDateString(anchor);
      const [year, month] = anchorLocal.split('-').map(Number);
      const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
      const currentMonth = localDateString(now).slice(0, 7);
      const currentDay = Number(localDateString(now).slice(8, 10));
      const monthlyLimit = monthPrefix === currentMonth && currentDay > 1 ? Number.MAX_SAFE_INTEGER : settings.monthly_limit;
      const hours = settings.daily_hours?.length ? settings.daily_hours : DEFAULT_HOURS;
      const groupUrl = normalizeGroupUrl(settings.facebook_group_url);
      const products = await this.timedStage('storage.getProducts', async () => (await storage.getProducts(true)).filter(p =>
        p.current_price > 0 && Boolean(p.product_name) && /^https?:\/\//i.test(p.original_url) &&
        /^https?:\/\//i.test(p.affiliate_url) && p.affiliate_url.includes('/20889') && Boolean(p.facebook_copy?.trim())
      ));
      logger.scheduler(`[Timing] PRODUCTS_ELIGIBLE count=${products.length}`);

      if (!products.length) {
        logger.scheduler(`[Timing] END ensureMonthlySchedule durationMs=${Date.now() - startedAt} reason=no-products`);
        return { scheduled: [], quota: this.quota(settings, anchor), message: 'Nenhum produto real e elegível disponível.' };
      }

      const scheduled: Publication[] = [];
      let candidateIndex = 0;
      let structuralFailure: string | null = null;
      const dates = monthDates(year, month);
      logger.scheduler(`[Timing] SCHEDULE_PLAN month=${monthPrefix} days=${dates.length} dailyLimit=${settings.daily_limit} monthlyLimit=${monthlyLimit === Number.MAX_SAFE_INTEGER ? 'bootstrap-unlimited' : monthlyLimit}`);

      outer: for (const date of dates) {
        const alreadyToday = [...this.runtime.values()].filter(x => x.publication.status === 'scheduled' && localDateString(new Date(x.publication.scheduled_at)) === date).length;
        let dayCount = alreadyToday;
        if (dayCount >= settings.daily_limit) continue;

        for (const time of hours) {
          if (dayCount >= settings.daily_limit || scheduled.length >= monthlyLimit) break;
          const slotIso = localIso(date, time);
          if (new Date(slotIso).getTime() <= Date.now() || this.usedSlots.has(slotIso)) continue;

          let product: Product | undefined;
          while (candidateIndex < products.length) {
            const next = products[candidateIndex++];
            if (!this.usedProducts.has(next.id)) { product = next; break; }
          }
          if (!product) break outer;

          logger.scheduler(`[Timing] START product-cycle product=${product.id} slot=${date}T${time}`);
          const copyStartedAt = Date.now();
          const prepared = await contentService.ensureCopyForPublication(product, product.facebook_copy);
          const content = prepared.content.trim();
          logger.scheduler(`[Timing] END contentService.ensureCopyForPublication durationMs=${Date.now() - copyStartedAt} product=${product.id}`);
          if (!contentService.isPublicationCopySafe(product, content)) {
            logger.scheduler(`RUNTIME_COPY_REJECTED product=${product.id}`, 'warn');
            continue;
          }

          const publication = this.makePublication(product, slotIso, content, groupUrl);
          this.runtime.set(publication.id, { publication, product });
          this.usedProducts.add(product.id);
          this.usedSlots.add(slotIso);

          try {
            await this.timedStage(`pace product=${product.id}`, () => this.pace());
            const result = await this.timedStage(`facebookAutomation.schedule product=${product.id} slot=${date}T${time}`, () => facebookAutomation.schedule({
              groupUrl, content, affiliateUrl: product.affiliate_url, scheduledDate: date, scheduledTime: time,
              productName: product.product_name, sku: product.sku, preCheckPlanner: true
            }));

            if (result.success) {
              publication.status = 'scheduled';
              publication.planner_url = result.plannerUrl;
              publication.updated_at = new Date().toISOString();
              publication.error_message = undefined;
              scheduled.push(publication);
              dayCount++;
              logger.scheduler(`RUNTIME_SCHEDULED product=${product.id} slot=${date}T${time}`,'success');
            } else {
              publication.status = result.uncertain ? 'unknown' : 'failed';
              publication.error_message = result.error;
              publication.planner_url = result.plannerUrl;
              publication.updated_at = new Date().toISOString();
              logger.scheduler(`RUNTIME_SCHEDULE_FAILED product=${product.id} slot=${date}T${time} error=${result.error || 'unknown'}`, result.uncertain ? 'warn' : 'error');
              if (result.uncertain || STRUCTURAL_FACEBOOK_ERRORS.has(result.error || '')) {
                if (result.uncertain) break outer;
                structuralFailure = result.error || 'FACEBOOK_STRUCTURAL_FAILURE';
                break outer;
              }
            }
          } catch (error: any) {
            publication.status = 'failed';
            publication.error_message = error.message;
            publication.updated_at = new Date().toISOString();
            logger.scheduler(`RUNTIME_SCHEDULE_ERROR product=${product.id} error=${error.message}`, 'error');
            if (STRUCTURAL_FACEBOOK_ERRORS.has(error.message || '')) { structuralFailure = error.message; break outer; }
          }
        }
      }

      const quota = this.quota(settings, anchor);
      const message = structuralFailure
        ? `Agendamento interrompido por falha estrutural do Facebook: ${structuralFailure}`
        : `${scheduled.length} agendamento(s) confirmado(s) no Facebook.`;
      logger.scheduler(`[Timing] END ensureMonthlySchedule durationMs=${Date.now() - startedAt} scheduled=${scheduled.length} structuralFailure=${structuralFailure || 'none'}`);
      return { scheduled, quota, message };
    });
  }

  async scheduleDailyBatch(targetDateStr?: string) { return this.ensureMonthlySchedule(targetDateStr); }

  async createPublication(productId: string, scheduledAt: string, content: string, groupUrl?: string): Promise<Publication> {
    const startedAt = Date.now();
    const product = await this.timedStage('storage.getProductById', () => storage.getProductById(productId));
    if (!product) throw new Error('Produto não encontrado.');
    const settings = await this.timedStage('storage.getSettings', () => storage.getSettings());
    const safe = await this.timedStage('contentService.ensureCopyForPublication', () => contentService.ensureCopyForPublication(product, content || product.facebook_copy));
    const publication = this.makePublication(product, scheduledAt, safe.content.trim(), normalizeGroupUrl(groupUrl || settings.facebook_group_url));
    this.runtime.set(publication.id, { publication, product });
    logger.scheduler(`[Timing] END createPublication durationMs=${Date.now() - startedAt} publication=${publication.id}`);
    return publication;
  }

  async schedulePublication(publicationId: string): Promise<Publication | undefined> {
    const state = this.runtime.get(publicationId);
    if (!state) throw new Error('Publicação não encontrada na sessão atual. O banco não armazena publicações.');
    const { publication, product } = state;
    if (publication.status === 'scheduled') return publication;
    const date = localDateString(new Date(publication.scheduled_at));
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(publication.scheduled_at));
    await this.timedStage(`pace product=${product.id}`, () => this.pace());
    const result = await this.timedStage(`facebookAutomation.schedule product=${product.id} slot=${date}T${time}`, () => facebookAutomation.schedule({ groupUrl: publication.facebook_group_url || '', content: publication.content, affiliateUrl: product.affiliate_url, scheduledDate: date, scheduledTime: time, productName: product.product_name, sku: product.sku, preCheckPlanner: true }));
    publication.updated_at = new Date().toISOString();
    publication.planner_url = result.plannerUrl;
    publication.status = result.success ? 'scheduled' : (result.uncertain ? 'unknown' : 'failed');
    publication.error_message = result.error;
    if (result.success) this.usedProducts.add(product.id);
    return publication;
  }

  async publishNow(publicationId: string) { return this.schedulePublication(publicationId); }

  async retry(publicationId: string) { return this.schedulePublication(publicationId); }

  async reconcileUnknownPublication(publicationId: string) {
    const state = this.runtime.get(publicationId);
    if (!state) throw new Error('Publicação não encontrada na sessão atual.');
    const { publication, product } = state;
    const date = localDateString(new Date(publication.scheduled_at));
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(publication.scheduled_at));
    const check = await this.timedStage(`facebookAutomation.checkScheduledPost product=${product.id}`, () => facebookAutomation.checkScheduledPost(publication.facebook_group_url || '', publication.content, date, time, product.product_name));
    if (check.found) { publication.status = 'scheduled'; publication.planner_url = check.plannerUrl; publication.error_message = undefined; }
    return publication;
  }

  async reschedule(publicationId: string, scheduledAt: string) {
    const state = this.runtime.get(publicationId);
    if (!state) throw new Error('Publicação não encontrada na sessão atual.');
    state.publication.scheduled_at = scheduledAt;
    state.publication.status = 'draft';
    state.publication.updated_at = new Date().toISOString();
    return this.schedulePublication(publicationId);
  }

  async checkAndProcessDuePublications(): Promise<number> { return 0; }

  async getRuntimePublications(): Promise<Publication[]> { return [...this.runtime.values()].map(x => x.publication); }
}

export const scheduler = new RuntimeSchedulerService();
