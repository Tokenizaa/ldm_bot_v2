import * as cheerio from 'cheerio';
import { CrawlerRunResult } from '../types.js';
import { storage } from './StorageService.js';
import { logger } from './LoggerService.js';
import { buildAffiliateUrl, normalizeProductUrl, generateProductIdentityKey } from '../utils/affiliate.js';

export interface RawScrapedProduct {
  name: string;
  current_price: number;
  previous_price?: number;
  brand?: string;
  category?: string;
  sku?: string;
  image_url?: string;
  url: string;
}

export class CrawlerService {
  private defaultHeaders = {
    'User-Agent': 'ForgeDeals/1.0 (+product-crawler)',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
  };

  private async fetchPage(url: string, timeoutMs = 15000): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: this.defaultHeaders });
      if (!response.ok) throw new Error(`HTTP ${response.status} ao acessar ${url}`);
      return await response.text();
    } finally {
      clearTimeout(timer);
    }
  }

  extractJsonLdProduct(html: string, pageUrl: string): RawScrapedProduct | null {
    const $ = cheerio.load(html);
    let found: RawScrapedProduct | null = null;
    $('script[type="application/ld+json"]').each((_, el) => {
      if (found) return;
      try {
        const parsed = JSON.parse($(el).text());
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          const types = Array.isArray(item?.['@type']) ? item['@type'] : [item?.['@type']];
          if (!types.includes('Product')) continue;
          const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
          const rawPrice = offers?.price ?? offers?.lowPrice ?? offers?.highPrice;
          const price = Number(String(rawPrice ?? '').replace(/\./g, '').replace(',', '.'));
          const name = String(item.name ?? '').trim();
          if (!name || !Number.isFinite(price) || price <= 0) continue;
          const brand = typeof item.brand === 'object' ? item.brand?.name : item.brand;
          const image = Array.isArray(item.image) ? item.image[0] : item.image;
          const sku = item.sku ?? item.mpn ?? item.productId;
          found = {
            name,
            current_price: price,
            brand: brand ? String(brand).trim() : undefined,
            category: item.category ? String(item.category).trim() : undefined,
            sku: sku ? String(sku).trim() : undefined,
            image_url: image ? String(image).trim() : undefined,
            url: String(item.url ?? offers?.url ?? pageUrl)
          };
          break;
        }
      } catch { /* try DOM fallback */ }
    });
    return found;
  }

  extractDomProduct(html: string, pageUrl: string): RawScrapedProduct | null {
    const $ = cheerio.load(html);
    const name = String($('meta[property="og:title"]').attr('content') || $('h1').first().text()).trim();
    const image = $('meta[property="og:image"]').attr('content') || $('.product-image img, [data-testid="product-image"]').first().attr('src');
    const metaPrice = $('meta[property="product:price:amount"]').attr('content');
    const priceText = $('[data-testid*="price"], .preco-avista, .price, .product-price, [class*="price"]').first().text();
    const normalizedPrice = String(metaPrice || priceText || '').replace(/[^0-9,.]/g, '');
    const price = normalizedPrice.includes(',')
      ? Number(normalizedPrice.replace(/\./g, '').replace(',', '.'))
      : Number(normalizedPrice);
    if (!name || !Number.isFinite(price) || price <= 0) return null;
    const sku = $('[data-sku]').attr('data-sku') || $('.product-sku, .sku').first().text().replace(/[^0-9A-Za-z-]/g, '').trim();
    const brand = $('[data-brand]').attr('data-brand') || $('.product-brand, .brand').first().text().trim();
    return { name, current_price: price, brand: brand || undefined, sku: sku || undefined, image_url: image || undefined, url: pageUrl };
  }

  extractProductUrlsFromListing(html: string): string[] {
    const urls = new Set<string>();
    const $ = cheerio.load(html);
    $('a[href]').each((_i, el) => {
      const href = String($(el).attr('href') || '').trim();
      if (!href) return;
      try {
        const parsed = new URL(href, 'https://www.lojadomecanico.com.br');
        if (parsed.hostname !== 'www.lojadomecanico.com.br' || !/^\/produto\/\d+/i.test(parsed.pathname)) return;
        parsed.hash = '';
        urls.add(normalizeProductUrl(parsed.toString()));
      } catch { /* ignore invalid href */ }
    });
    return [...urls];
  }

  async scrapeProductPage(url: string): Promise<RawScrapedProduct | null> {
    try {
      const html = await this.fetchPage(url);
      return this.extractJsonLdProduct(html, url) || this.extractDomProduct(html, url);
    } catch (err: any) {
      logger.crawler(`Falha ao raspar ${url}: ${err.message}`, 'warn');
      return null;
    }
  }

  private async discoverProductUrls(listingUrls: string[], target: number): Promise<string[]> {
    const discovered = new Set<string>();
    const visited = new Set<string>();
    const queue = [...listingUrls];
    while (queue.length && discovered.size < target) {
      const url = queue.shift()!;
      if (visited.has(url)) continue;
      visited.add(url);
      try {
        logger.crawler(`Acessando catálogo: ${url}`);
        const html = await this.fetchPage(url);
        for (const productUrl of this.extractProductUrlsFromListing(html)) {
          discovered.add(productUrl);
          if (discovered.size >= target) break;
        }
        if (discovered.size >= target) break;
        const $ = cheerio.load(html);
        $('a[href]').each((_i, el) => {
          if (queue.length >= 300) return;
          const href = String($(el).attr('href') || '').trim();
          if (!href) return;
          try {
            const next = new URL(href, url);
            if (next.hostname !== 'www.lojadomecanico.com.br' || !/\/categoria\//i.test(next.pathname)) return;
            next.hash = '';
            const nextUrl = next.toString();
            if (!visited.has(nextUrl) && !queue.includes(nextUrl)) queue.push(nextUrl);
          } catch { /* ignore */ }
        });
      } catch (err: any) {
        logger.crawler(`Aviso ao acessar catálogo ${url}: ${err.message}`, 'warn');
      }
    }
    return [...discovered];
  }

  async run(): Promise<CrawlerRunResult> {
    const settings = await storage.getSettings();
    const target = 150;
    const configured = settings.crawler_target_urls?.filter(Boolean) || [];
    const listingUrls = configured.length ? configured : [
      'https://www.lojadomecanico.com.br/categoria/ferramentas-eletricas',
      'https://www.lojadomecanico.com.br/categoria/ferramentas-manuais',
      'https://www.lojadomecanico.com.br/categoria/mecanica-automotiva',
      'https://www.lojadomecanico.com.br/categoria/solda',
      'https://www.lojadomecanico.com.br/categoria/compressores-e-ar-comprimido'
    ];

    const candidateUrls = await this.discoverProductUrls(listingUrls, target * 3);
    if (!candidateUrls.length) throw new Error('Nenhuma URL real de produto foi descoberta.');

    const products: RawScrapedProduct[] = [];
    const identities = new Set<string>();
    for (const url of candidateUrls) {
      if (products.length >= target) break;
      const raw = await this.scrapeProductPage(url);
      if (!raw || !raw.name || !raw.url || !Number.isFinite(raw.current_price) || raw.current_price <= 0) continue;
      const originalUrl = normalizeProductUrl(raw.url);
      if (!/^https:\/\/www\.lojadomecanico\.com\.br\/produto\//i.test(originalUrl)) continue;
      const affiliateUrl = buildAffiliateUrl(originalUrl);
      if (!affiliateUrl.endsWith('/20889')) continue;
      const identity = generateProductIdentityKey(raw.sku, originalUrl, raw.name);
      if (identities.has(identity)) continue;
      identities.add(identity);
      products.push({ ...raw, url: originalUrl });
    }

    if (products.length < target) {
      throw new Error(`Coleta incompleta: ${products.length}/${target} produtos reais válidos.`);
    }

    let valid = 0;
    let created = 0;
    let updated = 0;
    for (const raw of products) {
      const originalUrl = normalizeProductUrl(raw.url);
      const affiliateUrl = buildAffiliateUrl(originalUrl);
      const identity = generateProductIdentityKey(raw.sku, originalUrl, raw.name);
      const result = await storage.upsertProduct({
        product_identity_key: identity,
        product_name: raw.name,
        brand: raw.brand || 'Loja do Mecânico',
        category: raw.category || 'Ferramentas',
        sku: raw.sku,
        original_url: originalUrl,
        affiliate_url: affiliateUrl,
        current_price: raw.current_price,
        previous_price: raw.previous_price,
        image_url: raw.image_url,
        active: true,
        last_scraped_at: new Date().toISOString()
      });
      valid++;
      if (result.isNew) created++; else updated++;
    }

    if (valid !== target) throw new Error(`Persistência incompleta: ${valid}/${target}.`);
    logger.crawler(`Coleta concluída: ${valid} produtos reais; ${created} novos; ${updated} atualizados.`);
    return { found: products.length, valid, new: created, updated };
  }
}

export const crawler = new CrawlerService();
