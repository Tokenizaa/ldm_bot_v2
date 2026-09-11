import * as cheerio from 'cheerio';
import { CrawlerRunResult } from '../types.js';
import { storage } from './StorageService.js';
import { logger } from './LoggerService.js';
import { buildAffiliateUrl, normalizeProductUrl, generateProductIdentityKey } from '../utils/affiliate.js';

const LDM_HOST = 'www.lojadomecanico.com.br';
const LDM_ORIGIN = `https://${LDM_HOST}`;

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
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  };

  private isLdmProductUrl(url: string): boolean {
    try {
      const parsed = new URL(url, LDM_ORIGIN);
      return parsed.protocol === 'https:' &&
        parsed.hostname === LDM_HOST &&
        /^\/produto\/\d+(?:\/|$)/i.test(parsed.pathname) &&
        !/["'<>]|&quot;|&amp;|\\/i.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  private isLdmListingUrl(url: string): boolean {
    try {
      const parsed = new URL(url, LDM_ORIGIN);
      if (parsed.protocol !== 'https:' || parsed.hostname !== LDM_HOST) return false;
      if (/^\/produto\//i.test(parsed.pathname)) return false;
      return /^\/(?:subcategorias|hotsite|categoria)(?:\/|$)/i.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  private normalizeListingUrl(url: string, baseUrl = LDM_ORIGIN): string {
    const parsed = new URL(url, baseUrl);
    parsed.hash = '';
    parsed.hostname = LDM_HOST;
    return parsed.toString().replace(/\/$/, '');
  }

  private parsePrice(value: unknown): number {
    const text = String(value ?? '').trim();
    if (!text) return NaN;
    const normalized = text.includes(',')
      ? text.replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '')
      : text.replace(/[^0-9.-]/g, '');
    return Number(normalized);
  }

  private async fetchPage(url: string, timeoutMs = 15000): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: this.defaultHeaders,
        redirect: 'follow',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ao acessar ${url}`);
      return await response.text();
    } finally {
      clearTimeout(timer);
    }
  }

  private getJsonLdProducts(value: unknown): any[] {
    if (!value) return [];
    if (Array.isArray(value)) return value.flatMap((item) => this.getJsonLdProducts(item));
    if (typeof value !== 'object') return [];
    const object = value as Record<string, any>;
    const result = [object];
    if (Array.isArray(object['@graph'])) result.push(...object['@graph']);
    return result;
  }

  extractJsonLdProduct(html: string, pageUrl: string): RawScrapedProduct | null {
    const $ = cheerio.load(html);
    let found: RawScrapedProduct | null = null;

    $('script[type="application/ld+json"]').each((_, el) => {
      if (found) return;
      try {
        const parsed = JSON.parse($(el).text());
        for (const item of this.getJsonLdProducts(parsed)) {
          const types = Array.isArray(item?.['@type']) ? item['@type'] : [item?.['@type']];
          if (!types.some((type: unknown) => String(type).toLowerCase() === 'product')) continue;

          const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
          const price = this.parsePrice(offers?.price ?? offers?.lowPrice ?? offers?.highPrice);
          const name = String(item.name ?? '').trim();
          if (!name || !Number.isFinite(price) || price <= 0) continue;

          const candidateUrl = String(item.url ?? offers?.url ?? pageUrl).trim();
          const safeUrl = this.isLdmProductUrl(candidateUrl) ? normalizeProductUrl(candidateUrl) : normalizeProductUrl(pageUrl);
          if (!this.isLdmProductUrl(safeUrl)) continue;

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
            url: safeUrl,
          };
          break;
        }
      } catch {
        // DOM fallback handles pages without usable JSON-LD.
      }
    });

    return found;
  }

  extractDomProduct(html: string, pageUrl: string): RawScrapedProduct | null {
    const $ = cheerio.load(html);
    const name = String(
      $('meta[property="og:title"]').attr('content') || $('h1').first().text()
    ).trim();
    const image =
      $('meta[property="og:image"]').attr('content') ||
      $('.product-image img, [data-testid="product-image"]').first().attr('src');
    const metaPrice = $('meta[property="product:price:amount"]').attr('content');
    const priceText = $('[data-testid*="price"], .preco-avista, .price, .product-price, [class*="price"]').first().text();
    const price = this.parsePrice(metaPrice || priceText);

    if (!name || !Number.isFinite(price) || price <= 0 || !this.isLdmProductUrl(pageUrl)) return null;

    const sku = $('[data-sku]').attr('data-sku') ||
      $('.product-sku, .sku').first().text().replace(/[^0-9A-Za-z-]/g, '').trim();
    const brand = $('[data-brand]').attr('data-brand') || $('.product-brand, .brand').first().text().trim();

    return {
      name,
      current_price: price,
      brand: brand || undefined,
      sku: sku || undefined,
      image_url: image || undefined,
      url: normalizeProductUrl(pageUrl),
    };
  }

  extractProductUrlsFromListing(html: string): string[] {
    const urls = new Set<string>();
    const $ = cheerio.load(html);

    $('a[href]').each((_i, el) => {
      const href = String($(el).attr('href') || '').trim();
      if (!href) return;
      try {
        const parsed = new URL(href, LDM_ORIGIN);
        if (!this.isLdmProductUrl(parsed.toString())) return;
        urls.add(normalizeProductUrl(parsed.toString()));
      } catch {
        // Ignore malformed anchors.
      }
    });

    return [...urls];
  }

  private extractListingLinks(html: string, baseUrl: string): string[] {
    const links = new Set<string>();
    const $ = cheerio.load(html);

    $('a[href]').each((_i, el) => {
      const href = String($(el).attr('href') || '').trim();
      if (!href) return;
      try {
        const next = this.normalizeListingUrl(href, baseUrl);
        if (this.isLdmListingUrl(next)) links.add(next);
      } catch {
        // Ignore malformed/external links.
      }
    });

    return [...links];
  }

  async scrapeProductPage(url: string): Promise<RawScrapedProduct | null> {
    if (!this.isLdmProductUrl(url)) return null;
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
    const queue = [...new Set(listingUrls.map((url) => this.normalizeListingUrl(url)).filter((url) => url === LDM_ORIGIN || this.isLdmListingUrl(url)))];

    while (queue.length && discovered.size < target) {
      const url = queue.shift()!;
      if (visited.has(url)) continue;
      visited.add(url);

      try {
        const html = await this.fetchPage(url);

        for (const productUrl of this.extractProductUrlsFromListing(html)) {
          if (!this.isLdmProductUrl(productUrl)) continue;
          discovered.add(productUrl);
          if (discovered.size >= target) break;
        }

        if (discovered.size >= target) break;

        for (const next of this.extractListingLinks(html, url)) {
          if (visited.has(next) || queue.includes(next)) continue;
          if (queue.length >= 500) break;
          queue.push(next);
        }

        logger.crawler(`Catálogo ${url}: ${discovered.size} produtos; ${queue.length} páginas na fila.`);
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

    const defaults = [
      LDM_ORIGIN,
      `${LDM_ORIGIN}/subcategorias/21/224/serra-eletrica`,
      `${LDM_ORIGIN}/subcategorias/21/227/lixadeira-e-politriz`,
      `${LDM_ORIGIN}/subcategorias/11/481/equipamento-hidraulico`,
      `${LDM_ORIGIN}/hotsite/ate-799`,
      `${LDM_ORIGIN}/hotsite/auto-mecanica`,
    ];

    // Keep valid configured seeds, but ALWAYS include current live seeds so an old
    // system_config containing 404 /categoria/... URLs cannot block the batch.
    const listingUrls = [...new Set([...configured, ...defaults])];
    const candidateUrls = await this.discoverProductUrls(listingUrls, target * 3);

    if (!candidateUrls.length) throw new Error('Nenhuma URL real de produto foi descoberta.');

    const products: RawScrapedProduct[] = [];
    const identities = new Set<string>();

    for (const url of candidateUrls) {
      if (products.length >= target) break;
      const raw = await this.scrapeProductPage(url);
      if (!raw || !raw.name || !raw.url || !Number.isFinite(raw.current_price) || raw.current_price <= 0) continue;

      const originalUrl = normalizeProductUrl(raw.url);
      if (!this.isLdmProductUrl(originalUrl)) continue;

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
        last_scraped_at: new Date().toISOString(),
      });

      valid++;
      if (result.isNew) created++;
      else updated++;
    }

    if (valid !== target) throw new Error(`Persistência incompleta: ${valid}/${target}.`);

    logger.crawler(`Coleta concluída: ${valid} produtos reais; ${created} novos; ${updated} atualizados.`);
    return { found: products.length, valid, new: created, updated };
  }
}

export const crawler = new CrawlerService();
