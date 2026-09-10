import { Publication, OperationalQuota } from '../types.js';
import { storage } from './StorageService.js';
import { contentService } from './ContentService.js';
import { facebookService } from './FacebookService.js';
import { logger } from './LoggerService.js';

export class SchedulerService {
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor() { this.startBackgroundTimer(); }

  startBackgroundTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.checkAndProcessDuePublications().catch(err => logger.scheduler(`Erro: ${err.message}`, 'error')), 60000);
    if (this.timer && typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  stopBackgroundTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async scheduleDailyBatch(targetDateStr?: string): Promise<{ scheduled: Publication[]; quota: OperationalQuota; message: string }> {
    const settings = await storage.getSettings();
    const allPublications = await storage.getPublications();
    const targetDate = targetDateStr ? new Date(targetDateStr) : new Date();
    const datePrefix = targetDate.toISOString().slice(0, 10);
    const monthPrefix = datePrefix.slice(0, 7);

    const reservedToday = allPublications.filter(p =>
      ['scheduled', 'publishing', 'published'].includes(p.status) && (p.published_at || p.scheduled_at).startsWith(datePrefix)
    ).length;
    const reservedMonth = allPublications.filter(p =>
      ['scheduled', 'publishing', 'published'].includes(p.status) && (p.published_at || p.scheduled_at).startsWith(monthPrefix)
    ).length;

    if (reservedMonth >= settings.monthly_limit) {
      const quota = await storage.getQuota();
      return { scheduled: [], quota, message: `Limite mensal reservado atingido (${reservedMonth}/${settings.monthly_limit}).` };
    }
    if (reservedToday >= settings.daily_limit) {
      const quota = await storage.getQuota();
      return { scheduled: [], quota, message: `Limite diário reservado atingido (${reservedToday}/${settings.daily_limit}).` };
    }

    const slotsAvailable = Math.min(settings.daily_limit - reservedToday, settings.monthly_limit - reservedMonth);
    const products = await storage.getProducts(true);
    const usedProductIds = new Set(allPublications.filter(p => ['scheduled', 'publishing', 'published'].includes(p.status)).map(p => p.product_id));
    const candidates = products.filter(p => !usedProductIds.has(p.id) && p.current_price > 0 && p.product_name && p.original_url && p.affiliate_url.endsWith('/20889'));

    if (!candidates.length) {
      const quota = await storage.getQuota();
      return { scheduled: [], quota, message: 'Nenhum produto real e elegível disponível. Execute o crawler.' };
    }

    const hours = settings.daily_hours.length ? settings.daily_hours : ['08:00', '11:00', '14:00', '17:00', '20:00'];
    const scheduled: Publication[] = [];

    for (const [index, product] of candidates.slice(0, slotsAvailable).entries()) {
      const [hour, minute] = (hours[index] || '08:00').split(':').map(Number);
      const scheduledAt = new Date(targetDate);
      scheduledAt.setHours(hour, minute, 0, 0);
      const generated = await contentService.generateCopyForProduct(product, settings.nvidia_model);
      scheduled.push(await storage.createPublication({
        product_id: product.id,
        scheduled_at: scheduledAt.toISOString(),
        status: 'scheduled',
        content: generated.content,
        facebook_group_url: settings.facebook_group_url
      }));
    }

    const quota = await storage.getQuota();
    return { scheduled, quota, message: `${scheduled.length} publicações reais agendadas.` };
  }

  async checkAndProcessDuePublications(): Promise<number> {
    if (this.isProcessing) return 0;
    this.isProcessing = true;
    try {
      const now = new Date();
      const due = (await storage.getPublications()).filter(p => p.status === 'scheduled' && new Date(p.scheduled_at) <= now);
      if (!due.length) return 0;
      for (const pub of due) await storage.updatePublication(pub.id, { status: 'publishing' });
      const { results } = await facebookService.publishBatch(due);
      let successCount = 0;
      for (const result of results) {
        if (result.success) {
          successCount++;
          await storage.updatePublication(result.id, { status: 'published', published_at: new Date().toISOString(), facebook_post_url: result.postUrl, error_message: undefined });
        } else {
          await storage.updatePublication(result.id, { status: 'failed', error_message: result.error || 'Falha na publicação real.' });
        }
      }
      logger.scheduler(`Lote concluído: ${successCount} publicados, ${due.length - successCount} falhos.`);
      return successCount;
    } finally {
      this.isProcessing = false;
    }
  }

  async publishNow(publicationId: string): Promise<Publication | undefined> {
    const pub = await storage.getPublicationById(publicationId);
    if (!pub) throw new Error('Publicação não encontrada.');
    await storage.updatePublication(pub.id, { status: 'publishing' });
    const result = await facebookService.publishSingle(pub);
    return storage.updatePublication(pub.id, result.success
      ? { status: 'published', published_at: new Date().toISOString(), facebook_post_url: result.postUrl, error_message: undefined }
      : { status: 'failed', error_message: result.error || 'Falha na publicação real.' });
  }

  async reschedule(publicationId: string, newDateIso: string) {
    return storage.updatePublication(publicationId, { scheduled_at: newDateIso, status: 'scheduled', error_message: undefined });
  }

  async cancel(publicationId: string) {
    return storage.updatePublication(publicationId, { status: 'cancelled' });
  }
}

export const scheduler = new SchedulerService();
