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
      current_price: Number(row.current_price || 0), previous_price: row.previous_price != null ? Number(row.previous_price) : undefined,
      lowest_price: row.lowest_price != null ? Number(row.lowest_price) : undefined,
      image_url: row.image_url ? String(row.image_url) : undefined, active: Boolean(row.monitored ?? true),
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
      published_at: row.published_at ? String(row.published_at) : undefined,
      error_message: row.error_message ? String(row.error_message) : undefined,
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

  async upsertProduct(product: Omit<Product, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<{ product: Product; isNew: boolean; priceChanged: boolean }> {
    const existing = await this.getProductByIdentityKey(product.product_identity_key);
    const now = new Date().toISOString();
    if (existing) {
      const priceChanged = Math.abs(existing.current_price - product.current_price) > 0.01;
      if (priceChanged) await this.addPriceHistory({ product_id: existing.id, price: product.current_price, checked_at: now });
      const updatePayload: Record<string, any> = {
        product_name: product.product_name, brand: product.brand || null, category: product.category || null,
        sku: product.sku || null, image_url: product.image_url || null, original_url: product.original_url,
        affiliate_url: product.affiliate_url, current_price: product.current_price,
        previous_price: priceChanged ? existing.current_price : existing.previous_price || null,
        lowest_price: Math.min(existing.lowest_price ?? product.current_price, product.current_price),
        monitored: product.active, last_checked_at: now
      };
      const { data, error } = await this.supabase.from('affiliate_links').update(updatePayload).eq('id', existing.id).select('*').single();
      if (error) throw new Error(`Falha ao atualizar produto em affiliate_links: ${error.message}`);
      return { product: this.mapRowToProduct(data), isNew: false, priceChanged };
    }

    const newId = product.id || crypto.randomUUID();
    const insertPayload: Record<string, any> = {
      id: newId, product_identity_key: product.product_identity_key, product_name: product.product_name,
      brand: product.brand || null, category: product.category || null, sku: product.sku || null,
      image_url: product.image_url || null, original_url: product.original_url, affiliate_url: product.affiliate_url,
      current_price: product.current_price, previous_price: product.previous_price || null,
      lowest_price: product.current_price, monitored: product.active, last_checked_at: now, created_at: now
    };
    const { data, error } = await this.supabase.from('affiliate_links').insert(insertPayload).select('*').single();
    if (error) {
      const concurrent = await this.getProductByIdentityKey(product.product_identity_key);
      if (concurrent) return this.upsertProduct(product);
      throw new Error(`Falha ao inserir produto em affiliate_links: ${error.message}`);
    }
    await this.addPriceHistory({ product_id: newId, price: product.current_price, checked_at: now });
    return { product: this.mapRowToProduct(data), isNew: true, priceChanged: false };
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
    const posts = data || []; if (!posts.length) return [];
    const products = await this.getProducts(); const productMap = new Map(products.map(p => [p.id, p]));
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
    const publications = await this.getPublications(); return publications.filter(p => p.product_id === productId);
  }
