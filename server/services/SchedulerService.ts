import { Publication, OperationalQuota } from '../types.js';
import { storage } from './StorageService.js';
import { facebookAutomation } from './FacebookAutomationService.js';
import { logger } from './LoggerService.js';

export class SchedulerService {
  async scheduleDailyBatch(targetDateStr?: string): Promise<{ scheduled: Publication[]; quota: OperationalQuota; message: string }> {
    const settings = await storage.getSettings();
    const allPublications = await storage.getPublications();
    const targetDate = targetDateStr ? new Date(targetDateStr + 'T00:00:00') : new Date();
    const datePrefix = targetDate.toISOString().slice(0, 10);
    const monthPrefix = datePrefix.slice(0, 7);

    const active = ['scheduled', 'publishing', 'published'];
    const reservedToday = allPublications.filter(p => active.includes(p.status) && (p.published_at || p.scheduled_at).startsWith(datePrefix)).length;
    const reservedMonth = allPublications.filter(p => active.includes(p.status) && (p.published_at || p.scheduled_at).startsWith(monthPrefix)).length;

    if (reservedMonth >= settings.monthly_limit) {
      return { scheduled: [], quota: await storage.getQuota(), message: 'Limite mensal reservado atingido (' + reservedMonth + '/' + settings.monthly_limit + ').' };
    }
    if (reservedToday >= settings.daily_limit) {
      return { scheduled: [], quota: await storage.getQuota(), message: 'Limite diário reservado atingido (' + reservedToday + '/' + settings.daily_limit + ').' };
    }

    const slotsAvailable = Math.min(settings.daily_limit - reservedToday, settings.monthly_limit - reservedMonth);
    const products = await storage.getProducts(true);
    const usedProductIds = new Set(allPublications.map(p => p.product_id));
    const candidates = products.filter(p =>
      !usedProductIds.has(p.id) &&
      p.current_price > 0 &&
      !!p.product_name &&
      /^https?:\/\//i.test(p.original_url) &&
      /^https?:\/\//i.test(p.affiliate_url) &&
      p.affiliate_url.includes('/20889') &&
      !!p.facebook_copy?.trim() &&
      !/https?:\/\//i.test(p.facebook_copy) &&
      !/R\$/i.test(p.facebook_copy)
    );

    if (!candidates.length) {
      return { scheduled: [], quota: await storage.getQuota(), message: 'Nenhum produto real e elegível disponível.' };
    }

    const hours = settings.daily_hours.length ? settings.daily_hours : ['08:00', '11:00', '14:00', '17:00', '20:00'];
    const occupiedSlots = new Set(
      allPublications
        .filter(p => active.includes(p.status))
        .map(p => {
          const value = p.published_at || p.scheduled_at;
          if (!value || !value.startsWith(datePrefix)) return '';
          return new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
        })
        .filter(Boolean)
    );

    const availableHours = hours.filter(time => !occupiedSlots.has(time));
    const scheduled: Publication[] = [];

    for (const product of candidates.slice(0, Math.min(slotsAvailable, availableHours.length))) {
      const time = availableHours[scheduled.length];
      if (!time) break;

      const [hour, minute] = time.split(':').map(Number);
      if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) continue;

      const localDate = new Date(targetDate);
      localDate.setHours(hour, minute, 0, 0);
      if (localDate.getTime() <= Date.now()) continue;

      const existing = allPublications.find(p => p.product_id === product.id && active.includes(p.status));
      if (existing) continue;

      const publication = await storage.createPublication({
        product_id: product.id,
        scheduled_at: localDate.toISOString(),
        status: 'scheduled',
        content: product.facebook_copy!.trim(),
        facebook_group_url: settings.facebook_group_url
      });

      logger.scheduler('BATCH_CREATED id=' + publication.id + ' product=' + product.id + ' slot=' + time);

      const result = await facebookAutomation.schedule({
        groupUrl: settings.facebook_group_url,
        content: product.facebook_copy!.trim(),
        affiliateUrl: product.affiliate_url,
        scheduledDate: datePrefix,
        scheduledTime: time
      });

      if (result.success) {
        scheduled.push(await storage.updatePublication(publication.id, {
          status: 'scheduled',
          scheduled_at: result.scheduledAt || localDate.toISOString(),
          error_message: undefined,
          next_attempt_at: undefined
        }) as Publication);
        logger.scheduler('BATCH_FACEBOOK_CONFIRMED id=' + publication.id + ' slot=' + time, 'success');
      } else {
        await storage.updatePublication(publication.id, {
          status: 'failed',
          error_message: result.error || 'Facebook não confirmou o agendamento.'
        });
        logger.scheduler('BATCH_FACEBOOK_FAILED id=' + publication.id + ' error=' + (result.error || 'unknown'), 'error');
      }
    }

