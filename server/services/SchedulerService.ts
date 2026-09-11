import { Publication, OperationalQuota } from '../types.js';
import { storage } from './StorageService.js';
import { contentService } from './ContentService.js';
import { facebookService } from './FacebookService.js';
import { logger } from './LoggerService.js';

export class SchedulerService {
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor() {
    this.startBackgroundTimer();
  }

  startBackgroundTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(
      () => this.checkAndProcessDuePublications().catch(err => logger.scheduler(`Erro: ${err.message}`, 'error')),
      60000
    );
    if (this.timer && typeof this.timer.unref === 'function') this.timer.unref();
  }

  stopBackgroundTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async scheduleDailyBatch(targetDateStr?: string): Promise<{ scheduled: Publication[]; quota: OperationalQuota; message: string }> {
    const settings = await storage.getSettings();
    const allPublications = await storage.getPublications();
    const targetDate = targetDateStr ? new Date(`${targetDateStr}T00:00:00`) : new Date();
    const datePrefix = targetDate.toISOString().slice(0, 10);
    const monthPrefix = datePrefix.slice(0, 7);

    const reservedToday = allPublications.filter(p =>
      ['scheduled', 'publishing', 'published'].includes(p.status) &&
      (p.published_at || p.scheduled_at).startsWith(datePrefix)
    ).length;
    const reservedMonth = allPublications.filter(p =>
      ['scheduled', 'publishing', 'published'].includes(p.status) &&
      (p.published_at || p.scheduled_at).startsWith(monthPrefix)
    ).length;

    if (reservedMonth >= settings.monthly_limit) {
      return {
        scheduled: [],
        quota: await storage.getQuota(),
        message: `Limite mensal reservado atingido (${reservedMonth}/${settings.monthly_limit}).`
      };
    }
    if (reservedToday >= settings.daily_limit) {
      return {
        scheduled: [],
        quota: await storage.getQuota(),
        message: `Limite diário reservado atingido (${reservedToday}/${settings.daily_limit}).`
      };
    }

    const slotsAvailable = Math.min(
      settings.daily_limit - reservedToday,
      settings.monthly_limit - reservedMonth
    );
    const products = await storage.getProducts(true);
    const usedProductIds = new Set(
      allPublications
        .filter(p => ['scheduled', 'publishing', 'published'].includes(p.status))
        .map(p => p.product_id)
    );
    const candidates = products.filter(p =>
      !usedProductIds.has(p.id) &&
      p.current_price > 0 &&
      p.product_name &&
      p.original_url &&
      /^https?:\/\//i.test(p.affiliate_url) &&
      p.affiliate_url.includes('/20889')
    );

    if (!candidates.length) {
      return {
        scheduled: [],
        quota: await storage.getQuota(),
        message: 'Nenhum produto real e elegível disponível. Execute o crawler.'
      };
    }

    const hours = settings.daily_hours.length
      ? settings.daily_hours
      : ['08:00', '11:00', '14:00', '17:00', '20:00'];
    const scheduled: Publication[] = [];

    for (const [index, product] of candidates.slice(0, slotsAvailable).entries()) {
      const time = hours[index] || '08:00';
      const [hour, minute] = time.split(':').map(Number);
      if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        logger.scheduler(`Horário inválido ignorado: ${time}`, 'error');
        continue;
      }

      const localDate = new Date(targetDate);
      localDate.setHours(hour, minute, 0, 0);
      if (localDate.getTime() <= Date.now()) continue;

      const generated = await contentService.generateCopyForProduct(product, settings.nvidia_model);
      if (!generated.content.includes(product.affiliate_url)) {
        logger.scheduler(`Conteúdo rejeitado para ${product.product_name}: URL afiliada ausente.`, 'error');
        continue;
      }

      const publication = await storage.createPublication({
        product_id: product.id,
        scheduled_at: localDate.toISOString(),
        status: 'scheduled',
        content: generated.content,
        facebook_group_url: settings.facebook_group_url
      });

      const result = await facebookService.publishScheduledPublication({
        groupUrl: settings.facebook_group_url,
        content: generated.content,
        affiliateUrl: product.affiliate_url,
        scheduledDate: datePrefix,
        scheduledTime: time
      });

      if (result.success) {
        scheduled.push(publication);
        logger.scheduler(`Publicação ${publication.id} agendada no Facebook para ${result.scheduledAt || localDate.toISOString()}.`);
      } else {
        await storage.updatePublication(publication.id, {
          status: 'failed',
          error_message: result.error || 'Facebook não confirmou o agendamento.'
        });
        logger.scheduler(`Falha ao agendar ${publication.id}: ${result.error || 'erro desconhecido'}`, 'error');
      }
    }

    const quota = await storage.getQuota();
    return {
      scheduled,
      quota,
      message: `${scheduled.length} publicações enviadas ao agendamento nativo do Facebook.`
    };
  }

  async checkAndProcessDuePublications(): Promise<number> {
    // Native Facebook schedules must not be published a second time by the local timer.
    return 0;
  }

  async publishNow(publicationId: string): Promise<Publication | undefined> {
    const pub = await storage.getPublicationById(publicationId);
    if (!pub) throw new Error('Publicação não encontrada.');
    if (pub.status === 'published') return pub;

    await storage.updatePublication(pub.id, { status: 'publishing', error_message: undefined });
    const result = await facebookService.publishSingle(pub);
    return storage.updatePublication(pub.id, result.success
      ? {
          status: 'published',
          published_at: new Date().toISOString(),
          facebook_post_url: result.postUrl,
          error_message: undefined
        }
      : {
          status: 'failed',
          error_message: result.error || 'Falha na publicação real.'
        });
  }

  async reschedule(publicationId: string, _newDateIso: string): Promise<Publication | undefined> {
    const pub = await storage.getPublicationById(publicationId);
    if (!pub) throw new Error('Publicação não encontrada.');
    if (pub.status !== 'scheduled') throw new Error('Somente publicações com status scheduled podem ser reagendadas.');
    throw new Error('FACEBOOK_NATIVE_RESCHEDULE_UNSUPPORTED: a publicação já foi agendada nativamente no Facebook; não altere apenas o registro local.');
  }

  async cancel(publicationId: string): Promise<Publication | undefined> {
    const pub = await storage.getPublicationById(publicationId);
    if (!pub) throw new Error('Publicação não encontrada.');
    if (pub.status !== 'scheduled') throw new Error('Somente publicações com status scheduled podem ser canceladas.');
    throw new Error('FACEBOOK_NATIVE_CANCEL_UNSUPPORTED: a publicação já foi agendada nativamente no Facebook; cancelar apenas o registro local criaria inconsistência.');
  }
}

export const scheduler = new SchedulerService();
