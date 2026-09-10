import crypto from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Product, Publication, PublicationStatus, PriceHistory, AppSettings, OperationalQuota, DashboardStats } from '../types.js';
import { logger } from './LoggerService.js';

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
  nvidia_model: process.env.NVIDIA_MODEL || 'meta/llama-3.1-70b-instruct'
};

export class StorageService {
  private readonly supabase: SupabaseClient;

  constructor() {
    const url = process.env.SUPABASE_URL?.trim();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !key) throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios. Storage local não é suportado.');
    this.supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    logger.system('Supabase configurado como única fonte de verdade.');
  }

  getSupabaseClient(): SupabaseClient { return this.supabase; }
  isSupabaseActive(): boolean { return true; }

  private async query<T>(operation: PromiseLike<{ data: T; error: any }>, label: string): Promise<T> {
    const { data, error } = await operation;
    if (error) {
      logger.system(`${label}: ${error.message}`, 'error');
      throw new Error(`${label}: ${error.message}`);
    }
    return data;
  }

  async getProducts(filterActive = false): Promise<Product[]> {
    let request = this.supabase.from('products').select('*').order('created_at', { ascending: false });
    if (filterActive) request = request.eq('active', true);
    return await this.query(request, 'Falha ao consultar products') as Product[];
  }

  async getProductById(id: string): Promise<Product | undefined> {
    const { data, error } = await this.supabase.from('products').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`Falha ao consultar produto: ${error.message}`);
    return data ? data as Product : undefined;
  }

  async getProductByIdentityKey(key: string): Promise<Product | undefined> {
    const { data, error } = await this.supabase.from('products').select('*').eq('product_identity_key', key).maybeSingle();
    if (error) throw new Error(`Falha ao consultar identidade do produto: ${error.message}`);
    return data ? data as Product : undefined;
  }

  async upsertProduct(product: Omit<Product, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<{ product: Product; isNew: boolean; priceChanged: boolean }> {
    const existing = await this.getProductByIdentityKey(product.product_identity_key);
    const now = new Date().toISOString();

    if (existing) {
      const priceChanged = Math.abs(existing.current_price - product.current_price) > 0.01;
      if (priceChanged) await this.addPriceHistory({ product_id: existing.id, price: product.current_price, checked_at: now });
      const updatedFields = {
        product_identity_key: product.product_identity_key,
        product_name: product.product_name,
        brand: product.brand,
        category: product.category,
        sku: product.sku,
        original_url: product.original_url,
        affiliate_url: product.affiliate_url,
        current_price: product.current_price,
        previous_price: priceChanged ? existing.current_price : existing.previous_price,
        lowest_price: Math.min(existing.lowest_price ?? product.current_price, product.current_price),
        image_url: product.image_url,
        active: product.active,
        last_scraped_at: now,
        updated_at: now
      };
      const updated = await this.query(this.supabase.from('products').update(updatedFields).eq('id', existing.id).select('*').single(), 'Falha ao atualizar produto');
      return { product: updated as Product, isNew: false, priceChanged };
    }

    const record = { ...product, id: product.id || crypto.randomUUID(), lowest_price: product.current_price, created_at: now, updated_at: now, last_scraped_at: now };
    try {
      const inserted = await this.query(this.supabase.from('products').insert(record).select('*').single(), 'Falha ao inserir produto') as Product;
      await this.addPriceHistory({ product_id: inserted.id, price: inserted.current_price, checked_at: now });
      return { product: inserted, isNew: true, priceChanged: false };
    } catch (err) {
      const concurrent = await this.getProductByIdentityKey(product.product_identity_key);
      if (!concurrent) throw err;
      return this.upsertProduct(product);
    }
  }

  async addPriceHistory(entry: Omit<PriceHistory, 'id'>): Promise<PriceHistory> {
    const record = { id: crypto.randomUUID(), ...entry };
    return await this.query(this.supabase.from('price_history').insert(record).select('*').single(), 'Falha ao inserir histórico de preço') as PriceHistory;
  }

  async getPriceHistoryForProduct(productId: string): Promise<PriceHistory[]> {
    return await this.query(this.supabase.from('price_history').select('*').eq('product_id', productId).order('checked_at', { ascending: true }), 'Falha ao consultar histórico de preço') as PriceHistory[];
  }

  async getPublications(status?: PublicationStatus): Promise<Publication[]> {
    let request = this.supabase.from('publications').select('*, products(*)').order('scheduled_at', { ascending: true });
    if (status) request = request.eq('status', status);
    const rows = await this.query(request, 'Falha ao consultar publications') as any[];
    return rows.map(row => ({ ...row, product: row.products || undefined })) as Publication[];
  }

  async getPublicationById(id: string): Promise<Publication | undefined> {
    const { data, error } = await this.supabase.from('publications').select('*, products(*)').eq('id', id).maybeSingle();
    if (error) throw new Error(`Falha ao consultar publicação: ${error.message}`);
    return data ? ({ ...(data as any), product: (data as any).products || undefined } as Publication) : undefined;
  }

  async getPublicationsForProduct(productId: string): Promise<Publication[]> {
    return (await this.getPublications()).filter(p => p.product_id === productId);
  }

  async createPublication(pub: Omit<Publication, 'id' | 'created_at' | 'updated_at'>): Promise<Publication> {
    if (!pub.content?.includes('/20889')) throw new Error('Publicação recusada: copy sem link afiliado /20889.');
    const now = new Date().toISOString();
    const record = { ...pub, id: crypto.randomUUID(), created_at: now, updated_at: now };
    const inserted = await this.query(this.supabase.from('publications').insert(record).select('*, products(*)').single(), 'Falha ao criar publicação') as any;
    return { ...inserted, product: inserted.products || undefined } as Publication;
  }

  async updatePublication(id: string, updates: Partial<Publication>): Promise<Publication | undefined> {
    const { product, ...cleanUpdates } = updates as any;
    const updated = await this.query(this.supabase.from('publications').update({ ...cleanUpdates, updated_at: new Date().toISOString() }).eq('id', id).select('*, products(*)').maybeSingle(), 'Falha ao atualizar publicação') as any;
    return updated ? ({ ...updated, product: updated.products || undefined } as Publication) : undefined;
  }

  async deletePublication(id: string): Promise<boolean> {
    const { error } = await this.supabase.from('publications').delete().eq('id', id);
    if (error) throw new Error(`Falha ao excluir publicação: ${error.message}`);
    return true;
  }

  async getSettings(): Promise<AppSettings> {
    const { data, error } = await this.supabase.from('settings').select('value').eq('key', 'app_settings').maybeSingle();
    if (error) throw new Error(`Falha ao consultar settings: ${error.message}`);
    return { ...DEFAULT_SETTINGS, ...((data?.value || {}) as Partial<AppSettings>) };
  }

  async updateSettings(updates: Partial<AppSettings>): Promise<AppSettings> {
    const settings = { ...(await this.getSettings()), ...updates };
    await this.query(this.supabase.from('settings').upsert({ key: 'app_settings', value: settings, updated_at: new Date().toISOString() }), 'Falha ao salvar settings');
    return settings;
  }

  async getQuota(): Promise<OperationalQuota> {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const todayDate = now.toISOString().slice(0, 10);
    const [publications, settings] = await Promise.all([this.getPublications(), this.getSettings()]);
    const monthly = publications.filter(p => p.status === 'published' && (p.published_at || p.scheduled_at).startsWith(currentMonth)).length;
    const daily = publications.filter(p => (p.status === 'published' || p.status === 'publishing') && (p.published_at || p.scheduled_at).startsWith(todayDate)).length;
    return { current_month: currentMonth, monthly_publication_count: monthly, monthly_limit: settings.monthly_limit, daily_publication_count: daily, daily_limit: settings.daily_limit, remaining_month: Math.max(0, settings.monthly_limit - monthly), today_date: todayDate };
  }

  async getDashboardStats(): Promise<DashboardStats> {
    const [products, publications, quota] = await Promise.all([this.getProducts(), this.getPublications(), this.getQuota()]);
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const today = now.toISOString().slice(0, 10);
    const published = publications.filter(p => p.status === 'published');
    return {
      products_found: products.length,
      products_valid: products.filter(p => Boolean(p.product_name && p.original_url && p.current_price > 0)).length,
      products_published: published.length,
      published_today: published.filter(p => (p.published_at || '').startsWith(today)).length,
      published_this_month: published.filter(p => (p.published_at || p.scheduled_at).startsWith(month)).length,
      monthly_limit: quota.monthly_limit,
      daily_limit: quota.daily_limit,
      remaining_month: quota.remaining_month,
      failures: publications.filter(p => p.status === 'failed').length,
      next_publication: publications.find(p => p.status === 'scheduled' && new Date(p.scheduled_at) >= now)
    };
  }
}

export const storage = new StorageService();
