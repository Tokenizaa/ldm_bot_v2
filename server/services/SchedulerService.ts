import { Publication, Product, OperationalQuota } from '../types.js';
import { storage } from './StorageService.js';
import { contentService } from './ContentService.js';
import { facebookService } from './FacebookService.js';
import { logger } from './LoggerService.js';
import { buildAffiliateUrl } from '../utils/affiliate.js';

export class SchedulerService {
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor() {
    // Start interval to check due publications every 60 seconds
    this.startBackgroundTimer();
  }

  startBackgroundTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.checkAndProcessDuePublications().catch(err => {
        logger.scheduler(`Error checking due publications: ${err.message}`, 'error');
      });
    }, 60000);
  }

  stopBackgroundTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Requirement 20 & 28: Generates the daily batch of 5 publications for today.
   * Enforces:
   * - Daily limit (up to 5/day)
   * - Monthly limit (up to 150/month)
   * - Non-duplicated products (never published or not recently published)
   * - Generation of copy with NVIDIA AI
   * - 5 daily time slots (e.g. 08:00, 11:00, 14:00, 17:00, 20:00)
   */
  async scheduleDailyBatch(targetDateStr?: string): Promise<{
    scheduled: Publication[];
    quota: OperationalQuota;
    message: string;
  }> {
    const quota = await storage.getQuota();
    const settings = await storage.getSettings();

    // Check monthly limit
    if (quota.monthly_publication_count >= quota.monthly_limit) {
      const msg = `Limite mensal atingido (${quota.monthly_publication_count}/${quota.monthly_limit}). Nenhuma nova publicação agendada.`;
      logger.scheduler(msg, 'warn');
      return { scheduled: [], quota, message: msg };
    }

    // Check daily limit
    const slotsAvailableToday = Math.max(0, quota.daily_limit - quota.daily_publication_count);
    if (slotsAvailableToday <= 0) {
      const msg = `Limite diário de hoje já foi atingido (${quota.daily_publication_count}/${quota.daily_limit}).`;
      logger.scheduler(msg, 'warn');
      return { scheduled: [], quota, message: msg };
    }

    const maxCanSchedule = Math.min(slotsAvailableToday, quota.remaining_month);

    // Fetch all products
    const products = await storage.getProducts(true);
    const existingPubs = await storage.getPublications();
    const publishedProductIds = new Set(existingPubs.map(p => p.product_id));

    // Filter available products (Requirement 20 & 23: valid, not duplicate, not already scheduled/published)
    const candidates = products.filter(p => {
      if (publishedProductIds.has(p.id)) return false;
      if (!p.current_price || p.current_price <= 0) return false;
      if (!p.product_name || !p.original_url) return false;
      return true;
    });

    if (candidates.length === 0) {
      const msg = 'Nenhum produto novo elegível encontrado para agendar. Execute o crawler primeiro.';
      logger.scheduler(msg, 'warn');
      return { scheduled: [], quota, message: msg };
    }

    const selectedProducts = candidates.slice(0, maxCanSchedule);
    const targetDate = targetDateStr ? new Date(targetDateStr) : new Date();
    const datePrefix = targetDate.toISOString().split('T')[0];

    const dailyHours = settings.daily_hours && settings.daily_hours.length > 0
      ? settings.daily_hours
      : ['08:00', '11:00', '14:00', '17:00', '20:00'];

    const newPublications: Publication[] = [];

    // Schedule each product into daily slots
    for (let i = 0; i < selectedProducts.length; i++) {
      const prod = selectedProducts[i];
      const slotHour = dailyHours[i % dailyHours.length] || '08:00';
      const [h, m] = slotHour.split(':').map(Number);

      const scheduledAt = new Date(targetDate);
      scheduledAt.setHours(h, m, 0, 0);

      // Generate copy using ContentService + NVIDIA AI
      const { content, affiliateUrl } = await contentService.generateCopyForProduct(prod, settings.nvidia_model);

      const pub = await storage.createPublication({
        product_id: prod.id,
        scheduled_at: scheduledAt.toISOString(),
        status: 'scheduled',
        content,
        facebook_group_url: settings.facebook_group_url
      });

      newPublications.push(pub);
    }

    logger.scheduler(`${newPublications.length} publications scheduled for ${datePrefix}`);

    const updatedQuota = await storage.getQuota();
    return {
      scheduled: newPublications,
      quota: updatedQuota,
      message: `${newPublications.length} publicações geradas e agendadas com sucesso!`
    };
  }

  /**
   * Checks for due publications whose scheduled_at <= now, and publishes them in batch.
   */
  async checkAndProcessDuePublications(): Promise<number> {
    if (this.isProcessing) return 0;
    this.isProcessing = true;

    try {
      const now = new Date();
      const publications = await storage.getPublications();

      // Find pending scheduled publications that are due
      const duePublications = publications.filter(p =>
        p.status === 'scheduled' && new Date(p.scheduled_at) <= now
      );

      if (duePublications.length === 0) {
        return 0;
      }

      logger.scheduler(`Found ${duePublications.length} due publications to process`);

      // Update status to publishing
      for (const pub of duePublications) {
        await storage.updatePublication(pub.id, { status: 'publishing' });
      }

      // Publish batch through persistent Facebook browser
      const { results } = await facebookService.publishBatch(duePublications);

      let successCount = 0;
      for (const res of results) {
        if (res.success) {
          successCount++;
          await storage.updatePublication(res.id, {
            status: 'published',
            published_at: new Date().toISOString(),
            facebook_post_url: res.postUrl,
            error_message: undefined
          });
        } else {
          // Requirement 29: failed with error message, do not count as published
          await storage.updatePublication(res.id, {
            status: 'failed',
            error_message: res.error || 'Falha desconhecida na publicação'
          });
        }
      }

      logger.scheduler(`Processing complete: ${successCount} published, ${duePublications.length - successCount} failed`);
      return successCount;
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Manual immediate publication of an item (or retry)
   */
  async publishNow(publicationId: string): Promise<Publication | undefined> {
    const pub = await storage.getPublicationById(publicationId);
    if (!pub) throw new Error('Publication not found');

    await storage.updatePublication(pub.id, { status: 'publishing' });

    const result = await facebookService.publishSingle(pub);

    if (result.success) {
      return await storage.updatePublication(pub.id, {
        status: 'published',
        published_at: new Date().toISOString(),
        facebook_post_url: result.postUrl,
        error_message: undefined
      });
    } else {
      return await storage.updatePublication(pub.id, {
        status: 'failed',
        error_message: result.error || 'Falha ao publicar no Facebook'
      });
    }
  }

  /**
   * Reschedule a publication
   */
  async reschedule(publicationId: string, newDateIso: string): Promise<Publication | undefined> {
    return await storage.updatePublication(publicationId, {
      scheduled_at: newDateIso,
      status: 'scheduled',
      error_message: undefined
    });
  }

  /**
   * Cancel a publication
   */
  async cancel(publicationId: string): Promise<Publication | undefined> {
    return await storage.updatePublication(publicationId, {
      status: 'cancelled'
    });
  }
}

export const scheduler = new SchedulerService();
