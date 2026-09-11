import { Publication, OperationalQuota } from '../types.js';
import { storage } from './StorageService.js';
import { contentService } from './ContentService.js';
import { facebookService } from './FacebookService.js';
import { logger } from './LoggerService.js';

export class SchedulerService {
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private lastAutoScheduleAt = 0;

  constructor() { this.startBackgroundTimer(); }

  startBackgroundTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.checkAndProcessDuePublications().catch(err => logger.scheduler(`Erro: ${err.message}`, 'error')), 60000);
    void this.checkAndProcessDuePublications().catch(err => logger.scheduler(`Erro inicial: ${err.message}`, 'error'));
    if (this.timer && typeof this.timer.unref === 'function') this.timer.unref();
  }

  stopBackgroundTimer() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  async scheduleDailyBatch(targetDateStr?: string): Promise<{ scheduled: Publication[]; quota: OperationalQuota; message: string }> {
    const settings = await storage.getSettings();
    const allPublications = await storage.getPublications();
    const targetDate = targetDateStr ? new Date(`${targetDateStr}T00:00:00`) : new Date();
    const datePrefix = targetDate.toISOString().slice(0, 10);
    const monthPrefix = datePrefix.slice(0, 7);
    const reservedToday = allPublications.filter(p => ['scheduled', 'publishing', 'published'].includes(p.status) && (p.published_at || p.scheduled_at).startsWith(datePrefix)).length;
    const reservedMonth = allPublications.filter(p => ['scheduled', 'publishing', 'published'].includes(p.status) && (p.published_at || p.scheduled_at).startsWith(monthPrefix)).length;

    if (reservedMonth >= settings.monthly_limit) return { scheduled: [], quota: await storage.getQuota(), message: `Limite mensal reservado atingido (${reservedMonth}/${settings.monthly_limit}).` };
    if (reservedToday >= settings.daily_limit) return { scheduled: [], quota: await storage.getQuota(), message: `Limite diário reservado atingido (${reservedToday}/${settings.daily_limit}).` };

    const slotsAvailable = Math.min(settings.daily_limit - reservedToday, settings.monthly_limit - reservedMonth);
    const products = await storage.getProducts(true);
    const usedProductIds = new Set(allPublications.map(p => p.product_id));
    const candidates = products.filter(p => !usedProductIds.has(p.id) && p.current_price > 0 && p.product_name && p.original_url && /^https?:\/\//i.test(p.affiliate_url) && p.affiliate_url.includes('/20889'));
    if (!candidates.length) return { scheduled: [], quota: await storage.getQuota(), message: 'Nenhum produto real e elegível disponível. Execute o crawler.' };

    const hours = settings.daily_hours.length ? settings.daily_hours : ['08:00', '11:00', '14:00', '17:00', '20:00'];
    const scheduled: Publication[] = [];
    const occupiedSlots = new Set(allPublications.filter(p => ['scheduled', 'publishing', 'published'].includes(p.status)).map(p => {
      const value = p.published_at || p.scheduled_at;
      if (!value || !value.startsWith(datePrefix)) return '';
      return new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    }).filter(Boolean));
    const availableHours = hours.filter(time => !occupiedSlots.has(time));
    for (const [index, product] of candidates.slice(0, Math.min(slotsAvailable, availableHours.length)).entries()) {
      const time = availableHours[index] || '08:00';
      const [hour, minute] = time.split(':').map(Number);
      if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) { logger.scheduler(`Horário inválido ignorado: ${time}`, 'error'); continue; }
      const localDate = new Date(targetDate); localDate.setHours(hour, minute, 0, 0);
      if (localDate.getTime() <= Date.now()) continue;
      const content = product.facebook_copy?.trim();
      if (!content || /https?:\/\//i.test(content) || /R\$/i.test(content)) {
        logger.scheduler(`Conteúdo rejeitado para ${product.product_name}: copy canônica ausente ou inválida. Execute o backfill antes do agendamento.`, 'error');
        continue;
      }
      const publication = await storage.createPublication({ product_id: product.id, scheduled_at: localDate.toISOString(), status: 'scheduled', content, facebook_group_url: settings.facebook_group_url });
      const result = await facebookService.publishScheduledPublication({ groupUrl: settings.facebook_group_url, content, affiliateUrl: product.affiliate_url, scheduledDate: datePrefix, scheduledTime: time });
      if (result.success) { scheduled.push(publication); logger.scheduler(`Publicação ${publication.id} agendada no Facebook para ${result.scheduledAt || localDate.toISOString()}.`); }
      else { await storage.updatePublication(publication.id, { status: 'failed', error_message: result.error || 'Facebook não confirmou o agendamento.' }); logger.scheduler(`Falha ao agendar ${publication.id}: ${result.error || 'erro desconhecido'}`, 'error'); }
    }
    return { scheduled, quota: await storage.getQuota(), message: `${scheduled.length} publicações enviadas ao agendamento nativo do Facebook.` };
  }

  async schedulePublication(publicationId: string): Promise<Publication | undefined> {
    const pub = await storage.getPublicationById(publicationId);
    if (!pub) throw new Error('Publicação não encontrada.');
    if (pub.status !== 'scheduled') throw new Error('Somente publicações pendentes podem ser programadas.');
    if (!pub.product?.affiliate_url?.endsWith('/20889')) throw new Error('Produto sem link afiliado /20889 válido.');
    const scheduledDate = new Date(pub.scheduled_at);
    if (Number.isNaN(scheduledDate.getTime())) throw new Error('Data/hora de programação inválida.');
    if (scheduledDate.getTime() <= Date.now()) throw new Error('Escolha uma data/hora futura para programar.');

    const settings = await storage.getSettings();
    const date = scheduledDate.toISOString().slice(0, 10);
    const time = scheduledDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    const result = await facebookService.publishScheduledPublication({ groupUrl: pub.facebook_group_url || settings.facebook_group_url, content: pub.content, affiliateUrl: pub.product.affiliate_url, scheduledDate: date, scheduledTime: time });

    const attempts = (pub.attempts || 0) + 1;
    if (!result.success) {
      const maxAttempts = pub.max_attempts || 3;
      if (attempts < maxAttempts) {
        const backoffMinutes = Math.min(60, 5 * Math.pow(2, attempts - 1));
        const nextAttempt = new Date(Date.now() + backoffMinutes * 60000).toISOString();
        logger.scheduler(`Falha temporária ${pub.id} (tentativa ${attempts}/${maxAttempts}); retry em ${backoffMinutes} min.`, 'warn');
        return storage.updatePublication(pub.id, { status: 'scheduled', attempts, max_attempts: maxAttempts, next_attempt_at: nextAttempt, error_message: result.error || 'Falha temporária no Facebook.' });
      }
      logger.scheduler(`Publicação ${pub.id} falhou definitivamente após ${attempts} tentativas.`, 'error');
      return storage.updatePublication(pub.id, { status: 'failed', attempts, max_attempts: maxAttempts, next_attempt_at: undefined, error_message: result.error || 'Facebook não confirmou a programação.' });
    }
    logger.scheduler(`Programação confirmada: ${pub.id} -> ${result.scheduledAt || scheduledDate.toISOString()}`);
    return storage.updatePublication(pub.id, { status: 'scheduled', attempts, next_attempt_at: undefined, error_message: undefined, scheduled_at: result.scheduledAt || scheduledDate.toISOString() });
  }

  async checkAndProcessDuePublications(): Promise<number> {
    if (this.isProcessing) return 0;
    const now = Date.now();
    if (now - this.lastAutoScheduleAt < 30000) return 0;
    this.isProcessing = true;
    this.lastAutoScheduleAt = now;
    try {
      const settings = await storage.getSettings();
      if (!settings.facebook_group_url?.includes('/groups/')) {
        logger.scheduler('Agendamento automático pausado: grupo do Facebook não configurado.', 'warn');
        return 0;
      }
      // Only retry publications that explicitly have a retry scheduled.
      // A successful native Facebook schedule remains "scheduled" locally and must
      // never be submitted to Facebook again by the background loop.
      const due = (await storage.getPublications('scheduled')).filter(p => {
        if (!p.next_attempt_at) return false;
        return new Date(p.next_attempt_at).getTime() <= now
          && new Date(p.scheduled_at).getTime() > now;
      });
      for (const pub of due) {
        try { await this.schedulePublication(pub.id); }
        catch (error) { logger.scheduler(`Erro ao processar ${pub.id}: ${error instanceof Error ? error.message : String(error)}`, 'error'); }
      }
      const result = await this.scheduleDailyBatch();
      if (result.scheduled.length > 0) {
        logger.scheduler(`Agendamento automático: ${result.scheduled.length} publicação(ões) enviadas ao Facebook.`);
      }
      return result.scheduled.length;
    } finally {
      this.isProcessing = false;
    }
  }

  async publishNow(publicationId: string): Promise<Publication | undefined> {
    const pub = await storage.getPublicationById(publicationId);
    if (!pub) throw new Error('Publicação não encontrada.');
    if (pub.status === 'published') return pub;
    await storage.updatePublication(pub.id, { status: 'publishing', error_message: undefined });
    const result = await facebookService.publishSingle(pub);
    return storage.updatePublication(pub.id, result.success ? { status: 'published', published_at: new Date().toISOString(), facebook_post_url: result.postUrl, error_message: undefined } : { status: 'failed', error_message: result.error || 'Falha na publicação real.' });
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
