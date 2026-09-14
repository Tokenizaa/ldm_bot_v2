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
  private readonly plannerReconciliationHorizonMs = 48 * 60 * 60 * 1000;
  private readonly plannerReconciliationMaxItems = 10;
  private readonly staleAttemptingThresholdMs = 20 * 60 * 1000;

  private async waitForSchedulePacing(): Promise<void> {
    if (this.lastScheduleOperationAt === 0) {
      this.lastScheduleOperationAt = Date.now();
      return;
    }
    const elapsed = Date.now() - this.lastScheduleOperationAt;
    const targetGap = Math.floor(
      this.minScheduleGapMs + Math.random() * (this.maxScheduleGapMs - this.minScheduleGapMs + 1)
    );
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
    const stale = all.filter(p =>
      p.status === 'attempting' &&
      p.updated_at &&
      nowMs - new Date(p.updated_at).getTime() >= this.staleAttemptingThresholdMs
    );

    if (!stale.length) return;

    logger.scheduler(`STALE_ATTEMPTING_RECOVERY_START count=${stale.length}`, 'warn');
    for (const pub of stale) {
      const updated = await storage.updatePublication(pub.id, {
        status: 'unknown',
        error_message: 'Tentativa de agendamento ficou presa em publishing; requer reconciliação do planner antes de novo envio.'
      });
      if (updated) {
        logger.scheduler(`STALE_ATTEMPTING_RECOVERED id=${pub.id} product=${pub.product_id} slot=${pub.scheduled_at}`, 'warn');
      }
    }
  }

  private async reconcileNearTermScheduledPublications(
    all: Publication[],
    settings: Awaited<ReturnType<typeof storage.getSettings>>,
    nowMs: number
  ): Promise<void> {
    const candidates = all
      .filter(p => p.status === 'scheduled' && new Date(p.scheduled_at).getTime() > nowMs)
      .filter(p => new Date(p.scheduled_at).getTime() <= nowMs + this.plannerReconciliationHorizonMs)
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
      .slice(0, this.plannerReconciliationMaxItems);

    if (!candidates.length) {
      logger.scheduler('PLANNER_RECONCILIATION_SKIP nenhum agendamento próximo para verificar');
      return;
    }

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

        if (check.found) {
          logger.scheduler(`PLANNER_RECONCILIATION_OK id=${pub.id} slot=${date}T${time}`);
          continue;
        }
        if (!check.verified) {
          logger.scheduler(
            `PLANNER_RECONCILIATION_UNVERIFIED id=${pub.id} slot=${date}T${time} DB=scheduled; consulta instável, reserva mantida para não duplicar`,
            'warn'
          );
          continue;
        }
        logger.scheduler(
          `PLANNER_RECONCILIATION_CONFLICT id=${pub.id} slot=${date}T${time} DB=scheduled FB=verified-absent; reserva mantida (não desbloqueia produto confirmado)`,
          'warn'
        );
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
      const confirmed = refreshedAll.filter(p =>
        (CONFIRMED_STATUSES as readonly string[]).includes(p.status) &&
        !p.error_message &&
        (p.published_at || p.scheduled_at)
      );
      const activeProducts = refreshedAll.filter(p =>
        (ACTIVE_PRODUCT_STATUSES as readonly string[]).includes(p.status)
      );
      const reservedMonth = confirmed.filter(p => {
        const ref = p.published_at || p.scheduled_at || '';
        return ref.startsWith(monthPrefix) || localDateString(new Date(ref)).startsWith(monthPrefix);
      }).length;

      if (reservedMonth >= monthlyLimit) {
        return {
          scheduled: [],
          quota: await storage.getQuota(refreshedAll, settings),
          message: isBootstrapPartialMonth
            ? `Mês parcial de bootstrap já não possui slots disponíveis.`
            : `Meta mensal já preenchida (${reservedMonth}/${settings.monthly_limit}).`
        };
      }

      const hours = settings.daily_hours?.length ? settings.daily_hours : DEFAULT_HOURS;
      const usedProducts = new Set(activeProducts.map(p => p.product_id));
      const usedSlots = new Set(
        confirmed
          .filter(p => localDateString(new Date(p.scheduled_at)).startsWith(monthPrefix))
          .map(p => normalizeScheduledAt(p.scheduled_at))
      );
      const existingByKey = new Map<string, Publication>();
      for (const publication of refreshedAll) {
        const key = calculatePublicationIdempotencyKey(
          publication.product_id,
          publication.facebook_group_url || settings.facebook_group_url,
          publication.scheduled_at
        );
        existingByKey.set(key, publication);
      }

      // A chave de identidade do produto é a única regra de deduplicação.
      // O histórico persiste o produto assim que o Facebook confirma o agendamento.
      const publishedIdentityKeys = await storage.getPublishedProductIdentityKeys(normalizeGroupUrl(settings.facebook_group_url));
      const publishedProductIds = await storage.getPublishedProductIds(normalizeGroupUrl(settings.facebook_group_url));
      const products = await storage.getProducts(true);
      const candidates = products.filter(p => {
        if (usedProducts.has(p.id)) return false;
        if (publishedProductIds.has(p.id)) {
          logger.scheduler('PRODUCT_ALREADY_USED_BLOCKED product=' + p.id + ' reason=posts_ledger');
          usedProducts.add(p.id);
          return false;
        }
        if (publishedIdentityKeys.has(p.product_identity_key)) {
          logger.scheduler('PRODUCT_ALREADY_USED_BLOCKED product=' + p.id + ' identity=' + p.product_identity_key);
          usedProducts.add(p.id);
          return false;
        }
        if (p.current_price <= 0 || !p.product_name) return false;
        if (!/^https?:\/\//i.test(p.original_url) || !/^https?:\/\//i.test(p.affiliate_url)) return false;
        if (!p.affiliate_url.includes('/20889')) return false;
        return true;
      });

      if (!candidates.length) {
        return {
          scheduled: [],
          quota: await storage.getQuota(refreshedAll, settings),
          message: 'Nenhum produto real e elegível disponível.'
        };
      }

      const scheduled: Publication[] = [];
      let scheduledSincePlannerReconciliation = 0;
      let candidateIndex = 0;
      let structuralFailure: string | null = null;
      let consecutiveStructuralFailures = 0;

      const monthDays = monthDates(year, month);
      const todayLocal = localDateString(now);
      const firstEligibleDay = monthDays.findIndex(d => d >= todayLocal);
      const daysToPlan = firstEligibleDay >= 0 ? monthDays.slice(firstEligibleDay) : monthDays;
      logger.scheduler(`PLANNER_WINDOW month=${monthPrefix} firstDay=${daysToPlan[0]} lastDay=${daysToPlan[daysToPlan.length - 1]} days=${daysToPlan.length}`);

      outer: for (const date of daysToPlan) {
        for (const time of hours) {
          const totalConfirmedThisMonth = reservedMonth + scheduled.filter(p => p.status === 'scheduled').length;
          if (totalConfirmedThisMonth >= monthlyLimit) break outer;

          const confirmedToday = confirmed.filter(c => localDateString(new Date(c.published_at || c.scheduled_at)) === date).length;
          const scheduledToday = scheduled.filter(s => s.status === 'scheduled' && localDateString(new Date(s.scheduled_at)) === date).length;
          if (confirmedToday + scheduledToday >= settings.daily_limit) break;

          const slotIso = localIso(date, time);
          if (new Date(slotIso).getTime() <= Date.now() || usedSlots.has(slotIso)) continue;

          while (candidateIndex < candidates.length && usedProducts.has(candidates[candidateIndex].id)) {
            candidateIndex++;
          }
          const product = candidates[candidateIndex++];
          if (!product) break outer;
          if (publishedProductIds.has(product.id) || publishedIdentityKeys.has(product.product_identity_key)) {
            logger.scheduler('PRODUCT_ALREADY_USED_GUARD product=' + product.id + ' identity=' + product.product_identity_key);
            usedProducts.add(product.id);
            continue;
          }

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
              content: '',
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
                consecutiveStructuralFailures = 0;
                usedProducts.add(product.id);
                usedSlots.add(normalizeScheduledAt(result.scheduled_at));
                scheduledSincePlannerReconciliation += 1;

                if (scheduledSincePlannerReconciliation >= 5) {
                  logger.scheduler('PLANNER_RECONCILIATION_PERIODIC trigger=5_confirmed');
                  const plannerAll = await storage.getPublications();
                  await this.reconcileNearTermScheduledPublications(plannerAll, settings, Date.now());
                  scheduledSincePlannerReconciliation = 0;
                }
              } else if (STRUCTURAL_FACEBOOK_ERRORS.has(result.error_message || '')) {
                consecutiveStructuralFailures += 1;
                logger.scheduler(`RUNTIME_SCHEDULE_FAILED product=${product.id} slot=${date}T${time} error=${result.error_message}`, 'error');
                if (consecutiveStructuralFailures >= 2) {
                  structuralFailure = result.error_message || 'FACEBOOK_STRUCTURAL_FAILURE';
                  break outer;
                }
              } else {
                consecutiveStructuralFailures = 0;
                logger.scheduler(`RUNTIME_SCHEDULE_FAILED product=${product.id} slot=${date}T${time} error=${result.error_message}`, 'error');
              }
            }
          } catch (itemErr: any) {
            const errorMessage = String(itemErr?.message || itemErr || 'ITEM_SCHEDULE_ERROR');
            logger.scheduler(`ITEM_SCHEDULE_ERROR id=${publication.id} product=${product.id} slot=${date}T${time} error=${errorMessage}`, 'warn');

            if (STRUCTURAL_FACEBOOK_ERRORS.has(errorMessage)) {
              consecutiveStructuralFailures += 1;
              if (consecutiveStructuralFailures >= 2) {
                structuralFailure = errorMessage;
                break outer;
              }
            } else {
              consecutiveStructuralFailures = 0;
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

    const safeCopy = await contentService.ensureCopyForPublication(pub.product, pub.content || pub.product.facebook_copy);
    const content = safeCopy.content?.trim();
    if (!content) throw new Error('FACEBOOK_COPY_REGENERATION_FAILED');

    const previousCopy = (pub.content || '').trim();
    const repaired = content !== previousCopy;
    if (repaired) {
      logger.scheduler(`COPY_REPAIRED id=${pub.id} product=${pub.product_id}`, 'warn');
      const updated = await storage.updatePublication(pub.id, {
        content,
        error_message: undefined,
        attempts: 0,
        status: 'draft'
      });
      if (!updated) throw new Error('FACEBOOK_COPY_REPAIR_PERSIST_FAILED');
      pub.attempts = 0;
      pub.status = 'draft';
    }

    pub.content = content;
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
        if (!check.verified) {
          logger.scheduler(`UNKNOWN_PLANNER_UNVERIFIED id=${pub.id} consulta instável; mantendo unknown e bloqueando novo envio para não duplicar`, 'warn');
          return storage.updatePublication(pub.id, {
            status: 'unknown',
            error_message: 'UNKNOWN_PLANNER_UNVERIFIED: Planner não pôde confirmar a ausência; novo envio bloqueado.'
          });
        }
        logger.scheduler(`UNKNOWN_CONFIRMED_ABSENT id=${pub.id} ausente confirmado no planner. Prosseguindo com agendamento seguro.`);
      } catch (err: any) {
        const errorMessage = `UNKNOWN_PLANNER_CHECK_FAILED: ${err.message || 'falha desconhecida ao consultar o planner Facebook'}`;
        logger.scheduler(`UNKNOWN_PRE_CHECK_FAILED id=${pub.id}: ${errorMessage}; mantendo estado unknown e bloqueando novo envio`, 'warn');
        return storage.updatePublication(pub.id, {
          status: 'unknown',
          error_message: errorMessage,
          next_attempt_at: undefined
        });
      }
    }

    const currentAttempts = Number.isFinite(Number(pub.attempts)) ? Math.max(0, Math.trunc(Number(pub.attempts))) : 0;
    const maxAttempts = Math.max(1, Number.isFinite(Number(pub.max_attempts)) ? Math.trunc(Number(pub.max_attempts)) : 3);

    if (currentAttempts >= maxAttempts) {
      logger.scheduler(`PROGRAM_SKIP_MAX_ATTEMPTS id=${pub.id} attempts=${currentAttempts} max=${maxAttempts}`, 'warn');
      return pub;
    }
    const attempts = currentAttempts + 1;

    await storage.updatePublication(pub.id, {
      status: 'attempting',
      attempts,
      error_message: undefined
    });

    logger.scheduler(`PROGRAM_START id=${pub.id} product=${pub.product_id} date=${date} time=${time} attempt=${attempts}/${maxAttempts}`);

    const groupUrl = normalizeGroupUrl(pub.facebook_group_url || settings.facebook_group_url);
    await this.waitForSchedulePacing();

    try {
      const result = await facebookAutomation.schedule({
        groupUrl,
        content: pub.content,
        affiliateUrl: pub.product.affiliate_url,
        scheduledDate: date,
        scheduledTime: time,
        productName: pub.product.product_name,
        sku: pub.product.sku
      });

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

      const backoffMinutes = Math.min(120, Math.pow(2, attempts) * 5);
      const nextAttemptAt = attempts < maxAttempts ? new Date(Date.now() + backoffMinutes * 60000).toISOString() : undefined;

      logger.scheduler(`FACEBOOK_SCHEDULE_FAILED id=${pub.id} attempts=${attempts}/${maxAttempts} next=${nextAttemptAt || 'none'} err=${result.error}`, 'error');
      return storage.updatePublication(pub.id, {
        status: 'failed',
        attempts,
        error_message: result.error || 'Facebook não confirmou o agendamento.',
        next_attempt_at: nextAttemptAt
      });
    } catch (err: any) {
      const errorMessage = String(err?.message || err || 'FACEBOOK_SCHEDULE_EXCEPTION');
      logger.scheduler(`FACEBOOK_SCHEDULE_EXCEPTION id=${pub.id} attempts=${attempts}/${maxAttempts} err=${errorMessage}`, 'error');
      const backoffMinutes = Math.min(120, Math.pow(2, attempts) * 5);
      const nextAttemptAt = attempts < maxAttempts ? new Date(Date.now() + backoffMinutes * 60000).toISOString() : undefined;
      return storage.updatePublication(pub.id, {
        status: 'failed',
        attempts,
        error_message: errorMessage,
        next_attempt_at: nextAttemptAt
      });
    }
  }

  async checkAndProcessDuePublications(): Promise<number> {
    return this.withSchedulerLock('process-due', async () => {
      const now = Date.now();
      const settings = await storage.getSettings();

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
          } else if (check.verified) {
            logger.scheduler(`UNKNOWN_VERIFIED_ABSENT id=${pub.id}; resetting to draft for safe retry`, 'warn');
            await storage.updatePublication(pub.id, {
              status: 'draft',
              error_message: 'Verificado ausente no planner após incerteza anterior.'
            });
          } else {
            logger.scheduler(`UNKNOWN_CHECK_UNVERIFIED id=${pub.id}; ausência não confirmada, mantendo unknown`, 'warn');
          }
        } catch (err: any) {
          logger.scheduler(`UNKNOWN_CHECK_FAILED id=${pub.id}: ${err.message}`, 'warn');
        }
      }

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
    }

    if (!check.verified) {
      logger.scheduler(`RECONCILE_UNKNOWN_UNVERIFIED id=${pub.id} consulta instável; mantendo status unknown`, 'warn');
      return pub;
    }

    logger.scheduler(`RECONCILE_UNKNOWN_ABSENT id=${pub.id} ausência confirmada no planner.`, 'warn');
    const updated = await storage.updatePublication(pub.id, {
      status: 'draft',
      error_message: 'Verificado ausente no planner Facebook.'
    });
    return updated || pub;
  }

  async publishNow(_publicationId: string): Promise<Publication | undefined> {
    throw new Error('FACEBOOK_IMMEDIATE_PUBLISH_DISABLED');
  }

  async reschedule(_publicationId: string, _scheduledAt: string): Promise<Publication | undefined> {
    throw new Error('FACEBOOK_RESCHEDULE_DISABLED');
  }

  async cancel(_publicationId: string): Promise<Publication | undefined> {
    throw new Error('FACEBOOK_NATIVE_CANCEL_UNSUPPORTED');
  }

  async retry(publicationId: string): Promise<Publication | undefined> {
    return this.schedulePublication(publicationId);
  }

  async getRuntimePublications(): Promise<Publication[]> {
    return storage.getPublications();
  }

  async createPublication(productId: string, scheduledAt: string, content: string, groupUrl?: string): Promise<Publication> {
    const product = await storage.getProductById(productId);
    if (!product) throw new Error('Produto não encontrado.');
    const settings = await storage.getSettings();
    const safeContent = String(content || '').trim() || product.facebook_copy?.trim() || '';
    const publication = await storage.createPublication({
      product_id: productId,
      scheduled_at: scheduledAt,
      status: 'draft',
      content: safeContent,
      facebook_group_url: normalizeGroupUrl(groupUrl || settings.facebook_group_url)
    });
    logger.scheduler(`QUEUE_CREATED id=${publication.id} product=${productId} slot=${scheduledAt}`);
    return publication;
  }
}

export const scheduler = new SchedulerService();