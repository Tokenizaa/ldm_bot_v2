import crypto from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Product, Publication, PublicationStatus, PriceHistory, AppSettings, OperationalQuota, DashboardStats } from '../types.js';
import { logger } from './LoggerService.js';
import { calculatePublicationIdempotencyKey, normalizeGroupUrl, normalizeScheduledAt, localDateString } from '../utils/idempotency.js';

const DEFAULT_SETTINGS: AppSettings = {
  facebook_group_url: process.env.FACEBOOK_GROUP_URL || '',
  daily_limit: 5,
  monthly_limit: 150,
  daily_hours: ['08:00', '11:00', '14:00', '17:00', '20:00'],
  crawler_categories: ['ferramentas-eletricas', 'ferramentas-manuais', 'mecanica-automotiva', 'solda', 'compressores-e-ar-comprimido'],
  crawler_target_urls: [
    'https://www.lojadomecanico.com.br/categoria/ferramentas-eletricas',
    'https://www.lojadomecanico.com.br/categoria/ferramentas-manuais',
    'https://www.lojadomecanico.com.br/categoria/mecanica-automotiva'
  ],
  nvidia_model: process.env.NVIDIA_MODEL || 'meta/llama-3.2-11b-vision-instruct'
};

export class StorageService {
  private readonly supabase: SupabaseClient;

