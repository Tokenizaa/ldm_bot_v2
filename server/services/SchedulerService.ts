import { Publication, OperationalQuota } from '../types.js';
import { storage } from './StorageService.js';
import { facebookAutomation } from './FacebookAutomationService.js';
import { facebookSession } from './FacebookSessionService.js';
import { logger } from './LoggerService.js';
import { contentService } from './ContentService.js';
import {
  calculatePublicationIdempotencyKey,
  normalizeGroupUrl,
  normalizeScheduledAt,
  localIso,
  localDateString,
  monthDates,
  TIME_ZONE,
  DEFAULT_HOURS
} from '../utils/idempotency.js';

const CONFIRMED_STATUSES = ['scheduled', 'published'] as const;
const ACTIVE_PRODUCT_STATUSES = ['scheduled', 'published', 'attempting', 'unknown'] as const;
const STRUCTURAL_FACEBOOK_ERRORS = new Set([
  'FACEBOOK_GROUP_NOT_READY',
  'FACEBOOK_COMPOSER_NOT_AVAILABLE',
  'FACEBOOK_COMPOSER_DIALOG_NOT_FOUND',
  'FACEBOOK_CONTENT_FIELD_NOT_FOUND',
  'FACEBOOK_SCHEDULE_BUTTON_NOT_FOUND',
  'FACEBOOK_LINK_PREVIEW_INPUT_FAILED',
  'FACEBOOK_DATE_CELL_NOT_FOUND',
  'FACEBOOK_TIME_OPTION_NOT_FOUND',
  'FACEBOOK_SCHEDULE_CONFIRM_DISABLED'
]);

export class SchedulerService {
  private schedulerLock: Promise<void> = Promise.resolve();
  private lastScheduleOperationAt = 0;
  private readonly minScheduleGapMs = 10000;
  private readonly maxScheduleGapMs = 22000;
  private lastPlannerReconciliationAt = 0;
  private readonly plannerReconciliationTtlMs = 10 * 60 * 1000;
  private readonly plannerReconciliationHorizonMs = 48 * 60 * 60 * 1000;
  private readonly plannerReconciliationMaxItems = 10;
  private readonly staleAttemptingThresholdMs = 20 * 60 * 1000;

  private async waitForSchedulePacing(): Promise<void> {
    if (this.lastScheduleOperationAt === 0) {
      this.lastScheduleOperationAt = Date.now();
      return;
    }
    const elapsed = Date.now() - this.lastScheduleOperationAt;
    const targetGap = Math.floor(this.minScheduleGapMs + Math.random() * (this.maxScheduleGapMs - this.minScheduleGapMs + 1));
    const remaining = targetGap - elapsed;
    if (remaining > 0) {
      logger.scheduler(`SCHEDULE_PACING_WAIT ms=${remaining} targetGap=${targetGap}`);
      await new Promise(resolve => setTimeout(resolve, remaining));
    }
    this.lastScheduleOperationAt = Date.now();
  }

