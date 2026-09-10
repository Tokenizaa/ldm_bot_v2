import fs from 'fs';
import path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Product, Publication, PriceHistory, AppSettings, OperationalQuota, DashboardStats } from '../types.js';
import { logger } from './LoggerService.js';

interface DatabaseData {
  products: Product[];
  publications: Publication[];
  price_history: PriceHistory[];
  settings: AppSettings;
}

const DEFAULT_SETTINGS: AppSettings = {
  facebook_group_url: 'https://www.facebook.com/groups/ferramentas.promocoes',
  daily_limit: 5,
  monthly_limit: 150,
  daily_hours: ['08:00', '11:00', '14:00', '17:00', '20:00'],
  crawler_categories: [
    'ferramentas-eletricas',
    'ferramentas-manuais',
    'mecanica-automotiva',
    'solda',
    'compressores-e-ar-comprimido'
  ],
  crawler_target_urls: [
    'https://www.lojadomecanico.com.br/categoria/ferramentas-eletricas',
    'https://www.lojadomecanico.com.br/categoria/ferramentas-manuais',
    'https://www.lojadomecanico.com.br/categoria/mecanica-automotiva'
  ],
  nvidia_model: 'meta/llama-3.1-70b-instruct'
};

export class StorageService {
  private supabase: SupabaseClient | null = null;
  private isSupabaseConnected = false;
  private storageFilePath: string;
  private data: DatabaseData;

  constructor() {
    const storageDir = path.join(process.cwd(), 'storage');
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
    this.storageFilePath = path.join(storageDir, 'forge_deals.json');

    // Initialize local data
    this.data = this.loadLocalData();

    // Try initializing Supabase
    this.initSupabase();
  }

  private initSupabase() {
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

    if (supabaseUrl && supabaseKey) {
      try {
        this.supabase = createClient(supabaseUrl, supabaseKey, {
          auth: { persistSession: false }
        });
        this.isSupabaseConnected = true;
        logger.system('Supabase client initialized with provided configuration');
      } catch (err: any) {
        this.isSupabaseConnected = false;
        logger.system(`Supabase initialization warning: ${err.message}`, 'warn');
      }
    } else {
      logger.system('Supabase environment variables not set; using local persistent storage (storage/forge_deals.json)');
    }
  }