    return {
      scheduled,
      quota: await storage.getQuota(),
      message: scheduled.length + ' publicação(ões) confirmadas no fluxo nativo do Facebook.'
    };
  }

  async schedulePublication(publicationId: string): Promise<Publication | undefined> {
    const pub = await storage.getPublicationById(publicationId);
    if (!pub) throw new Error('Publicação não encontrada.');
    if (!['scheduled', 'failed'].includes(pub.status)) throw new Error('Somente publicações pendentes ou falhadas podem ser programadas.');
    if (!pub.product?.affiliate_url?.includes('/20889')) throw new Error('Produto sem link afiliado /20889 válido.');
    if (!pub.content?.trim() || /https?:\/\//i.test(pub.content) || /R\$/i.test(pub.content)) {
      throw new Error('Publicação bloqueada: copy contém URL ou preço.');
    }

    const scheduledDate = new Date(pub.scheduled_at);
    if (Number.isNaN(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now()) {
      throw new Error('Escolha uma data/hora futura para programar.');
    }

    const settings = await storage.getSettings();
    const date = scheduledDate.toISOString().slice(0, 10);
    const time = scheduledDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    const attempts = (pub.attempts || 0) + 1;

    logger.scheduler('PROGRAM_START id=' + pub.id + ' product=' + pub.product_id + ' date=' + date + ' time=' + time + ' attempt=' + attempts);

    const result = await facebookAutomation.schedule({
      groupUrl: pub.facebook_group_url || settings.facebook_group_url,
      content: pub.content,
      affiliateUrl: pub.product.affiliate_url,
      scheduledDate: date,
      scheduledTime: time
    });

    if (!result.success) {
      const maxAttempts = pub.max_attempts || 3;
      if (attempts < maxAttempts) {
        const backoffMinutes = Math.min(60, 5 * Math.pow(2, attempts - 1));
        const nextAttempt = new Date(Date.now() + backoffMinutes * 60000).toISOString();
        logger.scheduler('PROGRAM_RETRY id=' + pub.id + ' next=' + nextAttempt + ' error=' + (result.error || 'unknown'), 'warn');
        return storage.updatePublication(pub.id, {
          status: 'scheduled',
          attempts,
          max_attempts: maxAttempts,
          next_attempt_at: nextAttempt,
          error_message: result.error || 'Falha temporária no Facebook.'
        });
      }

      logger.scheduler('PROGRAM_FAILED_FINAL id=' + pub.id + ' error=' + (result.error || 'unknown'), 'error');
      return storage.updatePublication(pub.id, {
        status: 'failed',
        attempts,
        max_attempts: maxAttempts,
        next_attempt_at: undefined,
        error_message: result.error || 'Facebook não confirmou a programação.'
      });
    }

    logger.scheduler('PROGRAM_CONFIRMED id=' + pub.id + ' scheduledAt=' + (result.scheduledAt || scheduledDate.toISOString()), 'success');
    return storage.updatePublication(pub.id, {
      status: 'scheduled',
      attempts,
      next_attempt_at: undefined,
      error_message: undefined,
      scheduled_at: result.scheduledAt || scheduledDate.toISOString()
    });
  }

  async checkAndProcessDuePublications(): Promise<number> {
    const now = Date.now();
    const due = (await storage.getPublications('scheduled')).filter(
      p => p.next_attempt_at &&
        new Date(p.next_attempt_at).getTime() <= now &&
        new Date(p.scheduled_at).getTime() > now
    );

    logger.scheduler('DUE_SCAN count=' + due.length);
    for (const pub of due) {
      await this.schedulePublication(pub.id);
    }
    return due.length;
  }

  async publishNow(_publicationId: string): Promise<Publication | undefined> {
    throw new Error('PUBLICAR_AGORA_DESABILITADO: use Programar para o agendamento nativo do Facebook.');
  }

  async reschedule(_publicationId: string, _newDateIso: string): Promise<Publication | undefined> {
    throw new Error('FACEBOOK_NATIVE_RESCHEDULE_UNSUPPORTED: reagendamento nativo deve ser feito no Facebook.');
  }

  async cancel(_publicationId: string): Promise<Publication | undefined> {
    throw new Error('FACEBOOK_NATIVE_CANCEL_UNSUPPORTED: cancelamento nativo deve ser feito no Facebook.');
  }
}

export const scheduler = new SchedulerService();