  private async withSchedulerLock<T>(operationName: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.schedulerLock;
    let release!: () => void;
    this.schedulerLock = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      return await storage.withDistributedLock('lock:scheduler', 180000, operationName, operation);
    } finally {
      release();
    }
  }

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
    } catch (error: any) {
      logger.scheduler('STARTUP_MONTHLY_SCHEDULE failed: ' + error.message, 'error');
    }
  }

  private async recoverStaleAttemptingPublications(all: Publication[], nowMs: number): Promise<void> {
    const stale = all.filter(p => p.status === 'attempting' && p.updated_at && nowMs - new Date(p.updated_at).getTime() >= this.staleAttemptingThresholdMs);
    if (!stale.length) return;
    logger.scheduler(`STALE_ATTEMPTING_RECOVERY_START count=${stale.length}`, 'warn');
    for (const pub of stale) {
      const updated = await storage.updatePublication(pub.id, {
        status: 'unknown',
        error_message: 'Tentativa de agendamento ficou presa em publishing; requer reconciliação do planner antes de novo envio.'
      });
      if (updated) logger.scheduler(`STALE_ATTEMPTING_RECOVERED id=${pub.id} product=${pub.product_id} slot=${pub.scheduled_at}`, 'warn');
    }
  }

  private async reconcileNearTermScheduledPublications(
    all: Publication[],
    settings: Awaited<ReturnType<typeof storage.getSettings>>,
    nowMs: number
  ): Promise<void> {
    if (nowMs - this.lastPlannerReconciliationAt < this.plannerReconciliationTtlMs) {
      logger.scheduler('PLANNER_RECONCILIATION_DEFERRED verificação periódica ainda dentro do TTL');
      return;
    }

    const candidates = all
      .filter(p => p.status === 'scheduled' && new Date(p.scheduled_at).getTime() > nowMs)
      .filter(p => new Date(p.scheduled_at).getTime() <= nowMs + this.plannerReconciliationHorizonMs)
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
      .slice(0, this.plannerReconciliationMaxItems);

    if (!candidates.length) {
      this.lastPlannerReconciliationAt = nowMs;
      logger.scheduler('PLANNER_RECONCILIATION_SKIP nenhum agendamento próximo para verificar');
      return;
    }

    this.lastPlannerReconciliationAt = nowMs;
    logger.scheduler(`PLANNER_RECONCILIATION_START count=${candidates.length}`);
    const groupUrl = normalizeGroupUrl(settings.facebook_group_url);

    for (const pub of candidates) {
      if (!pub.product) continue;
      const scheduledDate = new Date(pub.scheduled_at);
      const date = localDateString(scheduledDate);
      const time = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(scheduledDate);

      try {
        const check = await facebookAutomation.checkScheduledPost(groupUrl, pub.content, date, time, pub.product.product_name);

        if (!check.found) {
          logger.scheduler(
            `PLANNER_RECONCILIATION_MISSING id=${pub.id} slot=${date}T${time} DB=scheduled Facebook=absent; cancelando reserva fantasma para recriação segura`,
            'warn'
          );
          await storage.updatePublication(pub.id, {
            status: 'cancelled',
            error_message: 'Reserva anterior não encontrada no Planner Facebook; registro cancelado para permitir recriação segura.',
            planner_url: undefined
          });
        } else {
          logger.scheduler(`PLANNER_RECONCILIATION_OK id=${pub.id} slot=${date}T${time}`);
        }
      } catch (err: any) {
        logger.scheduler(`PLANNER_RECONCILIATION_ERROR id=${pub.id}: ${err.message}`, 'warn');
      }
    }
  }

  async ensureMonthlySchedule(targetDateStr?: string): Promise<{ scheduled: Publication[]; quota: OperationalQuota; message: string }> {
    return this.withSchedulerLock('batch-today', async () => {
      const settings = await storage.getSettings();
      const now = new Date();
      const anchor = targetDateStr ? new Date(`${targetDateStr}T12:00:00-03:00`) : now;
      const anchorLocal = localDateString(anchor);
      const [year, month] = anchorLocal.split('-').map(Number);
      const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
      const currentMonthPrefix = localDateString(now).slice(0, 7);
      const currentDay = Number(localDateString(now).slice(8, 10));
      const isBootstrapPartialMonth = monthPrefix === currentMonthPrefix && currentDay > 1;
      const monthlyLimit = isBootstrapPartialMonth ? Number.MAX_SAFE_INTEGER : settings.monthly_limit;
      const all = await storage.getPublications();
      logger.scheduler(`MONTHLY_SCAN month=${monthPrefix} localNow=${localDateString(now)} monthlyLimit=${isBootstrapPartialMonth ? 'UNLIMITED_BOOTSTRAP_PARTIAL_MONTH' : settings.monthly_limit}`);

      await this.recoverStaleAttemptingPublications(all, now.getTime());
      const recoveredAll = await storage.getPublications();
      await this.reconcileNearTermScheduledPublications(recoveredAll, settings, now.getTime());

      const refreshedAll = await storage.getPublications();
      const confirmed = refreshedAll.filter(p => (CONFIRMED_STATUSES as readonly string[]).includes(p.status) && !p.error_message && (p.published_at || p.scheduled_at));
      const activeProducts = refreshedAll.filter(p => (ACTIVE_PRODUCT_STATUSES as readonly string[]).includes(p.status) && new Date(p.scheduled_at).getTime() > now.getTime());
      const reservedMonth = confirmed.filter(p => {
        const ref = p.published_at || p.scheduled_at || '';
        return ref.startsWith(monthPrefix) || localDateString(new Date(ref)).startsWith(monthPrefix);
      }).length;

      if (reservedMonth >= monthlyLimit) {
        return { scheduled: [], quota: await storage.getQuota(refreshedAll, settings), message: isBootstrapPartialMonth ? 'Mês parcial de bootstrap já não possui slots disponíveis.' : `Meta mensal já preenchida (${reservedMonth}/${settings.monthly_limit}).` };
      }

      const hours = settings.daily_hours?.length ? settings.daily_hours : DEFAULT_HOURS;
      const usedProducts = new Set(activeProducts.map(p => p.product_id));
      const usedSlots = new Set(confirmed.filter(p => localDateString(new Date(p.scheduled_at)).startsWith(monthPrefix)).map(p => normalizeScheduledAt(p.scheduled_at)));
      const existingByKey = new Map<string, Publication>();
      for (const publication of refreshedAll) {
        const key = calculatePublicationIdempotencyKey(publication.product_id, publication.facebook_group_url || settings.facebook_group_url, publication.scheduled_at);
        existingByKey.set(key, publication);
      }

      const products = await storage.getProducts(true);
      const candidates = products.filter(p => !usedProducts.has(p.id) && p.current_price > 0 && Boolean(p.product_name) && /^https?:\/\//i.test(p.original_url) && /^https?:\/\//i.test(p.affiliate_url) && p.affiliate_url.includes('/20889'));
      if (!candidates.length) return { scheduled: [], quota: await storage.getQuota(refreshedAll, settings), message: 'Nenhum produto real e elegível disponível.' };

      const scheduled: Publication[] = [];
      let candidateIndex = 0;
      let structuralFailure: string | null = null;

      outer: for (const date of monthDates(year, month)) {
        for (const time of hours) {
          const totalConfirmedThisMonth = reservedMonth + scheduled.filter(p => p.status === 'scheduled').length;
          if (totalConfirmedThisMonth >= monthlyLimit) break outer;
          const scheduledAt = normalizeScheduledAt(`${date}T${time}:00`);
          if (new Date(scheduledAt).getTime() <= now.getTime() + 5 * 60 * 1000) continue;
          if (usedSlots.has(scheduledAt)) continue;
          if (candidateIndex >= candidates.length) break outer;
          const product = candidates[candidateIndex++];
          const key = calculatePublicationIdempotencyKey(product.id, settings.facebook_group_url, scheduledAt);
          if (existingByKey.has(key)) continue;
          try {
            const publication = await this.schedulePublication(product, settings, scheduledAt);
            if (publication) {
              scheduled.push(publication);
              usedProducts.add(product.id);
              usedSlots.add(scheduledAt);
              existingByKey.set(key, publication);
            }
          } catch (error: any) {
            const message = error?.message || String(error);
            if (STRUCTURAL_FACEBOOK_ERRORS.has(message.split(':')[0])) {
              structuralFailure = message;
              break outer;
            }
            logger.scheduler(`SCHEDULE_SLOT_FAILED slot=${scheduledAt} product=${product.id}: ${message}`, 'warn');
          }
        }
      }

      return {
        scheduled,
        quota: await storage.getQuota(await storage.getPublications(), settings),
        message: structuralFailure ? `Agendamento interrompido por erro estrutural do Facebook: ${structuralFailure}` : `Agendamentos confirmados nesta execução: ${scheduled.length}`
      };
    });
  }

  private async schedulePublication(product: any, settings: any, scheduledAt: string): Promise<Publication | null> {
    await this.waitForSchedulePacing();
    const content = await contentService.ensureCopyForPublication(product);
    const publication = await storage.createPublication({ product_id: product.id, scheduled_at: scheduledAt, status: 'attempting', content, facebook_group_url: settings.facebook_group_url });
    try {
      const result = await facebookAutomation.schedule({ groupUrl: settings.facebook_group_url, content, affiliateUrl: product.affiliate_url, scheduledAt, productName: product.product_name });
      if (!result.verified) {
        await storage.updatePublication(publication.id, { status: 'unknown', error_message: 'Agendamento submetido mas não foi possível verificar o Planner Facebook.' });
        return null;
      }
      if (!result.found) {
        await storage.updatePublication(publication.id, { status: 'unknown', error_message: 'Agendamento não encontrado no Planner Facebook após submissão.' });
        return null;
      }
      return await storage.updatePublication(publication.id, { status: 'scheduled', planner_url: result.plannerUrl, error_message: undefined }) || null;
    } catch (error: any) {
      const code = String(error?.message || '').split(':')[0];
      const preserveUnknown = code === 'FACEBOOK_PLANNER_UNVERIFIED' || code === 'FACEBOOK_SUBMISSION_UNVERIFIED';
      await storage.updatePublication(publication.id, { status: preserveUnknown ? 'unknown' : 'failed', error_message: error?.message || String(error) });
      throw error;
    }
  }
}