  constructor() {
    const url = process.env.SUPABASE_URL?.trim();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !key) throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.');
    this.supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    logger.system('Supabase configurado como única fonte de verdade.');
  }

  getSupabaseClient(): SupabaseClient { return this.supabase; }
  isSupabaseActive(): boolean { return true; }

  private mapRowToProduct(row: any): Product {
    return {
      id: String(row.id), product_identity_key: String(row.product_identity_key || `sku:${row.id}`),
      product_name: String(row.product_name || ''), brand: row.brand ? String(row.brand) : undefined,
      category: row.category ? String(row.category) : undefined, sku: row.sku ? String(row.sku) : undefined,
      original_url: String(row.original_url || ''), affiliate_url: String(row.affiliate_url || ''),
      current_price: Number(row.current_price ?? 0), previous_price: row.previous_price != null ? Number(row.previous_price) : undefined,
      lowest_price: row.lowest_price != null ? Number(row.lowest_price) : undefined,
      image_url: row.image_url ? String(row.image_url) : undefined, facebook_copy: row.facebook_copy ? String(row.facebook_copy) : undefined, active: Boolean(row.monitored ?? true),
      last_scraped_at: row.last_checked_at || row.created_at || new Date().toISOString(),
      created_at: row.created_at || new Date().toISOString(), updated_at: row.last_checked_at || row.created_at || new Date().toISOString()
    };
  }

  private mapRowToPublication(row: any, product?: Product): Publication {
    return {
      id: String(row.id), product_id: String(row.affiliate_link_id || ''), product, scheduled_at: String(row.scheduled_at),
      status: (row.status || 'draft') as PublicationStatus, content: String(row.content || ''),
      facebook_group_url: row.group_id ? String(row.group_id) : undefined,
      facebook_post_url: row.facebook_post_id ? String(row.facebook_post_id) : undefined,
      idempotency_key: row.idempotency_key ? String(row.idempotency_key) : undefined,
      published_at: row.published_at ? String(row.published_at) : undefined,
      error_message: row.error_message ? String(row.error_message) : undefined,
      attempts: row.attempts != null ? Number(row.attempts) : 0,
      max_attempts: row.max_attempts != null ? Number(row.max_attempts) : 3,
      next_attempt_at: row.next_attempt_at ? String(row.next_attempt_at) : undefined,
      created_at: row.created_at || new Date().toISOString(), updated_at: row.last_attempt_at || row.created_at || new Date().toISOString()
    };
  }

  async getProducts(filterActive = false): Promise<Product[]> {
    let query = this.supabase.from('affiliate_links').select('*').order('created_at', { ascending: false });
    if (filterActive) query = query.eq('monitored', true);
    const { data, error } = await query;
    if (error) throw new Error(`Falha ao consultar produtos no Supabase: ${error.message}`);
    return (data || []).map(row => this.mapRowToProduct(row));
  }

  async getProductById(id: string): Promise<Product | undefined> {
    const { data, error } = await this.supabase.from('affiliate_links').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`Falha ao consultar produto no Supabase: ${error.message}`);
    return data ? this.mapRowToProduct(data) : undefined;
  }

  async getProductByIdentityKey(key: string): Promise<Product | undefined> {
    const { data, error } = await this.supabase.from('affiliate_links').select('*').eq('product_identity_key', key).maybeSingle();
    if (error) throw new Error(`Falha ao consultar produto por chave: ${error.message}`);
    return data ? this.mapRowToProduct(data) : undefined;
  }

  async upsertProduct(product: Omit<Product, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<{ product: Product; isNew: boolean; priceChanged: boolean; copyNeedsRegeneration: boolean }> {
    const existing = await this.getProductByIdentityKey(product.product_identity_key);
    const now = new Date().toISOString();
    if (existing) {
      const priceChanged = Math.abs(existing.current_price - product.current_price) > 0.01;
      const copyNeedsRegeneration = !existing.facebook_copy || existing.product_name !== product.product_name || existing.brand !== product.brand || existing.category !== product.category || existing.sku !== product.sku;
      if (priceChanged) await this.addPriceHistory({ product_id: existing.id, price: product.current_price, checked_at: now });
      const updatePayload: Record<string, any> = {
        product_name: product.product_name, brand: product.brand || null, category: product.category || null,
        sku: product.sku || null, image_url: product.image_url || null, facebook_copy: product.facebook_copy || null, original_url: product.original_url,
        affiliate_url: product.affiliate_url, current_price: product.current_price,
        previous_price: priceChanged ? existing.current_price : (existing.previous_price ?? null),
        lowest_price: Math.min(existing.lowest_price ?? product.current_price, product.current_price),
        monitored: product.active, last_checked_at: now
      };
      const { error } = await this.supabase.from('affiliate_links').update(updatePayload).eq('id', existing.id);
      if (error) throw new Error(`Falha ao atualizar produto em affiliate_links: ${error.message}`);
      const updated = await this.getProductById(existing.id);
      if (!updated) throw new Error(`Produto atualizado não pôde ser relido em affiliate_links: ${existing.id}`);
      return { product: updated, isNew: false, priceChanged, copyNeedsRegeneration };
    }

    const newId = product.id || crypto.randomUUID();
    const insertPayload: Record<string, any> = {
      id: newId, product_identity_key: product.product_identity_key, product_name: product.product_name,
      brand: product.brand || null, category: product.category || null, sku: product.sku || null,
      image_url: product.image_url || null, original_url: product.original_url, affiliate_url: product.affiliate_url,
      current_price: product.current_price, previous_price: product.previous_price ?? null,
      lowest_price: product.current_price, monitored: product.active, last_checked_at: now, created_at: now
    };
    const { data, error } = await this.supabase.from('affiliate_links').insert(insertPayload).select('*').single();
    if (error) {
      const concurrent = await this.getProductByIdentityKey(product.product_identity_key);
      if (concurrent) return this.upsertProduct(product);
      throw new Error(`Falha ao inserir produto em affiliate_links: ${error.message}`);
    }
    await this.addPriceHistory({ product_id: newId, price: product.current_price, checked_at: now });
    return { product: this.mapRowToProduct(data), isNew: true, priceChanged: false, copyNeedsRegeneration: true };
  }

  async updateProductCopy(productId: string, content: string): Promise<Product | undefined> {
    const clean = content.trim();
    if (!clean) throw new Error('Copy vazia não pode ser salva.');
    const { error } = await this.supabase.from('affiliate_links').update({ facebook_copy: clean }).eq('id', productId);
    if (error) throw new Error(`Falha ao salvar copy do produto: ${error.message}`);
    return this.getProductById(productId);
  }

  async countProductsWithoutFacebookCopy(): Promise<number> {
    const { count, error } = await this.supabase.from('affiliate_links').select('id', { count: 'exact', head: true }).or('facebook_copy.is.null,facebook_copy.eq.');
    if (error) throw new Error(`Falha ao contar produtos sem copy: ${error.message}`);
    return count || 0;
  }

  async addPriceHistory(entry: Omit<PriceHistory, 'id'>): Promise<PriceHistory> {
    const record = { id: crypto.randomUUID(), affiliate_link_id: entry.product_id, price: entry.price, checked_at: entry.checked_at || new Date().toISOString() };
    const { data, error } = await this.supabase.from('affiliate_price_history').insert(record).select('*').single();
    if (error) throw new Error(`Falha ao registrar histórico de preço: ${error.message}`);
    return { id: String(data.id), product_id: String(data.affiliate_link_id), price: Number(data.price), checked_at: String(data.checked_at) };
  }

  async getPriceHistoryForProduct(productId: string): Promise<PriceHistory[]> {
    const { data, error } = await this.supabase.from('affiliate_price_history').select('*').eq('affiliate_link_id', productId).order('checked_at', { ascending: true });
    if (error) throw new Error(`Falha ao consultar histórico de preço: ${error.message}`);
    return (data || []).map(row => ({ id: String(row.id), product_id: String(row.affiliate_link_id), price: Number(row.price), checked_at: String(row.checked_at) }));
  }

  async getPublications(status?: PublicationStatus): Promise<Publication[]> {
    let query = this.supabase.from('posts').select('*').order('scheduled_at', { ascending: true });
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw new Error(`Falha ao consultar posts no Supabase: ${error.message}`);
    const posts = data || [];
    if (!posts.length) return [];

    // Optimize N+1: Query ONLY the referenced product IDs instead of scanning all products
    const productIds = Array.from(new Set(posts.map(p => p.affiliate_link_id).filter(Boolean)));
    const productMap = new Map<string, Product>();
    if (productIds.length > 0) {
      const { data: productRows, error: prodError } = await this.supabase
        .from('affiliate_links')
        .select('*')
        .in('id', productIds);
      if (!prodError && productRows) {
        for (const row of productRows) {
          productMap.set(String(row.id), this.mapRowToProduct(row));
        }
      }
    }

    return posts.map(row => this.mapRowToPublication(row, productMap.get(row.affiliate_link_id)));
  }

  async getPublicationById(id: string): Promise<Publication | undefined> {
    const { data, error } = await this.supabase.from('posts').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`Falha ao consultar publicação no Supabase: ${error.message}`);
    if (!data) return undefined;
    const product = data.affiliate_link_id ? await this.getProductById(data.affiliate_link_id) : undefined;
    return this.mapRowToPublication(data, product);
  }

  async getPublicationsForProduct(productId: string): Promise<Publication[]> {
    const { data, error } = await this.supabase.from('posts').select('*').eq('affiliate_link_id', productId).order('scheduled_at', { ascending: true });
    if (error) throw new Error(`Falha ao consultar publicações do produto: ${error.message}`);
    const posts = data || [];
    if (!posts.length) return [];
    const product = await this.getProductById(productId);
    return posts.map(row => this.mapRowToPublication(row, product));
  }

  async createPublication(pub: Omit<Publication, 'id' | 'created_at' | 'updated_at'>): Promise<Publication> {
    const now = new Date().toISOString();
    const groupUrl = normalizeGroupUrl(pub.facebook_group_url || '');
    const scheduledAt = normalizeScheduledAt(pub.scheduled_at);
    const key = calculatePublicationIdempotencyKey(pub.product_id, groupUrl, scheduledAt);

    // Initial state is strictly 'draft' unless deliberately initialized as 'attempting'
    const initialStatus: PublicationStatus = pub.status === 'attempting' ? 'attempting' : 'draft';

    const record = {
      id: crypto.randomUUID(),
      affiliate_link_id: pub.product_id,
      scheduled_at: scheduledAt,
      status: initialStatus,
      content: pub.content,
      group_id: groupUrl || null,
      idempotency_key: key,
      attempts: 0,
      max_attempts: 3,
      next_attempt_at: null,
      created_at: now
    };
    const { data, error } = await this.supabase.from('posts').insert(record).select('*').single();
    if (error) throw new Error(`Falha ao criar publicação: ${error.message}`);
    return this.mapRowToPublication(data, await this.getProductById(pub.product_id));
  }

  async updatePublication(id: string, updates: Partial<Publication>): Promise<Publication | undefined> {
    const clean: Record<string, any> = {};
    if (updates.scheduled_at !== undefined) clean.scheduled_at = normalizeScheduledAt(updates.scheduled_at);
    if (updates.status !== undefined) clean.status = updates.status;
    if (updates.content !== undefined) clean.content = updates.content;
    if (updates.facebook_group_url !== undefined) clean.group_id = normalizeGroupUrl(updates.facebook_group_url);
    if (updates.facebook_post_url !== undefined) clean.facebook_post_id = updates.facebook_post_url;
    if (updates.published_at !== undefined) clean.published_at = updates.published_at;
    if (updates.error_message !== undefined) clean.error_message = updates.error_message;
    if (updates.attempts !== undefined) clean.attempts = updates.attempts;
    if (updates.max_attempts !== undefined) clean.max_attempts = updates.max_attempts;
    if (updates.next_attempt_at !== undefined) clean.next_attempt_at = updates.next_attempt_at;
    clean.last_attempt_at = new Date().toISOString();

    const { data, error } = await this.supabase.from('posts').update(clean).eq('id', id).select('*').maybeSingle();
    if (error) throw new Error(`Falha ao atualizar publicação: ${error.message}`);
    if (!data) return undefined;
    return this.mapRowToPublication(data, data.affiliate_link_id ? await this.getProductById(data.affiliate_link_id) : undefined);
  }

  async deletePublication(id: string): Promise<boolean> {
    const { error } = await this.supabase.from('posts').delete().eq('id', id);
    if (error) throw new Error(`Falha ao excluir publicação: ${error.message}`);
    return true;
  }

  /**
   * Resets publication for retry.
   * CRITICAL: status is set to 'draft' (NOT 'scheduled') so that it is only
   * marked as 'scheduled' once the Facebook planner confirmation is verified.
   * If scheduled_at is in the past, advances to a valid future time.
   */
  async resetPublicationForRetry(id: string): Promise<Publication | undefined> {
    const pub = await this.getPublicationById(id);
    if (!pub) return undefined;

    const now = Date.now();
    let newScheduledAt = pub.scheduled_at;
    if (new Date(pub.scheduled_at).getTime() <= now) {
      // Advance to 30 minutes from now, rounded to the next 5-minute interval
      const forwardDate = new Date(now + 30 * 60 * 1000);
      forwardDate.setSeconds(0, 0);
      forwardDate.setMinutes(Math.ceil(forwardDate.getMinutes() / 5) * 5);
      newScheduledAt = forwardDate.toISOString();
    }

    const clean: Record<string, any> = {
      status: 'draft',
      attempts: 0,
      next_attempt_at: null,
      error_message: null,
      scheduled_at: newScheduledAt,
      idempotency_key: calculatePublicationIdempotencyKey(
        pub.product_id,
        pub.facebook_group_url || '',
        newScheduledAt
      ),
      last_attempt_at: new Date().toISOString()
    };
    const { data, error } = await this.supabase.from('posts').update(clean).eq('id', id).select('*').maybeSingle();
    if (error) throw new Error(`Falha ao preparar retry da publicação: ${error.message}`);
    return data ? this.mapRowToPublication(data, data.affiliate_link_id ? await this.getProductById(data.affiliate_link_id) : undefined) : undefined;
  }

  async deleteFailedPublications(): Promise<number> {
    const { data, error } = await this.supabase.from('posts').delete().eq('status', 'failed').select('id');
    if (error) throw new Error(`Falha ao limpar publicações falhadas: ${error.message}`);
    return data?.length || 0;
  }

  async getSettings(): Promise<AppSettings> {
    const { data, error } = await this.supabase.from('system_config').select('config').eq('key', 'app_settings').maybeSingle();
    if (error) throw new Error(`Falha ao consultar configurações: ${error.message}`);
    return { ...DEFAULT_SETTINGS, ...((data?.config || {}) as Partial<AppSettings>) };
  }

  async updateSettings(updates: Partial<AppSettings>): Promise<AppSettings> {
    const settings = { ...(await this.getSettings()), ...updates };
    const { error } = await this.supabase.from('system_config').upsert({ key: 'app_settings', config: settings, updated_at: new Date().toISOString() });
    if (error) throw new Error(`Falha ao salvar configurações: ${error.message}`);
    return settings;
  }

  async getQuota(preloadedPublications?: Publication[], preloadedSettings?: AppSettings): Promise<OperationalQuota> {
    const now = new Date();
    const todayLocal = localDateString(now);
    const monthPrefix = todayLocal.slice(0, 7);

    const [publications, settings] = await Promise.all([
      preloadedPublications ? Promise.resolve(preloadedPublications) : this.getPublications(),
      preloadedSettings ? Promise.resolve(preloadedSettings) : this.getSettings()
    ]);

    // Count confirmed scheduled or published in current local month and day
    const monthlyConfirmed = publications.filter(p => {
      if (p.status !== 'scheduled' && p.status !== 'published') return false;
      const refDate = p.published_at || p.scheduled_at;
      if (!refDate) return false;
      return localDateString(new Date(refDate)).startsWith(monthPrefix);
    }).length;

    const dailyConfirmed = publications.filter(p => {
      if (p.status !== 'scheduled' && p.status !== 'published' && p.status !== 'publishing' && p.status !== 'attempting') return false;
      const refDate = p.published_at || p.scheduled_at;
      if (!refDate) return false;
      return localDateString(new Date(refDate)) === todayLocal;
    }).length;

    return {
      current_month: monthPrefix,
      monthly_publication_count: monthlyConfirmed,
      monthly_limit: settings.monthly_limit,
      daily_publication_count: dailyConfirmed,
      daily_limit: settings.daily_limit,
      remaining_month: Math.max(0, settings.monthly_limit - monthlyConfirmed),
      today_date: todayLocal
    };
  }

  async getDashboardStats(): Promise<DashboardStats> {
    // Single consolidated fetch: avoids redundant re-reads
    const [products, publications, settings] = await Promise.all([
      this.getProducts(),
      this.getPublications(),
      this.getSettings()
    ]);

    const quota = await this.getQuota(publications, settings);
    const now = new Date();
    const todayLocal = localDateString(now);
    const monthPrefix = todayLocal.slice(0, 7);

    const published = publications.filter(p => p.status === 'published');

    return {
      products_found: products.length,
      products_valid: products.filter(p => Boolean(p.product_name && p.original_url && p.current_price > 0)).length,
      products_published: published.length,
      published_today: published.filter(p => localDateString(new Date(p.published_at || p.scheduled_at)) === todayLocal).length,
      published_this_month: published.filter(p => localDateString(new Date(p.published_at || p.scheduled_at)).startsWith(monthPrefix)).length,
      monthly_limit: quota.monthly_limit,
      daily_limit: quota.daily_limit,
      remaining_month: quota.remaining_month,
      failures: publications.filter(p => p.status === 'failed').length,
      unknown: publications.filter(p => p.status === 'unknown').length,
      next_publication: publications.find(p => p.status === 'scheduled' && new Date(p.scheduled_at) >= now)
    };
  }

  /**
   * Acquires a database-level distributed lock using the `system_config` table in Supabase.
   * Ensures mutual exclusion across different processes or server instances.
   */
  async acquireDistributedLock(
    lockKey: string,
    owner: string,
    ttlMs = 120000,
    operationName = 'scheduler_operation'
  ): Promise<boolean> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    const nowIso = now.toISOString();

    const { data: existing, error: selectError } = await this.supabase
      .from('system_config')
      .select('*')
      .eq('key', lockKey)
      .maybeSingle();

    if (selectError) {
      logger.scheduler(`FALHA_AO_CONSULTAR_LOCK key=${lockKey} err=${selectError.message}`, 'error');
      return false;
    }

    if (!existing) {
      const { error: insertError } = await this.supabase
        .from('system_config')
        .insert({
          key: lockKey,
          config: {
            owner,
            operation: operationName,
            acquired_at: nowIso,
            expires_at: expiresAt
          },
          updated_at: nowIso
        });

      if (!insertError) {
        logger.scheduler(`DISTRIBUTED_LOCK_ACQUIRED key=${lockKey} owner=${owner} op=${operationName}`);
        return true;
      }
      const { data: retryRow } = await this.supabase
        .from('system_config')
        .select('*')
        .eq('key', lockKey)
        .maybeSingle();
      if (!retryRow) return false;
      return this.tryTakeLock(retryRow, lockKey, owner, expiresAt, nowIso, operationName);
    }

    return this.tryTakeLock(existing, lockKey, owner, expiresAt, nowIso, operationName);
  }

  private async tryTakeLock(
    existing: any,
    lockKey: string,
    owner: string,
    expiresAt: string,
    nowIso: string,
    operationName: string
  ): Promise<boolean> {
    const config = (existing?.config || {}) as {
      owner?: string;
      expires_at?: string;
      operation?: string;
    };

    const isExpired = !config.expires_at || new Date(config.expires_at).getTime() <= Date.now();
    const isOwner = config.owner === owner;

    if (!isExpired && !isOwner) {
      logger.scheduler(`DISTRIBUTED_LOCK_BUSY key=${lockKey} heldBy=${config.owner} expiresAt=${config.expires_at} op=${config.operation}`, 'warn');
      return false;
    }

    const { data: updated, error: updateError } = await this.supabase
      .from('system_config')
      .update({
        config: {
          owner,
          operation: operationName,
          acquired_at: nowIso,
          expires_at: expiresAt
        },
        updated_at: nowIso
      })
      .eq('key', lockKey)
      .eq('updated_at', existing.updated_at)
      .select('key');

    if (updateError || !updated || updated.length === 0) {
      logger.scheduler(`DISTRIBUTED_LOCK_CAS_FAILED key=${lockKey} owner=${owner}`, 'warn');
      return false;
    }

    logger.scheduler(`DISTRIBUTED_LOCK_ACQUIRED key=${lockKey} owner=${owner} op=${operationName}`);
    return true;
  }

  /**
   * Releases a distributed lock previously acquired by the given owner.
   */
  async releaseDistributedLock(lockKey: string, owner: string): Promise<boolean> {
    const { data: existing } = await this.supabase
      .from('system_config')
      .select('*')
      .eq('key', lockKey)
      .maybeSingle();

    if (!existing || existing.config?.owner !== owner) {
      return false;
    }

    const nowIso = new Date().toISOString();
    const { error } = await this.supabase
      .from('system_config')
      .update({
        config: {
          owner: null,
          operation: null,
          acquired_at: null,
          expires_at: null,
          released_at: nowIso
        },
        updated_at: nowIso
      })
      .eq('key', lockKey)
      .eq('updated_at', existing.updated_at);

    if (error) {
      logger.scheduler(`FALHA_AO_LIBERAR_LOCK key=${lockKey} err=${error.message}`, 'warn');
      return false;
    }

    logger.scheduler(`DISTRIBUTED_LOCK_RELEASED key=${lockKey} owner=${owner}`);
    return true;
  }

  /**
   * Renews the expiration of an active lock held by owner.
   */
  async renewDistributedLock(lockKey: string, owner: string, ttlMs = 120000): Promise<boolean> {
    const { data: existing } = await this.supabase
      .from('system_config')
      .select('*')
      .eq('key', lockKey)
      .maybeSingle();

    if (!existing || existing.config?.owner !== owner) {
      return false;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    const nowIso = now.toISOString();

    const { error } = await this.supabase
      .from('system_config')
      .update({
        config: {
          ...existing.config,
          expires_at: expiresAt
        },
        updated_at: nowIso
      })
      .eq('key', lockKey)
      .eq('updated_at', existing.updated_at);

    return !error;
  }

  /**
   * High-level helper: acquires the distributed lock, runs the operation with active heartbeat,
   * and guarantees release in a finally block.
   */
  async withDistributedLock<T>(
    lockKey: string,
    ttlMs: number,
    operationName: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const owner = `${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
    const acquired = await this.acquireDistributedLock(lockKey, owner, ttlMs, operationName);
    if (!acquired) {
      throw new Error(`LOCK_BUSY: A operação '${operationName}' já está em execução em outro processo ou contêiner.`);
    }

    const heartbeatInterval = setInterval(async () => {
      try {
        await this.renewDistributedLock(lockKey, owner, ttlMs);
      } catch {
        // Heartbeat failure is non-fatal
      }
    }, Math.max(10000, Math.floor(ttlMs / 3)));

    try {
      return await operation();
    } finally {
      clearInterval(heartbeatInterval);
      await this.releaseDistributedLock(lockKey, owner).catch(err => {
        logger.scheduler(`FALHA_AO_LIBERAR_LOCK key=${lockKey} err=${err.message}`, 'warn');
      });
    }
  }
}

export const storage = new StorageService();
