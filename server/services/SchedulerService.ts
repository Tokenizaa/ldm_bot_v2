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
  private readonly minScheduleGapMs = 15000;
  private lastPlannerReconciliationAt = 0;
  private readonly plannerReconciliationTtlMs = 10 * 60 * 1000;
  private readonly plannerReconciliationHorizonMs = 48 * 60 * 60 * 1000;
  private readonly plannerReconciliationMaxItems = 10;

  private async waitForSchedulePacing(): Promise<void> {
    const elapsed = Date.now() - this.lastScheduleOperationAt;
    const remaining = this.minScheduleGapMs - elapsed;
    if (remaining > 0) {
      logger.scheduler(`SCHEDULE_PACING_WAIT ms=${remaining}`);
      await new Promise(resolve => setTimeout(resolve, remaining));
    }
    this.lastScheduleOperationAt = Date.now();
  }

  /**
   * Serializes calls locally and acquires the database-level distributed lock
   * across multiple processes and containers via Supabase `system_config`.
   */
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
      const time = new Intl.DateTimeFormat('en-GB', {
        timeZone: TIME_ZONE,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(scheduledDate);

      try {
        const check = await facebookAutomation.checkScheduledPost(
          groupUrl,
          pub.content,
          date,
          time,
          pub.product.product_name
        );

        if (check.verified && !check.found) {
          logger.scheduler(
            `PLANNER_RECONCILIATION_MISSING id=\${pub.id} slot=\${date}T\${time} DB=scheduled Facebook=absent; resetando para draft`,
            'warn'
          );
          await storage.updatePublication(pub.id, {
            status: 'draft',
            error_message: 'Agendamento não encontrado no planner Facebook; liberado para recriação segura.',
            planner_url: undefined
          });
        } else if (check.found) {
          logger.scheduler(`PLANNER_RECONCILIATION_OK id=\${pub.id} slot=\${date}T\${time}`);
        } else {
          logger.scheduler(`PLANNER_RECONCILIATION_UNVERIFIED id=\${pub.id} slot=\${date}T\${time}; mantendo status scheduled`, 'warn');
        }
      } catch (err: any) {
        logger.scheduler(`PLANNER_RECONCILIATION_ERROR id=\${pub.id}: \${err.message}`, 'warn');
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
      const all = await storage.getPublications();
      logger.scheduler(`MONTHLY_SCAN month=${monthPrefix} localNow=${localDateString(now)}`);

      // Facebook is the external source of truth for native scheduled posts.
      // Reconcile only a small near-term window and only every 10 minutes.
      // This catches manual deletions without scanning the whole monthly planner.
      await this.reconcileNearTermScheduledPublications(all, settings, now.getTime());

      const refreshedAll = await storage.getPublications();
      const confirmed = refreshedAll.filter(p => (CONFIRMED_STATUSES as readonly string[]).includes(p.status) && !p.error_message && (p.published_at || p.scheduled_at));
      const reservedMonth = confirmed.filter(p => {
        const ref = p.published_at || p.scheduled_at || '';
        return ref.startsWith(monthPrefix) || localDateString(new Date(ref)).startsWith(monthPrefix);
      }).length;

      if (reservedMonth >= settings.monthly_limit) {
        return {
          scheduled: [],
          quota: await storage.getQuota(refreshedAll, settings),
          message: `Meta mensal já preenchida (${reservedMonth}/${settings.monthly_limit}).`
        };
      }

      const hours = settings.daily_hours?.length ? settings.daily_hours : DEFAULT_HOURS;
      const usedProducts = new Set(confirmed.map(p => p.product_id));
      const usedSlots = new Set(confirmed.filter(p => localDateString(new Date(p.scheduled_at)).startsWith(monthPrefix)).map(p => normalizeScheduledAt(p.scheduled_at)));
      const existingByKey = new Map<string, Publication>();
      for (const publication of refreshedAll) {
        const key = calculatePublicationIdempotencyKey(
          publication.product_id,
          publication.facebook_group_url || settings.facebook_group_url,
          publication.scheduled_at
        );
        existingByKey.set(key, publication);
      }

      const products = await storage.getProducts(true);
      const candidates = products.filter(p =>
        !usedProducts.has(p.id) &&
        p.current_price > 0 &&
        Boolean(p.product_name) &&
        /^https?:\/\//i.test(p.original_url) &&
        /^https?:\/\//i.test(p.affiliate_url) &&
        p.affiliate_url.includes('/20889') &&
        Boolean(p.facebook_copy?.trim()) &&
        !/https?:\/\//i.test(p.facebook_copy) &&
        !/R\$/i.test(p.facebook_copy)
      );

      if (!candidates.length) {
        return {
          scheduled: [],
          quota: await storage.getQuota(all, settings),
          message: 'Nenhum produto real e elegível disponível.'
        };
      }

      const scheduled: Publication[] = [];
      let candidateIndex = 0;
      let structuralFailure: string | null = null;

      outer: for (const date of monthDates(year, month)) {
        for (const time of hours) {
          const totalConfirmedThisMonth = reservedMonth + scheduled.filter(p => p.status === 'scheduled').length;
          if (totalConfirmedThisMonth >= settings.monthly_limit) break outer;

          // Strict daily limit check accounting for confirmed + already scheduled in this run
          const confirmedToday = confirmed.filter(c => localDateString(new Date(c.published_at || c.scheduled_at)) === date).length;
          const scheduledToday = scheduled.filter(s => s.status === 'scheduled' && localDateString(new Date(s.scheduled_at)) === date).length;
          if (confirmedToday + scheduledToday >= settings.daily_limit) {
            break; // Skip rest of day slots
          }

          const slotIso = localIso(date, time);
          if (new Date(slotIso).getTime() <= Date.now() || usedSlots.has(slotIso)) continue;

          while (candidateIndex < candidates.length && usedProducts.has(candidates[candidateIndex].id)) {
            candidateIndex++;
          }
          const product = candidates[candidateIndex++];
          if (!product) break outer;

          const key = calculatePublicationIdempotencyKey(product.id, settings.facebook_group_url, slotIso);
          let publication = existingByKey.get(key);

          if (publication) {
            logger.scheduler(`QUEUE_REUSE id=${publication.id} product=${product.id} slot=${date}T${time} status=${publication.status}`);
            if (publication.status === 'scheduled' || publication.status === 'published') {
              usedProducts.add(product.id);
              usedSlots.add(normalizeScheduledAt(publication.scheduled_at));
              scheduled.push(publication);
              continue;
            }
            if (!['draft', 'failed', 'unknown'].includes(publication.status)) continue;
          } else {
            publication = await storage.createPublication({
              product_id: product.id,
              scheduled_at: slotIso,
              status: 'draft',
              content: product.facebook_copy!.trim(),
              facebook_group_url: normalizeGroupUrl(settings.facebook_group_url)
            });
            existingByKey.set(key, publication);
            logger.scheduler(`QUEUE_CREATED id=${publication.id} product=${product.id} slot=${date}T${time}`);
          }

          try {
            const result = await this.schedulePublication(publication.id);
            if (result) {
              scheduled.push(result);
              if (result.status === 'scheduled') {
                usedProducts.add(product.id);
                usedSlots.add(normalizeScheduledAt(result.scheduled_at));
              } else if (STRUCTURAL_FACEBOOK_ERRORS.has(result.error_message || '')) {
                structuralFailure = result.error_message || 'FACEBOOK_STRUCTURAL_FAILURE';
                break outer;
              }
            }
          } catch (itemErr: any) {
            logger.scheduler(`ITEM_SCHEDULE_ERROR id=${publication.id}: ${itemErr.message}`, 'error');
            if (STRUCTURAL_FACEBOOK_ERRORS.has(itemErr.message || '')) {
              structuralFailure = itemErr.message;
              break outer;
            }
          }
        }
      }

      const quota = await storage.getQuota();
      const confirmedCount = scheduled.filter(p => p.status === 'scheduled').length;
      const message = structuralFailure
        ? `Agendamento interrompido por falha estrutural do Facebook: ${structuralFailure}`
        : `${confirmedCount} agendamento(s) confirmado(s) no Facebook.`;
      logger.scheduler(
        `MONTHLY_DONE month=${monthPrefix} confirmed=${confirmedCount} quota=${quota.monthly_publication_count}/${quota.monthly_limit}${structuralFailure ? ' halted=' + structuralFailure : ''}`,
        structuralFailure ? 'warn' : 'success'
      );
      return { scheduled, quota, message };
    });
  }

  async scheduleDailyBatch(targetDateStr?: string) {
    return this.ensureMonthlySchedule(targetDateStr);
  }

  async schedulePublication(publicationId: string): Promise<Publication | undefined> {
    const pub = await storage.getPublicationById(publicationId);
    if (!pub) throw new Error('Publicação não encontrada.');
    if (!['draft', 'failed', 'unknown', 'attempting'].includes(pub.status)) {
      throw new Error(`Publicação não está disponível para agendamento (status atual: ${pub.status}).`);
    }
    if (!pub.product?.affiliate_url?.includes('/20889')) {
      throw new Error('Produto sem link afiliado /20889 válido.');
    }

    // The database copy is legacy/untrusted input. Always pass it through the canonical
    // copy gate before touching Facebook. This repairs old prompt dumps and malformed
    // copies that the previous narrow detector could not recognize.
    const safeCopy = await contentService.ensureCopyForPublication(pub.product, pub.content);
    if (!safeCopy.content?.trim()) throw new Error('FACEBOOK_COPY_REGENERATION_FAILED');
    if (safeCopy.content.trim() !== (pub.content || '').trim()) {
      logger.scheduler('COPY_REPAIRED id=' + pub.id + ' product=' + pub.product_id, 'warn');
      const updated = await storage.updatePublication(pub.id, {
        content: safeCopy.content.trim(),
        error_message: undefined
      });
      if (!updated) throw new Error('FACEBOOK_COPY_REPAIR_PERSIST_FAILED');
    }
    pub.content = safeCopy.content.trim();
    if (!contentService.isPublicationCopySafe(pub.product, pub.content)) {
      throw new Error('FACEBOOK_COPY_SAFETY_GATE_FAILED');
    }
    const scheduledDate = new Date(pub.scheduled_at);
    if (Number.isNaN(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now()) {
      throw new Error('Escolha uma data/hora futura para programar.');
    }

    const settings = await storage.getSettings();
    const date = localDateString(scheduledDate);
    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone: TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(scheduledDate);

    // If publication status is 'unknown', check if Facebook actually scheduled it before resubmitting to prevent duplicates
    if (pub.status === 'unknown') {
      logger.scheduler(`UNKNOWN_PRE_CHECK id=${pub.id} Verificando planner antes de qualquer tentativa.`);
      const groupUrl = normalizeGroupUrl(pub.facebook_group_url || settings.facebook_group_url);
      try {
        const check = await facebookAutomation.checkScheduledPost(groupUrl, pub.content, date, time, pub.product.product_name);
        if (check.found) {
          logger.scheduler(`UNKNOWN_RESOLVED_ALREADY_SCHEDULED id=${pub.id} confirmada no planner! Evitando post duplicado.`, 'success');
          return storage.updatePublication(pub.id, {
            status: 'scheduled',
            error_message: undefined,
            planner_url: check.plannerUrl
          });
        }
        logger.scheduler(`UNKNOWN_CONFIRMED_ABSENT id=${pub.id} ausente no planner. Prosseguindo com agendamento seguro.`);
      } catch (err: any) {
        logger.scheduler(`UNKNOWN_PRE_CHECK_FAILED id=${pub.id}: ${err.message}`, 'warn');
      }
    }

    const currentAttempts = Number.isFinite(Number(pub.attempts)) ? Math.max(0, Math.trunc(Number(pub.attempts))) : 0;
    const maxAttempts = Math.max(1, Number.isFinite(Number(pub.max_attempts)) ? Math.trunc(Number(pub.max_attempts)) : 3);

    if (currentAttempts >= maxAttempts) {
      logger.scheduler(`PROGRAM_SKIP_MAX_ATTEMPTS id=${pub.id} attempts=${currentAttempts} max=${maxAttempts}`, 'warn');
      return pub;
    }
    const attempts = currentAttempts + 1;

    // Transition state to 'attempting' before initiating browser action
    await storage.updatePublication(pub.id, {
      status: 'attempting',
      attempts,
      error_message: undefined
    });

    logger.scheduler(`PROGRAM_START id=${pub.id} product=${pub.product_id} date=${date} time=${time} attempt=${attempts}/${maxAttempts}`);

    const groupUrl = normalizeGroupUrl(pub.facebook_group_url || settings.facebook_group_url);
    await this.waitForSchedulePacing();

    const result = await facebookAutomation.schedule({
      groupUrl,
      content: pub.content,
      affiliateUrl: pub.product.affiliate_url,
      scheduledDate: date,
      scheduledTime: time,
      productName: pub.product.product_name,
      sku: pub.product.sku
    });

    // 1. Definite Success
    if (result.success) {
      logger.scheduler(`FACEBOOK_SCHEDULE_CONFIRMED id=${pub.id} planner=${result.plannerUrl || 'verified'}`, 'success');
      return storage.updatePublication(pub.id, {
        status: 'scheduled',
        attempts,
        error_message: undefined,
        facebook_post_url: result.postUrl,
        planner_url: result.plannerUrl,
        scheduled_at: result.scheduledAt || pub.scheduled_at
      });
    }

    // 2. Uncertain Confirmation (Action was submitted to Facebook, but verification was not confirmed in planner)
    if (result.uncertain || result.submitted) {
      logger.scheduler(`FACEBOOK_SCHEDULE_UNCERTAIN id=${pub.id} err=${result.error}`, 'warn');
      return storage.updatePublication(pub.id, {
        status: 'unknown',
        attempts,
        error_message: result.error || 'FACEBOOK_CONFIRMATION_UNCERTAIN: Ação enviada ao Facebook, mas confirmação falhou. Bloqueado contra retry automático.',
        planner_url: result.plannerUrl,
        next_attempt_at: undefined
      });
    }

    // 3. Definite Failure before click "Programar"
    const backoffMinutes = Math.min(120, Math.pow(2, attempts) * 5);
    const nextAttemptAt = attempts < maxAttempts ? new Date(Date.now() + backoffMinutes * 60000).toISOString() : undefined;

    logger.scheduler(`FACEBOOK_SCHEDULE_FAILED id=${pub.id} attempts=${attempts}/${maxAttempts} next=${nextAttemptAt || 'none'} err=${result.error}`, 'error');
    return storage.updatePublication(pub.id, {
      status: 'failed',
      attempts,
      error_message: result.error || 'Facebook não confirmou o agendamento.',
      next_attempt_at: nextAttemptAt
    });
  }

  async checkAndProcessDuePublications(): Promise<number> {
    return this.withSchedulerLock('process-due', async () => {
      const now = Date.now();
      const settings = await storage.getSettings();

      // Check 'unknown' publications first by inspecting the planner
      const allUnknown = await storage.getPublications('unknown');
      for (const pub of allUnknown) {
        if (!pub.product) continue;
        const scheduledDate = new Date(pub.scheduled_at);
        const date = localDateString(scheduledDate);
        const time = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(scheduledDate);
        const groupUrl = normalizeGroupUrl(pub.facebook_group_url || settings.facebook_group_url);

        try {
          const check = await facebookAutomation.checkScheduledPost(groupUrl, pub.content, date, time, pub.product.product_name);
          if (check.found) {
            logger.scheduler(`UNKNOWN_RESOLVED_SCHEDULED id=${pub.id} confirmed in planner!`, 'success');
            await storage.updatePublication(pub.id, {
              status: 'scheduled',
              error_message: undefined,
              planner_url: check.plannerUrl
            });
          } else {
            logger.scheduler(`UNKNOWN_VERIFIED_ABSENT id=${pub.id}; resetting to draft for safe retry`, 'warn');
            await storage.updatePublication(pub.id, {
              status: 'draft',
              error_message: 'Verificado ausente no planner após incerteza anterior.'
            });
          }
        } catch (err: any) {
          logger.scheduler(`UNKNOWN_CHECK_FAILED id=${pub.id}: ${err.message}`, 'warn');
        }
      }

      // Check failed publications due for retry
      const due = (await storage.getPublications('failed')).filter(p =>
        p.next_attempt_at &&
        new Date(p.next_attempt_at).getTime() <= now &&
        new Date(p.scheduled_at).getTime() > now &&
        (Number(p.attempts) || 0) < (Number(p.max_attempts) || 3)
      );

      logger.scheduler(`RETRY_SCAN count=${due.length}`);
      for (const pub of due) {
        await this.schedulePublication(pub.id);
      }
      return due.length;
    });
  }

  /**
   * Directly audits and reconciles a publication currently in 'unknown' status.
   * If found in Facebook planner, updates status to 'scheduled'.
   * If verified absent, resets status to 'draft' so it can be safely scheduled again.
   */
  async reconcileUnknownPublication(publicationId: string): Promise<Publication> {
    const pub = await storage.getPublicationById(publicationId);
    if (!pub) throw new Error('Publicação não encontrada.');
    if (!pub.product) throw new Error('Publicação sem produto associado.');

    const settings = await storage.getSettings();
    const scheduledDate = new Date(pub.scheduled_at);
    const date = localDateString(scheduledDate);
    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone: TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(scheduledDate);
    const groupUrl = normalizeGroupUrl(pub.facebook_group_url || settings.facebook_group_url);

    logger.scheduler(`RECONCILE_UNKNOWN_START id=${pub.id} group=${groupUrl} slot=${date}T${time}`);
    const check = await facebookAutomation.checkScheduledPost(groupUrl, pub.content, date, time, pub.product.product_name);

    if (check.found) {
      logger.scheduler(`RECONCILE_UNKNOWN_CONFIRMED id=${pub.id} confirmado no planner Facebook!`, 'success');
      const updated = await storage.updatePublication(pub.id, {
        status: 'scheduled',
        error_message: undefined,
        planner_url: check.plannerUrl
      });
      return updated || pub;
    } else {
      logger.scheduler(`RECONCILE_UNKNOWN_ABSENT id=${pub.id} ausente no planner Facebook; resetado para draft.`, 'warn');
      const updated = await storage.updatePublication(pub.id, {
        status: 'draft',
        error_message: 'Verificado ausente no planner do Facebook. Liberado com segurança para novo agendamento.'
      });
      return updated || pub;
    }
  }

  async publishNow(_publicationId: string): Promise<Publication | undefined> {
    throw new Error('FACEBOOK_IMMEDIATE_PUBLISH_DISABLED: o fluxo operacional é agendamento nativo no Facebook.');
  }

  async reschedule(_publicationId: string, _newDateIso: string): Promise<Publication | undefined> {
    throw new Error('FACEBOOK_NATIVE_RESCHEDULE_UNSUPPORTED: altere o agendamento diretamente no Facebook.');
  }

  async cancel(_publicationId: string): Promise<Publication | undefined> {
    throw new Error('FACEBOOK_NATIVE_CANCEL_UNSUPPORTED: cancelamento nativo deve ser feito no Facebook.');
  }
}

export const scheduler = new SchedulerService();