  private loadLocalData(): DatabaseData {
    try {
      if (fs.existsSync(this.storageFilePath)) {
        const raw = fs.readFileSync(this.storageFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
          products: parsed.products || [],
          publications: parsed.publications || [],
          price_history: parsed.price_history || [],
          settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) }
        };
      }
    } catch (err) {
      console.error('Error reading storage file, initializing default:', err);
    }

    return {
      products: [],
      publications: [],
      price_history: [],
      settings: DEFAULT_SETTINGS
    };
  }

  private saveLocalData() {
    try {
      fs.writeFileSync(this.storageFilePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error('Error saving storage file:', err);
    }
  }

  // --- PRODUCTS ---
  async getProducts(filterActive = false): Promise<Product[]> {
    if (this.supabase && this.isSupabaseConnected) {
      try {
        let query = this.supabase.from('products').select('*').order('created_at', { ascending: false });
        if (filterActive) query = query.eq('active', true);
        const { data, error } = await query;
        if (!error && data) return data as Product[];
      } catch (e) {
        // fallback to local
      }
    }
    return filterActive ? this.data.products.filter(p => p.active) : this.data.products;
  }

  async getProductById(id: string): Promise<Product | undefined> {
    if (this.supabase && this.isSupabaseConnected) {
      try {
        const { data, error } = await this.supabase.from('products').select('*').eq('id', id).single();
        if (!error && data) return data as Product;
      } catch (e) {}
    }
    return this.data.products.find(p => p.id === id);
  }

  async getProductByIdentityKey(key: string): Promise<Product | undefined> {
    if (this.supabase && this.isSupabaseConnected) {
      try {
        const { data, error } = await this.supabase.from('products').select('*').eq('product_identity_key', key).single();
        if (!error && data) return data as Product;
      } catch (e) {}
    }
    return this.data.products.find(p => p.product_identity_key === key);
  }

  async upsertProduct(product: Omit<Product, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<{ product: Product; isNew: boolean; priceChanged: boolean }> {
    const existing = await this.getProductByIdentityKey(product.product_identity_key);
    const now = new Date().toISOString();

    if (existing) {
      let priceChanged = false;
      const oldPrice = existing.current_price;
      const newPrice = product.current_price;

      if (newPrice > 0 && Math.abs(oldPrice - newPrice) > 0.01) {
        priceChanged = true;
        await this.addPriceHistory({
          product_id: existing.id,
          price: newPrice,
          checked_at: now
        });
      }

      const lowestPrice = existing.lowest_price
        ? Math.min(existing.lowest_price, newPrice)
        : newPrice;

      const updated: Product = {
        ...existing,
        ...product,
        id: existing.id,
        current_price: newPrice,
        previous_price: priceChanged ? oldPrice : existing.previous_price,
        lowest_price: lowestPrice,
        last_scraped_at: now,
        updated_at: now,
        created_at: existing.created_at
      };

      // Update local
      const idx = this.data.products.findIndex(p => p.id === existing.id);
      if (idx >= 0) this.data.products[idx] = updated;
      this.saveLocalData();

      // Sync Supabase
      if (this.supabase && this.isSupabaseConnected) {
        try {
          await this.supabase.from('products').update({
            current_price: updated.current_price,
            previous_price: updated.previous_price,
            lowest_price: updated.lowest_price,
            last_scraped_at: updated.last_scraped_at,
            updated_at: updated.updated_at,
            image_url: updated.image_url,
            active: updated.active
          }).eq('id', existing.id);
        } catch (e) {}
      }

      return { product: updated, isNew: false, priceChanged };
    } else {
      const newProduct: Product = {
        ...product,
        id: product.id || `prod_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        lowest_price: product.current_price,
        created_at: now,
        updated_at: now,
        last_scraped_at: now
      };

      this.data.products.unshift(newProduct);
      this.saveLocalData();

      // Add initial price history
      await this.addPriceHistory({
        product_id: newProduct.id,
        price: newProduct.current_price,
        checked_at: now
      });

      if (this.supabase && this.isSupabaseConnected) {
        try {
          await this.supabase.from('products').insert(newProduct);
        } catch (e) {}
      }

      return { product: newProduct, isNew: true, priceChanged: false };
    }
  }

  // --- PRICE HISTORY ---
  async addPriceHistory(entry: Omit<PriceHistory, 'id'>): Promise<PriceHistory> {
    const record: PriceHistory = {
      id: `ph_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      ...entry
    };

    this.data.price_history.push(record);
    this.saveLocalData();

    if (this.supabase && this.isSupabaseConnected) {
      try {
        await this.supabase.from('price_history').insert(record);
      } catch (e) {}
    }

    return record;
  }

  async getPriceHistoryForProduct(productId: string): Promise<PriceHistory[]> {
    if (this.supabase && this.isSupabaseConnected) {
      try {
        const { data, error } = await this.supabase
          .from('price_history')
          .select('*')
          .eq('product_id', productId)
          .order('checked_at', { ascending: true });
        if (!error && data) return data as PriceHistory[];
      } catch (e) {}
    }
    return this.data.price_history
      .filter(ph => ph.product_id === productId)
      .sort((a, b) => new Date(a.checked_at).getTime() - new Date(b.checked_at).getTime());
  }

  // --- PUBLICATIONS ---
  async getPublications(): Promise<Publication[]> {
    let pubs: Publication[] = [];
    if (this.supabase && this.isSupabaseConnected) {
      try {
        const { data, error } = await this.supabase
          .from('publications')
          .select('*, products(*)')
          .order('scheduled_at', { ascending: false });
        if (!error && data) {
          pubs = data.map((d: any) => ({
            ...d,
            product: d.products || undefined
          }));
        }
      } catch (e) {}
    }

    if (pubs.length === 0) {
      pubs = this.data.publications.map(pub => ({
        ...pub,
        product: this.data.products.find(p => p.id === pub.product_id)
      }));
    }

    return pubs.sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
  }

  async getPublicationById(id: string): Promise<Publication | undefined> {
    const pub = this.data.publications.find(p => p.id === id);
    if (!pub) return undefined;
    return {
      ...pub,
      product: this.data.products.find(p => p.id === pub.product_id)
    };
  }

  async getPublicationsForProduct(productId: string): Promise<Publication[]> {
    return this.data.publications.filter(p => p.product_id === productId);
  }

  async createPublication(pub: Omit<Publication, 'id' | 'created_at' | 'updated_at'>): Promise<Publication> {
    const now = new Date().toISOString();
    const newPub: Publication = {
      ...pub,
      id: `pub_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      created_at: now,
      updated_at: now
    };

    this.data.publications.unshift(newPub);
    this.saveLocalData();

    if (this.supabase && this.isSupabaseConnected) {
      try {
        const { product, ...cleanPub } = newPub as any;
        await this.supabase.from('publications').insert(cleanPub);
      } catch (e) {}
    }

    return {
      ...newPub,
      product: this.data.products.find(p => p.id === newPub.product_id)
    };
  }

  async updatePublication(id: string, updates: Partial<Publication>): Promise<Publication | undefined> {
    const idx = this.data.publications.findIndex(p => p.id === id);
    if (idx === -1) return undefined;

    const now = new Date().toISOString();
    const updated: Publication = {
      ...this.data.publications[idx],
      ...updates,
      updated_at: now
    };

    this.data.publications[idx] = updated;
    this.saveLocalData();

    if (this.supabase && this.isSupabaseConnected) {
      try {
        const { product, ...cleanPub } = updated as any;
        await this.supabase.from('publications').update(cleanPub).eq('id', id);
      } catch (e) {}
    }

    return {
      ...updated,
      product: this.data.products.find(p => p.id === updated.product_id)
    };
  }

  async deletePublication(id: string): Promise<boolean> {
    const idx = this.data.publications.findIndex(p => p.id === id);
    if (idx === -1) return false;

    this.data.publications.splice(idx, 1);
    this.saveLocalData();

    if (this.supabase && this.isSupabaseConnected) {
      try {
        await this.supabase.from('publications').delete().eq('id', id);
      } catch (e) {}
    }

    return true;
  }

  // --- SETTINGS ---
  async getSettings(): Promise<AppSettings> {
    return this.data.settings;
  }

  async updateSettings(updates: Partial<AppSettings>): Promise<AppSettings> {
    this.data.settings = {
      ...this.data.settings,
      ...updates
    };
    this.saveLocalData();

    if (this.supabase && this.isSupabaseConnected) {
      try {
        await this.supabase.from('settings').upsert({
          key: 'app_settings',
          value: this.data.settings,
          updated_at: new Date().toISOString()
        });
      } catch (e) {}
    }

    return this.data.settings;
  }

  // --- QUOTAS & OPERATIONAL CALCULATIONS ---
  // Requirement 2:
  // monthly_limit = 150
  // daily_limit = 5
  // Every month automatically starts at 0 / 150
  async getQuota(): Promise<OperationalQuota> {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const todayDate = now.toISOString().split('T')[0];

    const publications = await this.getPublications();

    // Count published and scheduled publications for current month
    const publishedInMonth = publications.filter(p => {
      if (p.status !== 'published') return false;
      const dateStr = p.published_at || p.scheduled_at;
      return dateStr.startsWith(currentMonth);
    }).length;

    // Count published and scheduled for today
    const publishedToday = publications.filter(p => {
      if (p.status !== 'published' && p.status !== 'publishing') return false;
      const dateStr = p.published_at || p.scheduled_at;
      return dateStr.startsWith(todayDate);
    }).length;

    const monthlyLimit = this.data.settings.monthly_limit || 150;
    const dailyLimit = this.data.settings.daily_limit || 5;

    return {
      current_month: currentMonth,
      monthly_publication_count: publishedInMonth,
      monthly_limit: monthlyLimit,
      daily_publication_count: publishedToday,
      daily_limit: dailyLimit,
      remaining_month: Math.max(0, monthlyLimit - publishedInMonth),
      today_date: todayDate
    };
  }

  async getDashboardStats(): Promise<DashboardStats> {
    const quota = await this.getQuota();
    const products = await this.getProducts();
    const publications = await this.getPublications();

    const validProducts = products.filter(p => p.current_price > 0 && p.original_url && p.product_name);
    const publishedProductsCount = new Set(
      publications.filter(p => p.status === 'published').map(p => p.product_id)
    ).size;

    const failures = publications.filter(p => p.status === 'failed').length;

    const now = new Date();
    const futureScheduled = publications
      .filter(p => p.status === 'scheduled' && new Date(p.scheduled_at) >= now)
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());

    return {
      products_found: products.length,
      products_valid: validProducts.length,
      products_published: publishedProductsCount,
      published_today: quota.daily_publication_count,
      published_this_month: quota.monthly_publication_count,
      monthly_limit: quota.monthly_limit,
      daily_limit: quota.daily_limit,
      remaining_month: quota.remaining_month,
      failures,
      next_publication: futureScheduled[0]
    };
  }

  isSupabaseActive(): boolean {
    return this.isSupabaseConnected;
  }
}

export const storage = new StorageService();
